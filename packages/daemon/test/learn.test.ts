import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, parseSkillFrontmatter } from '@stint-dev/core';
import { DEFAULT_RECORDING, Replayer, daemonContext, gitOk } from '../src/index';
import { runLearn } from '../src/learn';
import { auth, makeApp, post, tempDir, withFixtureRepo } from './helpers';

const proposal = {
  version: 'stint.skillProposal/1',
  id: 'limiter-config-via-env',
  name: 'Limits come from config',
  description: 'Use when adding a limit, threshold, window or cap: read it through loadConfig() with a default, never as a constant.',
  roles: ['implementer', 'reviewer'],
  tags: ['limits', 'config'],
  rule: 'Every limit, threshold, window and cap is read through loadConfig() from an env var with a default. Add a config test for the default and one for the override. A reviewer flags a constant limit as a finding.',
  examples: [{ task: 'T-0042', run: 'r3', diff: 'src/lib/limiter.ts@HEAD' }],
  evidence: ['T-0042/r4#F1', 'T-0040/r3#F2'],
  confidence: 0.82,
};

function fakeModel() {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'muse-glimmer:30b-mlx', model: 'muse-glimmer:30b-mlx' }] });
      if (url.pathname === '/api/chat') {
        calls++;
        return Response.json({ message: { content: JSON.stringify(proposal) }, prompt_eval_count: 980, eval_count: 120 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, calls: () => calls, stop: () => server.stop(true) };
}

/** The recording with T-0040's hard-coded-limit finding (F2) taken out, so nothing recurs. */
function recordingWithoutT0040F2(): string {
  const tmp = tempDir();
  const path = join(tmp.dir, 'recording.jsonl');
  const rows = readFileSync(DEFAULT_RECORDING, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      if (i === 0) return l;
      const e = JSON.parse(l) as { task: string; type: string; payload: Record<string, unknown> };
      if (e.task === 'T-0040' && e.type === 'review.recorded') {
        const review = e.payload.review as { findings: Array<{ id: string }> };
        review.findings = review.findings.filter((f) => f.id !== 'F2');
        e.payload.findings = review.findings.length;
      }
      return JSON.stringify(e);
    });
  writeFileSync(path, `${rows.join('\n')}\n`);
  return path;
}

/** The replayed demo state paused just before T-0042 is approved, with the fake model on the learn chain. */
async function seeded(repo: string, modelUrl: string, recording = DEFAULT_RECORDING) {
  const config = structuredClone(DEFAULT_CONFIG);
  (config.hosts.ollama as { baseURL: string }).baseURL = modelUrl;
  config.routes.learn = ['ollama/muse-glimmer:30b-mlx'];
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
  const made = await makeApp(repo);
  const r = new Replayer(made.ws);
  r.load(recording);
  await r.play({ speed: 0, until: 124_999 });
  return made;
}

/** Approves T-0042 through the route and waits for the learn pass it triggered to land an event. */
async function approveAndLearn(made: Awaited<ReturnType<typeof seeded>>) {
  const res = await post(made.app, '/api/tasks/T-0042/approve', {});
  expect(res.status).toBe(200);
  let event = null as null | { type: string; payload: Record<string, unknown> };
  for (let i = 0; i < 400 && !event; i++) {
    event = (await made.ws.events('T-0042').read()).filter((e) => e.type === 'skill.proposed' || e.type === 'learn.skipped').at(-1) ?? null;
    if (!event) await Bun.sleep(50);
  }
  expect(event).not.toBeNull();
  return event as { type: string; payload: Record<string, unknown> };
}

test("Approving T-0042 emits skill.proposed with id limiter-config-via-env and evidence containing both T-0042/...#F1 and T-0040/...#F2; with T-0040's finding removed, it emits learn.skipped { reason: 'no recurrence' } and makes no model call", async () => {
  const model = fakeModel();
  try {
    await withFixtureRepo(async (repo) => {
      const made = await seeded(repo, model.url);
      const before = model.calls();
      const event = await approveAndLearn(made);
      expect(event.type).toBe('skill.proposed');
      expect(event.payload.id).toBe('limiter-config-via-env');
      expect(event.payload.evidence).toEqual(expect.arrayContaining(['T-0042/r4#F1', 'T-0040/r3#F2']));
      expect(event.payload).toMatchObject({ confidence: 0.82, host: 'ollama', model: 'muse-glimmer:30b-mlx', cost: { usd: 0 } });
      expect(model.calls()).toBe(before + 1);
      expect(existsSync(join(made.ws.cacheDir, 'proposals', 'limiter-config-via-env.json'))).toBe(true);
      expect(existsSync(join(repo, '.agents', 'skills', 'limiter-config-via-env', 'SKILL.md'))).toBe(false);
      const rows = (await (await made.app.request('/api/skills')).json()) as Array<{ id: string; status: string; origin: string }>;
      expect(rows.find((s) => s.id === 'limiter-config-via-env')).toMatchObject({ status: 'proposed', origin: 'learn-loop' });
    });

    await withFixtureRepo(async (repo) => {
      const made = await seeded(repo, model.url, recordingWithoutT0040F2());
      const before = model.calls();
      const event = await approveAndLearn(made);
      expect(event.type).toBe('learn.skipped');
      expect(event.payload).toEqual({ reason: 'no recurrence' });
      expect(model.calls()).toBe(before);
    });
  } finally {
    model.stop();
  }
}, 180_000);

test('Approving the proposal writes .agents/skills/limiter-config-via-env/SKILL.md with the right frontmatter and a commit carrying Stint-Skill:; rejecting it twice with the same evidence raises it once', async () => {
  const model = fakeModel();
  try {
    await withFixtureRepo(async (repo) => {
      const made = await seeded(repo, model.url);
      await approveAndLearn(made);
      const res = await post(made.app, '/api/skills/limiter-config-via-env/approve', {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { committed: boolean; commit: string | null; status: string };
      // R-031: an approved skill starts on probation and earns active from its track record
      expect(body).toMatchObject({ committed: true, status: 'probation' });

      const file = join(repo, '.agents', 'skills', 'limiter-config-via-env', 'SKILL.md');
      const { frontmatter, body: text } = parseSkillFrontmatter(readFileSync(file, 'utf8'));
      expect(frontmatter).toMatchObject({
        name: 'limiter-config-via-env',
        roles: ['implementer', 'reviewer'],
        tags: ['limits', 'config'],
        version: '1.0.0',
        origin: 'learn-loop',
        status: 'probation',
        evidence: ['T-0042/r4#F1', 'T-0040/r3#F2'],
      });
      expect(text).toContain('Every limit, threshold, window and cap is read through loadConfig()');
      expect(readFileSync(join(repo, '.agents', 'skills', 'limiter-config-via-env', 'examples.md'), 'utf8')).toContain('T-0042 r3');

      const message = await gitOk(repo, ['log', '-1', '--format=%B']);
      expect(message).toContain('Add skill limiter-config-via-env');
      expect(message).toContain('Stint-Skill: limiter-config-via-env');
      expect((await gitOk(repo, ['show', '--name-only', '--format=', 'HEAD'])).trim().split('\n')).toEqual([
        '.agents/skills/limiter-config-via-env/SKILL.md',
        '.agents/skills/limiter-config-via-env/examples.md',
      ]);
      const approved = (await made.ws.events('T-0042').read()).find((e) => e.type === 'skill.approved');
      expect(approved?.payload).toMatchObject({ id: 'limiter-config-via-env', committed: true, commit: body.commit });
      expect(existsSync(join(made.ws.cacheDir, 'proposals', 'limiter-config-via-env.json'))).toBe(false);
    });

    await withFixtureRepo(async (repo) => {
      const made = await seeded(repo, model.url);
      await approveAndLearn(made);
      const before = model.calls();
      const rejected = await made.app.request('/api/skills/limiter-config-via-env/reject', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Too broad for this codebase' }),
      });
      expect(rejected.status).toBe(200);
      const again = await post(made.app, '/api/skills/limiter-config-via-env/reject', { reason: 'Too broad for this codebase' });
      expect(again.status).toBe(404);

      const remembered = JSON.parse(readFileSync(join(made.ws.cacheDir, 'proposals', 'rejected.json'), 'utf8')) as Array<{ id: string; reason: string }>;
      expect(remembered).toMatchObject([{ id: 'limiter-config-via-env', reason: 'Too broad for this codebase' }]);

      await runLearn(daemonContext(made.app), 'T-0042');
      const events = await made.ws.events('T-0042').read();
      expect(events.filter((e) => e.type === 'skill.proposed')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'learn.skipped').at(-1)?.payload).toEqual({ reason: 'evidence was rejected before' });
      expect(model.calls()).toBe(before);
      expect(existsSync(join(repo, '.agents', 'skills', 'limiter-config-via-env', 'SKILL.md'))).toBe(false);
    });
  } finally {
    model.stop();
  }
}, 180_000);
