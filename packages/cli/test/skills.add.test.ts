import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { tempDir, withFixtureRepo } from '../../core/test/fixture';

const bin = join(import.meta.dir, '..', 'bin', 'stint');

async function runCli(args: string[], cwd?: string): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(['bun', bin, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

const skillMd = (id: string, body: string) =>
  ['---', `name: ${id}`, `description: "Use when ${id} applies."`, 'roles: [implementer]', 'tags: [widgets]', '---', '', `# ${id}`, '', body, ''].join('\n');

function skillFolder(base: string, id: string): string {
  const dir = join(base, id);
  mkdirSync(join(dir, 'references'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMd(id, 'Check the widget before you change it.'));
  writeFileSync(join(dir, 'references', 'widget.md'), 'Widget background.\n');
  return dir;
}

const proposalJson = (repo: string, id: string) =>
  JSON.parse(readFileSync(join(repo, '.stint', 'cache', 'proposals', id, 'proposal.json'), 'utf8')) as { origin: string; source: { kind: string; ref: string; commit?: string }; digest: string };

const queued = async (repo: string) => {
  const r = await runCli(['skills', 'list', '--repo', repo, '--json']);
  expect(r.code, r.err).toBe(0);
  return JSON.parse(r.out) as Array<{ id: string; origin: string; status: string }>;
};

test('stint skills add works from a folder, a SKILL.md, a zip, and a file:// git URL with #ref:subpath built in a temporary bare repository, and records the commit in source', async () => {
  await withFixtureRepo(async (repo) => {
    const scratch = tempDir('stint-skills-add-');
    const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
    try {
      // from a folder
      const folder = skillFolder(scratch.dir, 'acme-folder-rule');
      const fromFolder = await runCli(['skills', 'add', folder, '--repo', repo]);
      expect(fromFolder.code, fromFolder.err).toBe(0);
      expect(fromFolder.out).toContain('Queued acme-folder-rule for review');
      expect(proposalJson(repo, 'acme-folder-rule')).toMatchObject({ origin: 'import', source: { kind: 'folder' } });
      expect(existsSync(join(repo, '.agents', 'skills', 'acme-folder-rule'))).toBe(false);

      // from a SKILL.md file
      const file = join(skillFolder(scratch.dir, 'acme-file-rule'), 'SKILL.md');
      const fromFile = await runCli(['skills', 'add', file, '--repo', repo]);
      expect(fromFile.code, fromFile.err).toBe(0);
      expect(proposalJson(repo, 'acme-file-rule').origin).toBe('import');

      // from a zip
      const zipDir = skillFolder(scratch.dir, 'acme-zip-rule');
      const zipPath = join(scratch.dir, 'acme-zip-rule.zip');
      expect(Bun.spawnSync(['zip', '-qr', zipPath, '.'], { cwd: zipDir }).exitCode).toBe(0);
      const fromZip = await runCli(['skills', 'add', zipPath, '--repo', repo]);
      expect(fromZip.code, fromZip.err).toBe(0);
      expect(proposalJson(repo, 'acme-zip-rule')).toMatchObject({ origin: 'import', source: { kind: 'zip' } });

      // from a file:// git URL at a ref and subpath, out of a temporary bare repository
      const source = join(scratch.dir, 'globex-skills-repo');
      skillFolder(join(source, 'skills'), 'globex-git-rule');
      const git = (...args: string[]) => Bun.spawnSync(['git', '-C', source, ...args], { stdout: 'pipe', stderr: 'pipe' });
      expect(Bun.spawnSync(['git', 'init', '-q', '-b', 'main', source]).exitCode).toBe(0);
      git('config', 'user.name', 'Stint Test');
      git('config', 'user.email', 'test@example.com');
      git('config', 'commit.gpgsign', 'false');
      git('add', '-A');
      expect(git('commit', '-q', '-m', 'globex skills').exitCode).toBe(0);
      const commit = git('rev-parse', 'HEAD').stdout.toString().trim();
      const bare = join(scratch.dir, 'globex-skills.git');
      expect(Bun.spawnSync(['git', 'clone', '-q', '--bare', source, bare]).exitCode).toBe(0);

      const fromGit = await runCli(['skills', 'add', `file://${bare}#main:skills/globex-git-rule`, '--repo', repo]);
      expect(fromGit.code, fromGit.err).toBe(0);
      const held = proposalJson(repo, 'globex-git-rule');
      expect(held.origin).toBe('import');
      expect(held.source.kind).toBe('git');
      expect(held.source.commit).toBe(commit);
      expect(held.source.ref).toContain('#main:skills/globex-git-rule');

      const rows = await queued(repo);
      for (const id of ['acme-folder-rule', 'acme-file-rule', 'acme-zip-rule', 'globex-git-rule']) {
        expect(rows.find((s) => s.id === id), id).toMatchObject({ origin: 'import', status: 'proposed' });
        expect(existsSync(join(repo, '.agents', 'skills', id))).toBe(false);
      }

      // approve --ack and export over the CLI
      const warnDir = join(scratch.dir, 'globex-warn-rule');
      mkdirSync(join(warnDir, 'scripts'), { recursive: true });
      writeFileSync(join(warnDir, 'SKILL.md'), skillMd('globex-warn-rule', 'Use the helper script.'));
      writeFileSync(join(warnDir, 'scripts', 'go.sh'), 'echo go\n');
      const added = await runCli(['skills', 'add', warnDir, '--repo', repo]);
      expect(added.code, added.err).toBe(0);
      expect(added.out).toContain('--ack executable-script');
      const refused = await runCli(['skills', 'approve', 'globex-warn-rule', '--repo', repo]);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('skill_unacknowledged');
      const approved = await runCli(['skills', 'approve', 'globex-warn-rule', '--ack', 'executable-script', '--repo', repo]);
      expect(approved.code, approved.err).toBe(0);
      expect(existsSync(join(repo, '.agents', 'skills', 'globex-warn-rule', 'scripts', 'go.sh'))).toBe(true);

      const out = join(scratch.dir, 'shared.zip');
      const exported = await runCli(['skills', 'export', 'globex-warn-rule', '--out', out, '--repo', repo]);
      expect(exported.code, exported.err).toBe(0);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out).subarray(0, 2).toString()).toBe('PK');

      // skills new writes an editor proposal
      const created = await runCli(['skills', 'new', 'acme-written-rule', '--description', 'Use when writing acme release notes.', '--tags', 'release', '--repo', repo]);
      expect(created.code, created.err).toBe(0);
      expect(proposalJson(repo, 'acme-written-rule')).toMatchObject({ origin: 'human', source: { kind: 'editor' } });
    } finally {
      await d.stop();
      scratch.cleanup();
    }
  });
}, 120_000);
