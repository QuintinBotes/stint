import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { TOKEN, makeApp, withFixtureRepo } from './helpers';

const skillMd = (name = 'acme-widget-care', body = 'Check the widget before you change it.') =>
  `---\nname: ${name}\ndescription: "Use when an acme widget needs care."\nroles: [implementer]\n---\n\n# Widget care\n\n${body}\n`;

const zipOf = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, new TextEncoder().encode(v)])));

async function postZip(app: Awaited<ReturnType<typeof makeApp>>['app'], zip: Uint8Array, name = 'acme.zip', headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }) {
  const form = new FormData();
  form.append('file', new File([Buffer.from(zip)], name, { type: 'application/zip' }));
  form.append('source', JSON.stringify({ kind: 'zip', ref: name }));
  return app.request('/api/skills/import', { method: 'POST', headers, body: form });
}

test('POST /api/skills/import with a zip creates .stint/cache/proposals/<id>/, writes nothing under .agents/skills, and emits skill.imported on the workspace log', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const res = await postZip(app, zipOf({ 'SKILL.md': skillMd(), 'references/widget.md': 'Widget background.\n' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; proposal: { origin: string; status: string; digest?: string }; findings: unknown[] };
    expect(body.id).toBe('acme-widget-care');
    expect(body.proposal).toMatchObject({ origin: 'import', status: 'proposed' });
    expect(body.findings).toEqual([]);

    const proposalDir = join(ws.cacheDir, 'proposals', 'acme-widget-care');
    expect(existsSync(join(proposalDir, 'proposal.json'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(proposalDir, 'references', 'widget.md'))).toBe(true);
    expect(existsSync(join(repo, '.agents', 'skills', 'acme-widget-care'))).toBe(false);

    const events = await ws.workspaceEvents().read();
    const imported = events.find((e) => e.type === 'skill.imported');
    expect(imported?.task).toBe('workspace');
    expect(imported?.payload).toMatchObject({ id: 'acme-widget-care', origin: 'import', source: { kind: 'zip', ref: 'acme.zip' } });
    expect(await ws.workspaceEvents().verify()).toEqual({ ok: true });

    const served = (await (await app.request('/api/workspace/events')).json()) as { events: Array<{ type: string }> };
    expect(served.events.some((e) => e.type === 'skill.imported')).toBe(true);
  });
}, 60_000);

test('POST /api/skills/import without the token returns 401', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const res = await postZip(app, zipOf({ 'SKILL.md': skillMd('globex-widget-care') }), 'globex.zip', {});
    expect(res.status).toBe(401);
    expect(existsSync(join(ws.cacheDir, 'proposals', 'globex-widget-care'))).toBe(false);
  });
}, 60_000);

test('a zip with a ../ entry returns skill_invalid and writes nothing', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const res = await postZip(app, zipOf({ 'SKILL.md': skillMd(), '../evil.md': 'outside the folder' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; hint: { findings: Array<{ id: string }> } } };
    expect(body.error.code).toBe('skill_invalid');
    expect(body.error.hint.findings.some((f) => f.id === 'bad-path')).toBe(true);
    expect(existsSync(join(ws.cacheDir, 'proposals', 'acme-widget-care'))).toBe(false);
    expect(existsSync(join(repo, '.agents', 'skills', 'acme-widget-care'))).toBe(false);
    expect(existsSync(join(repo, 'evil.md'))).toBe(false);
    expect(await ws.workspaceEvents().read()).toEqual([]);
  });
}, 60_000);

test('importing an id that already exists queues an update and emits skill.edit_proposed', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const first = await postZip(app, zipOf({ 'SKILL.md': skillMd('review-voice-policy') }));
    expect(first.status).toBe(201);
    const body = (await first.json()) as { proposal: { updateProposed?: boolean } };
    expect(body.proposal.updateProposed).toBe(true);
    const events = await ws.workspaceEvents().read();
    expect(events.some((e) => e.type === 'skill.edit_proposed' && e.payload.id === 'review-voice-policy')).toBe(true);
  });
}, 60_000);

test('an upload over 4 MB, or a zip of more than 64 files, returns skill_invalid before anything is inflated or written', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const big = await postZip(app, new Uint8Array(4 * 1024 * 1024 + 1));
    expect(big.status).toBe(422);
    expect(((await big.json()) as { error: { hint: { findings: Array<{ id: string }> } } }).error.hint.findings.map((f) => f.id)).toEqual(['upload-too-large']);
    const many = Object.fromEntries([['SKILL.md', skillMd()], ...Array.from({ length: 70 }, (_, i) => [`references/r${i}.md`, 'x'])]);
    const res = await postZip(app, zipOf(many));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { hint: { findings: Array<{ id: string }> } } }).error.hint.findings.map((f) => f.id)).toEqual(['bundle-too-large']);
    expect(existsSync(join(ws.cacheDir, 'proposals', 'acme-widget-care'))).toBe(false);
    expect(await ws.workspaceEvents().read()).toEqual([]);
  });
}, 60_000);
