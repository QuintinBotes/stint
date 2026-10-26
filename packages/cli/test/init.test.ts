import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFixtureRepo } from '../../core/test/fixture';
import { init } from '../src/init';

test('stint init on the fixture copy writes .stint/config.json, the gitignore entries and the delimited section; running it twice changes nothing', async () => {
  await withFixtureRepo(async (repo) => {
    const first = await init(repo);
    expect(first.sort()).toEqual(['.gitignore', '.stint/config.json', 'AGENTS.md']);
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('# Webhook service: notes for coding agents');
    expect(agents).toContain('<!-- stint:start -->');
    expect(agents).toContain('decision: <the decision>');
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('.stint/worktrees/');
    const snapshot = [readFileSync(join(repo, 'AGENTS.md'), 'utf8'), readFileSync(join(repo, '.gitignore'), 'utf8')];
    expect(await init(repo)).toEqual([]);
    expect([readFileSync(join(repo, 'AGENTS.md'), 'utf8'), readFileSync(join(repo, '.gitignore'), 'utf8')]).toEqual(snapshot);
  });
});
