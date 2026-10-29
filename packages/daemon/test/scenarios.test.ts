import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type Config } from '@stint-dev/core';
import { gitOk, parseCoverage, worktreePath } from '../src/index';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

const GREEN = `printf ' 1 pass\\n 0 fail\\n'`;
const HOLDOUT_SOURCE = `import { expect, test } from 'bun:test';\ntest('holdout: limiter answers 429 with Retry-After', () => { expect(429).toBe(200); });\n`;

function writeConfig(repo: string, mutate: (c: Config) => void): void {
  const config = structuredClone(DEFAULT_CONFIG);
  mutate(config);
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
}

async function untilHandoff(ws: Awaited<ReturnType<typeof makeApp>>['ws'], id: string) {
  for (let i = 0; i < 900; i++) {
    const events = await ws.events(id).read();
    if (events.some((e) => e.type === 'handoff.created')) return events;
    await Bun.sleep(50);
  }
  return ws.events(id).read();
}

test('A scenario that fails on the branch turns the verification red without the scenario file ever appearing in the worktree or prompt.md', async () => {
  await withFixtureRepo(async (repo) => {
    writeConfig(repo, (c) => {
      c.scenarios = { dir: '.stint/scenarios', command: 'bun test holdout.test.ts' };
    });
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After'], testCommand: GREEN });

    const stored = await post(app, `/api/tasks/${t.id}/scenarios`, { name: 'holdout.test.ts', content: HOLDOUT_SOURCE });
    expect(stored.status).toBe(201);
    expect(existsSync(join(repo, '.stint', 'scenarios', t.id, 'holdout.test.ts'))).toBe(true);

    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await untilHandoff(ws, t.id);

    const v = await ws.verification(t.id).latest();
    expect(v?.status).toBe('red');
    expect(v?.scenarios?.failed).toBe(1);
    expect(v?.scenarios?.passed).toBe(0);
    expect(v?.scenarios?.names).toContain('holdout.test.ts');
    expect(v?.scenarios?.names.join(' ')).toContain('holdout: limiter answers 429');
    expect(events.find((e) => e.type === 'scenario.ran')?.payload).toMatchObject({ passed: 0, failed: 1 });

    const worktree = worktreePath(ws, t.id, 'r1');
    expect(existsSync(join(worktree, 'holdout.test.ts'))).toBe(false);
    const prompt = await ws.runs(t.id).readPrompt('r1');
    expect(prompt).not.toContain('holdout');
    expect(prompt).not.toContain('toBe(200)');

    // the next agent learns the names of the failing scenarios, never their source
    const packet = await ws.handoffs(t.id).latest();
    expect(JSON.stringify(packet)).toContain('holdout: limiter answers 429');
    expect(JSON.stringify(packet)).not.toContain('toBe(200)');
  });
}, 240_000);

test('a scenario that passes on the branch keeps the verification as the checks decide', async () => {
  await withFixtureRepo(async (repo) => {
    writeConfig(repo, (c) => {
      c.scenarios = { dir: '.stint/scenarios', command: 'bun test holdout.test.ts' };
    });
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429.', acceptance: ['429'], testCommand: GREEN });
    mkdirSync(join(repo, '.stint', 'scenarios', t.id), { recursive: true });
    writeFileSync(join(repo, '.stint', 'scenarios', t.id, 'holdout.test.ts'), `import { expect, test } from 'bun:test';\ntest('holdout: limiter exists', () => { expect(1).toBe(1); });\n`);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    await untilHandoff(ws, t.id);
    const v = await ws.verification(t.id).latest();
    expect(v?.status).toBe('green');
    expect(v?.scenarios).toMatchObject({ passed: 1, failed: 0 });
  });
}, 240_000);

test('scenarios that cannot run turn the verification red with the reason, never a quiet green', async () => {
  await withFixtureRepo(async (repo) => {
    writeConfig(repo, (c) => {
      c.scenarios = { dir: '.stint/scenarios', command: 'bun test {files}' };
    });
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429.', acceptance: ['429'], testCommand: GREEN });
    // package.json is a file in the checkout, so the scenario cannot be copied in under it
    expect((await post(app, `/api/tasks/${t.id}/scenarios`, { name: 'package.json/holdout.test.ts', content: HOLDOUT_SOURCE })).status).toBe(201);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await untilHandoff(ws, t.id);
    const v = await ws.verification(t.id).latest();
    expect(v?.status).toBe('red');
    expect(v?.reason).toBe('scenarios');
    expect(v?.passed).toBe(1);
    expect(v?.failed).toBe(0);
    expect(v?.scenarios).toBeNull();
    const ran = events.find((e) => e.type === 'verification.ran');
    expect(ran?.payload).toMatchObject({ status: 'red', reason: 'scenarios' });
    expect(String(ran?.payload.scenariosError)).toContain('package.json');
    const output = await (await app.request(`/api/tasks/${t.id}/verification/r1/output`)).text();
    expect(output).toContain('=== held-out scenarios were NOT run: ');
    expect(output).not.toContain('toBe(200)');
  });
}, 240_000);

test('a coverage delta is recorded when config.verify.coverage is on: base and branch line percentages', async () => {
  await withFixtureRepo(async (repo) => {
    const covSh = [
      '#!/bin/sh',
      "printf '(pass) cov > works [1ms]\\n 1 pass\\n 0 fail\\n'",
      'case " $* " in',
      '  *" --coverage "*)',
      '    if [ -f src/lib/limiter.ts ]; then pct=80.00; else pct=50.00; fi',
      "    printf 'File | %% Funcs | %% Lines | Uncovered\\nAll files | 90.00 | %s |\\n' \"$pct\"",
      '    ;;',
      'esac',
      '',
    ].join('\n');
    writeFileSync(join(repo, 'cov.sh'), covSh);
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    pkg.scripts.test = 'sh cov.sh';
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    await gitOk(repo, ['add', 'cov.sh', 'package.json']);
    await gitOk(repo, ['commit', '-qm', 'test script that reports coverage']);

    writeConfig(repo, (c) => {
      c.verify = { checks: [], tamper: 'fail', coverage: true };
    });
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429.', acceptance: ['429'], testCommand: 'bun run test' });
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await untilHandoff(ws, t.id);
    const v = await ws.verification(t.id).latest();
    expect(v?.status).toBe('green');
    expect(v?.coverage).toEqual({ base: 50, branch: 80 });
    expect(events.find((e) => e.type === 'verification.ran')?.payload.coverage).toEqual({ base: 50, branch: 80 });
  });
}, 240_000);

test('coverage the runner cannot give is recorded as null with a reason and does not fail the verification', async () => {
  await withFixtureRepo(async (repo) => {
    writeConfig(repo, (c) => {
      c.verify = { checks: [], tamper: 'fail', coverage: true };
    });
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429.', acceptance: ['429'], testCommand: GREEN });
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    await untilHandoff(ws, t.id);
    const v = await ws.verification(t.id).latest();
    expect(v?.status).toBe('green');
    expect(v?.coverage).toBeNull();
    expect(typeof v?.coverageReason).toBe('string');
  });
}, 240_000);

test('parseCoverage reads the line percentage from bun, Vitest and text-summary output', () => {
  expect(parseCoverage('File | % Funcs | % Lines | Uncovered Line #s\nAll files | 91.20 | 84.50 |\n')).toBe(84.5);
  expect(parseCoverage('File      | % Stmts | % Branch | % Funcs | % Lines |\nAll files |   87.5 |    70.0 |   90.0 |   88.25 |\n')).toBe(88.25);
  expect(parseCoverage('Lines        : 76.4% ( 955/1250 )\n')).toBe(76.4);
  expect(parseCoverage(' 1 pass\n 0 fail\n')).toBeNull();
});
