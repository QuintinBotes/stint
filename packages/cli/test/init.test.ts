import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFixtureRepo } from '../../core/test/fixture';
import { init } from '../src/init';

test('stint init on the fixture copy writes .stint/config.json, the gitignore entries and the delimited section; running it twice changes nothing', async () => {
  await withFixtureRepo(async (repo) => {
    const { changed: first } = await init(repo);
    expect(first.sort()).toEqual(['.gitignore', '.stint/config.json', 'AGENTS.md']);
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('# Webhook service: notes for coding agents');
    expect(agents).toContain('<!-- stint:start -->');
    expect(agents).toContain('decision: <the decision>');
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('.stint/worktrees/');
    const snapshot = [readFileSync(join(repo, 'AGENTS.md'), 'utf8'), readFileSync(join(repo, '.gitignore'), 'utf8')];
    expect((await init(repo)).changed).toEqual([]);
    expect([readFileSync(join(repo, 'AGENTS.md'), 'utf8'), readFileSync(join(repo, '.gitignore'), 'utf8')]).toEqual(snapshot);
  });
});

test('init keeps the latest-merged line approve wrote, keeps a hand-edited section, and replaces it with --force', async () => {
  await withFixtureRepo(async (repo) => {
    await init(repo);
    const path = join(repo, 'AGENTS.md');
    const line = '- The latest merged task: T-0042, Limit webhooks. Read what it decided and left out with `stint packet T-0042 --as prompt`.';
    writeFileSync(path, readFileSync(path, 'utf8').replace('<!-- stint:end -->', `${line}\n<!-- stint:end -->`));
    expect(await init(repo)).toEqual({ changed: [], kept: false });
    expect(readFileSync(path, 'utf8')).toContain(line);

    writeFileSync(path, readFileSync(path, 'utf8').replace('Stint runs the tests itself', 'Our CI runs the tests'));
    expect((await init(repo)).kept).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('Our CI runs the tests');
    expect(await init(repo, { force: true })).toEqual({ changed: ['AGENTS.md'], kept: false });
    expect(readFileSync(path, 'utf8')).toContain('Stint runs the tests itself');
    expect(readFileSync(path, 'utf8')).toContain(line);
  });
});
