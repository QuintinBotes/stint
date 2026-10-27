import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { skillBundleDigest, skillFolderDigest } from '../src/skills';
import { TOKEN, makeApp, post, withFixtureRepo } from './helpers';

test('Export, then import, reproduces the same digest', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const entries = {
      'SKILL.md': '---\nname: acme-widget-care\ndescription: "Use when an acme widget needs care."\nroles: [implementer]\ntags: [widgets]\n---\n\n# Widget care\n\nCheck the widget first.\n',
      'references/widget.md': 'How an acme widget is put together.\n',
      'examples.md': '# Examples\n\n- A widget with a loose bolt.\n',
    };
    const form = new FormData();
    form.append('file', new File([Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, new TextEncoder().encode(v)]))))], 'acme.zip', { type: 'application/zip' }));
    form.append('source', JSON.stringify({ kind: 'zip', ref: 'acme.zip' }));
    const imported = await app.request('/api/skills/import', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form });
    expect(imported.status).toBe(201);
    expect((await post(app, '/api/skills/acme-widget-care/approve', {})).status).toBe(200);

    const exported = await app.request('/api/skills/acme-widget-care/export');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('Content-Disposition')).toContain('acme-widget-care.zip');
    const zip = new Uint8Array(await exported.arrayBuffer());
    const approvedDigest = skillFolderDigest(repo, 'acme-widget-care');

    // the same zip goes to a second workspace, and the queue holds it by the same digest
    await withFixtureRepo(async (other) => {
      const second = await makeApp(other);
      const form2 = new FormData();
      form2.append('file', new File([Buffer.from(zip)], 'acme-widget-care.zip', { type: 'application/zip' }));
      form2.append('source', JSON.stringify({ kind: 'zip', ref: 'acme-widget-care.zip' }));
      const reimported = await second.app.request('/api/skills/import', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form2 });
      expect(reimported.status).toBe(201);
      const body = (await reimported.json()) as { id: string; proposal: { digest?: string } };
      expect(body.id).toBe('acme-widget-care');
      expect(body.proposal.digest).toBe(approvedDigest);

      const held = JSON.parse(readFileSync(join(second.ws.cacheDir, 'proposals', 'acme-widget-care', 'proposal.json'), 'utf8')) as { digest: string };
      expect(held.digest).toBe(approvedDigest);
      const digestOfHeld = skillBundleDigest([
        { path: 'SKILL.md', bytes: readFileSync(join(second.ws.cacheDir, 'proposals', 'acme-widget-care', 'SKILL.md')) },
        { path: 'examples.md', bytes: readFileSync(join(second.ws.cacheDir, 'proposals', 'acme-widget-care', 'examples.md')) },
        { path: 'references/widget.md', bytes: readFileSync(join(second.ws.cacheDir, 'proposals', 'acme-widget-care', 'references', 'widget.md')) },
      ]);
      expect(digestOfHeld).toBe(approvedDigest);
      expect(approvedDigest).toBe(skillFolderDigest(ws.root, 'acme-widget-care'));
    });
  });
}, 120_000);
