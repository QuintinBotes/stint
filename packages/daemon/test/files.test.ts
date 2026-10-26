import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { editorCommand } from '../src/routes/files';
import { builtTask, post, withFixtureRepo } from './helpers';

test('editorCommand fills the configured editor, and falls back to an opener', () => {
  expect(editorCommand(['code', '-g', '{path}:{line}'], '/w/src/a.ts', 7)).toEqual(['code', '-g', '/w/src/a.ts:7']);
  expect(editorCommand(['zed', '{path}'], '/w', undefined)).toEqual(['zed', '/w']);
  expect(editorCommand(undefined, '/w', 1)?.length).toBeGreaterThan(0);
});

test('The Files tab lists the worktree with the changed files, reads only files of the task, and opens them in the configured editor', async () => {
  await withFixtureRepo(async (repo) => {
    const marker = join(repo, '..', `opened-${Date.now()}.txt`);
    const config = structuredClone(DEFAULT_CONFIG);
    config.editor = ['/bin/sh', '-c', `printf '%s' "$0" > ${marker}`, '{path}'];
    mkdirSync(join(repo, '.stint'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    const { app, t } = await builtTask(repo);

    const list = (await (await app.request(`/api/tasks/${t.id}/files`)).json()) as { files: string[]; changed: Array<{ path: string }>; editable: boolean; worktree: string };
    expect(list.editable).toBe(true);
    expect(list.files).toContain('src/lib/limiter.ts');
    expect(list.files).toContain('package.json');
    expect(list.changed.map((c) => c.path)).toContain('src/lib/limiter.ts');

    const file = (await (await app.request(`/api/tasks/${t.id}/files/content?path=src/lib/limiter.ts`)).json()) as { content: string };
    expect(file.content).toBe('export const LIMIT = 60;\n');
    for (const bad of ['../package.json', '/etc/passwd', '.git/config', 'src/../../x']) {
      expect((await app.request(`/api/tasks/${t.id}/files/content?path=${encodeURIComponent(bad)}`)).status).toBe(404);
    }

    // opening needs the token, and opens the worktree's own copy of the file
    expect((await app.request(`/api/tasks/${t.id}/open`, { method: 'POST', body: JSON.stringify({ path: 'src/lib/limiter.ts' }) })).status).toBe(401);
    const opened = await post(app, `/api/tasks/${t.id}/open`, { path: 'src/lib/limiter.ts', line: 1 });
    expect(opened.status).toBe(200);
    for (let i = 0; i < 100 && !existsSync(marker); i++) await Bun.sleep(20);
    expect(readFileSync(marker, 'utf8')).toBe(join(repo, list.worktree, 'src/lib/limiter.ts'));
    expect((await post(app, `/api/tasks/${t.id}/open`, { path: '../package.json' })).status).toBe(404);

    // after approve the worktree is gone: the branch is shown read-only, and there is nothing to open
    expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
    const after = (await (await app.request(`/api/tasks/${t.id}/files`)).json()) as { editable: boolean; files: string[] };
    expect(after.editable).toBe(false);
    expect(after.files).toContain('src/lib/limiter.ts');
    expect(((await (await app.request(`/api/tasks/${t.id}/files/content?path=src/lib/limiter.ts`)).json()) as { content: string }).content).toBe('export const LIMIT = 60;\n');
    expect((await post(app, `/api/tasks/${t.id}/open`, {})).status).toBe(404);
  });
}, 60_000);
