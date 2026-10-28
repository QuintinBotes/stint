import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { OutcomeSchema } from '@stint-dev/core';
import { report } from '../src/report';
import { withReplay } from './replay';

const bin = join(import.meta.dir, '..', 'bin', 'stint');
const stint = (args: string[]) => Bun.spawnSync(['bun', bin, ...args], { stdout: 'pipe', stderr: 'pipe' });

test('R-063: stint outcome prints the result, one line per criterion with its evidence, loops, spend, times, review and after merge', async () => {
  await withReplay(async (root) => {
    const gate = stint(['outcome', 'T-0043', '--repo', root]);
    expect(gate.exitCode, gate.stderr.toString()).toBe(0);
    const lines = gate.stdout.toString().trimEnd().split('\n');
    expect(lines[0]).toBe('T-0043: Waiting for you');
    expect(lines[1]).toBe('  1. Passes, not proven: The admin API answers 429 with Retry-After over the limit');
    expect(lines[2]).toBe('     The tests pass in r1, but no test showed it failing first.');
    expect(lines[3]).toBe('  2. Passes, not proven: The suite stays green');
    expect(lines).toContain('Loops: 1 build of 8, 0 hand-offs of 3, 0 review rounds of 1');
    expect(lines.find((l) => l.startsWith('Spend: '))).toStartWith('Spend: $0.13; agent time ');
    expect(lines.find((l) => l.startsWith('Times: '))).toContain('green after ');
    expect(lines).toContain('Review: 1 round (approve), 0 findings');
    expect(lines.at(-1)).toBe('After merge: not merged yet');

    const merged = stint(['outcome', 'T-0042', '--repo', root]).stdout.toString();
    expect(merged).toStartWith('T-0042: Merged\n');
    expect(merged).toContain('After merge, within 7 days:\n  Reverted: no\n  Follow-ups: none\n  CI: no failure recorded\n  Incidents: none\n  Watching for reverts and follow-ups until ');
    expect(merged).toContain('Review: 1 round (approve), 2 findings');

    const json = stint(['outcome', 'T-0042', '--repo', root, '--json']);
    expect(OutcomeSchema.parse(JSON.parse(json.stdout.toString())).task).toBe('T-0042');
    const unknown = stint(['outcome', 'T-9999', '--repo', root]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr.toString()).toContain('T-9999');

    // stint report: every review row ends with its task's outcome
    const r = await report(root);
    expect(r.reviews.filter((l) => l.startsWith('| T-0042 |')).every((l) => l.endsWith('| Merged |'))).toBe(true);
    expect(r.reviews.filter((l) => l.startsWith('| T-0043 |')).every((l) => l.endsWith('| Waiting for you |'))).toBe(true);
  });
}, 120_000);
