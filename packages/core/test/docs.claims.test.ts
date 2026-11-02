import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { countTokens, renderHandoff } from '../src/index';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const proofs = readFileSync(join(root, 'docs', 'proofs.md'), 'utf8');

/** Claims the README makes that a reader can check, each tied to something in the repository. */
export function readmeProblems(text: string): string[] {
  const problems: string[] = [];
  for (const path of new Set(text.match(/packages\/[\w./-]+\.test\.ts/g) ?? [])) if (!existsSync(join(root, path))) problems.push(`cites ${path}, which does not exist`);
  for (const link of new Set([...text.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1] as string))) if (!/^https?:/.test(link) && !existsSync(join(root, link))) problems.push(`links to ${link}, which does not exist`);
  for (const img of new Set([...text.matchAll(/src="([^"]+)"/g)].map((m) => m[1] as string))) if (!existsSync(join(root, img))) problems.push(`shows ${img}, which does not exist`);
  // the killed packet's size must be the size the recording reports
  const packet = /packet is (\d+) tokens/.exec(text)?.[1];
  const recorded = [...readFileSync(join(root, 'demo', 'recording.jsonl'), 'utf8').matchAll(/"type":"handoff\.created".*?"tokens":(\d+)/g)].map((m) => m[1]);
  if (packet && !recorded.includes(packet)) problems.push(`says the packet is ${packet} tokens; the recording has ${recorded.join(', ')}`);
  problems.push(...summaryProblems(text), ...readmeNovemberProblems(text));
  return problems;
}

type Mode = { runs: number; meanPromptTokens: number; meanInputTokens: number; meanUsd: number | null; passRate: number };
const json = <T>(path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
const n = (s: string) => Number(s.replace(/[,$]/g, ''));

/** The README's one-line summaries of docs/proofs.md and the quick start time, against the files they come from. */
export function summaryProblems(text: string): string[] {
  const problems: string[] = [];
  const quick = json<{ seconds: number; runs: Array<{ seconds: number }> }>('bench/quickstart.json');
  if (quick.seconds !== Math.max(...quick.runs.map((r) => r.seconds))) problems.push(`bench/quickstart.json says ${quick.seconds} s; its slowest run took ${Math.max(...quick.runs.map((r) => r.seconds))} s`);
  const said = /these steps take about (\d+) seconds/.exec(text)?.[1];
  if (Number(said) !== quick.seconds) problems.push(`says the quick start takes about ${said} seconds; CI measured ${quick.seconds}`);
  const bench = json<{ byMode: Record<string, Mode> }>('bench/results.json').byMode;
  const digest = json<{ byMode: Record<string, Mode> }>('bench/digest/results.json').byMode;
  const green = (m: Mode | undefined) => (m ? Math.round(m.passRate * m.runs) : 0);
  const [t, p, d] = [bench.transcript, bench.packet, digest.packet];
  const line = /packets (\d+) times smaller than transcripts, (\d+) of (\d+) continued runs green against (\d+) of (\d+)/.exec(text);
  if (!line || !t || !p || !d) problems.push('the benchmark summary line is missing');
  else {
    const [, times, pOk, pAll, tOk, tAll] = line.map(Number);
    if (times !== Math.round(t.meanPromptTokens / ((p.meanPromptTokens + d.meanPromptTokens) / 2))) problems.push(`says packets are ${times} times smaller; the results give ${Math.round(t.meanPromptTokens / ((p.meanPromptTokens + d.meanPromptTokens) / 2))}`);
    if (pOk !== green(p) + green(d) || pAll !== p.runs + d.runs) problems.push(`says ${pOk} of ${pAll} packet runs green; the results give ${green(p) + green(d)} of ${p.runs + d.runs}`);
    if (tOk !== green(t) || tAll !== t.runs) problems.push(`says ${tOk} of ${tAll} transcript runs green; the results give ${green(t)} of ${t.runs}`);
  }
  return problems;
}

/** The live numbers docs/proofs.md quotes, each checked against the result file it came from (R-056, R-059). */
export function measuredProblems(text: string): string[] {
  const problems: string[] = [];
  const bench = json<{ byMode: Record<string, Mode> }>('bench/results.json');
  const digest = json<{ byMode: Record<string, Mode> }>('bench/digest/results.json');
  const rows: Array<[string, Mode | undefined]> = [
    ['the transcript', bench.byMode.transcript],
    ['the packet', bench.byMode.packet],
    ['the packet, again with the digest on', digest.byMode.packet],
  ];
  for (const [label, m] of rows) {
    const row = new RegExp(`^\\| ${label} \\| ([\\d,]+) tokens \\| ([\\d,]+) \\| \\$([\\d.]+) \\| (\\d+) of (\\d+) \\|$`, 'm').exec(text);
    if (!row || !m) {
      problems.push(`the bench table has no row for ${label}`);
      continue;
    }
    const [, prompt, input, usd, passed, runs] = row as unknown as string[];
    if (n(prompt as string) !== Math.round(m.meanPromptTokens)) problems.push(`${label}: hand-over prompt ${prompt}, results say ${Math.round(m.meanPromptTokens)}`);
    if (n(input as string) !== Math.round(m.meanInputTokens)) problems.push(`${label}: input ${input}, results say ${Math.round(m.meanInputTokens)}`);
    if (m.meanUsd === null || Math.abs(n(usd as string) - m.meanUsd) > 0.0005 + 1e-9) problems.push(`${label}: cost $${usd}, results say ${m.meanUsd}`);
    if (Number(passed) !== Math.round(m.passRate * m.runs) || Number(runs) !== m.runs) problems.push(`${label}: ${passed} of ${runs} green, results say ${Math.round(m.passRate * m.runs)} of ${m.runs}`);
  }
  const golden = json<{ passAt1: number; passPowK: number; k: number; cost: { usd: number }; tasks: Array<{ runs: unknown[] }> }>('bench/golden-results.json');
  const tries = golden.tasks.reduce((s, t) => s + t.runs.length, 0);
  const line = /The golden set: (\d+) of (\d+) tries passed, pass\^(\d+) (\d+)%, \$([\d.]+)/.exec(text);
  if (!line) problems.push('the golden line is missing');
  else {
    const [, ok, all, k, powk, usd] = line;
    if (Number(all) !== tries || Number(ok) !== Math.round(golden.passAt1 * tries)) problems.push(`golden: ${ok} of ${all}, results say ${Math.round(golden.passAt1 * tries)} of ${tries}`);
    if (Number(k) !== golden.k || Number(powk) !== Math.round(golden.passPowK * 100)) problems.push(`golden: pass^${k} ${powk}%, results say pass^${golden.k} ${Math.round(golden.passPowK * 100)}%`);
    if (Math.abs(Number(usd) - golden.cost.usd) > 0.005 + 1e-9) problems.push(`golden: $${usd}, results say ${golden.cost.usd}`);
  }
  // the live packet shown inline is the stored one, rendered, at the size the README says
  const shown = /<summary>The live packet, as the next agent read it<\/summary>\n\n```\n([\s\S]*?)```/.exec(text)?.[1];
  const stored = renderHandoff(json('bench/digest/runs/bench-01-rate-limit-packet/handoff.json'));
  if (shown === undefined || shown.trimEnd() !== stored.trimEnd()) problems.push('the live packet in the README is not the stored one, rendered');
  const said = /from these (\d+) tokens/.exec(text)?.[1];
  if (Number(said) !== countTokens(stored)) problems.push(`says the live packet is ${said} tokens; it renders to ${countTokens(stored)}`);
  return problems;
}

type Row = { mode: string; verified: boolean; scenarios?: { passed: number; failed: number }; inputTokens: number; cachedTokens: number; usd: number | null };
type Tally = { runs: number; heldOut: number; green: number; prompt: number; input: number; cachedPct: number; usd: number };
const LABEL: Record<string, string> = { packet: 'the packet', transcript: 'the transcript', diff: 'the task and the diff', resume: 'its own session (Muse Code)' };
const usd4 = (x: number) => Math.round(x * 1e4) / 1e4;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each mode of a 2 November rerun, summed from its rows: runs whose held-out tests all passed, the daemon's green verdicts, the hand-over size, input, cached share and cost. */
export function tally(path: string): Record<string, Tally> {
  const bench = json<{ rows: Row[]; byMode: Record<string, Mode> }>(path);
  const out: Record<string, Tally> = {};
  for (const [mode, m] of Object.entries(bench.byMode)) {
    const rows = bench.rows.filter((r) => r.mode === mode);
    const input = rows.reduce((s, r) => s + r.inputTokens, 0);
    out[mode] = {
      runs: rows.length,
      heldOut: rows.filter((r) => r.scenarios !== undefined && r.scenarios.passed > 0 && r.scenarios.failed === 0).length,
      green: rows.filter((r) => r.verified).length,
      prompt: Math.round(m.meanPromptTokens),
      input,
      cachedPct: Math.round((100 * rows.reduce((s, r) => s + r.cachedTokens, 0)) / input),
      // an unpriced row makes the sum NaN, so a cost cited for it fails
      usd: usd4(rows.reduce((s, r) => s + (r.usd ?? Number.NaN), 0)),
    };
  }
  return out;
}

const every = (t: Record<string, Tally>, f: (m: Tally) => boolean) => Object.values(t).every(f);
const fair = () => tally('bench/fair/results.json');
const unfinished = () => tally('bench/fair-unfinished/results.json');
const recheck = () => json<{ spendUsd: number; tables: Record<string, { caught: number; red: number; wronglyBlocked: number; green: number }> }>('bench/review-recheck/verdicts.json');
const visualSet = () =>
  json<{ totalUsd: number; table: Record<string, number>; pages: Array<{ id: string; kind: string; cost: { usd: number }; judge: { cost: { usd: number } } | null; mark: { cost: { usd: number } } | null }> }>('bench/visual-set/results.json');

/** A sentence whose numbers must be the ones the results give, or a phrase that must be there and that the results must bear out (false). */
type Claim = [what: string, re: RegExp, want: number[] | boolean];
function claimProblems(text: string, claims: Claim[]): string[] {
  const problems: string[] = [];
  for (const [what, re, want] of claims) {
    const m = re.exec(text);
    if (!m) problems.push(`${what}: the sentence is missing`);
    else if (want === false) problems.push(`${what}: the results do not bear it out`);
    else if (Array.isArray(want) && m.slice(1).map(n).join() !== want.join()) problems.push(`${what}: says ${m.slice(1).join(', ')}; the results give ${want.join(', ')}`);
  }
  return problems;
}

/** The README's 2 November claims: the fair rerun, the unfinished rerun, the review recheck and the visual set. */
export function readmeNovemberProblems(text: string): string[] {
  const [f, u, spark, v] = [fair(), unfinished(), recheck().tables['meta-api/muse-spark-1.3'], visualSet().table];
  if (!f.packet || !f.transcript || !f.diff || !u.packet || !u.resume || !spark) return ['a 2 November results file has lost a mode or a reviewer'];
  const packetUsd = u.packet.usd;
  return claimProblems(text, [
    ['the hand-over sizes', /\(([\d,]+) tokens against ([\d,]+) for the transcript, by Stint's estimate\)/, [f.packet.prompt, f.transcript.prompt]],
    ["the daemon's verdicts", /cleared the daemon's verification \((\d+) of (\d+), against (\d+) from the transcript and (\d+) from the task and the diff\)/, [f.packet.green, f.packet.runs, f.transcript.green, f.diff.green]],
    ['the held-out tests from one shared start', /every mode's code passed the held-out tests/, every(f, (m) => m.heldOut === m.runs)],
    ['the held-out tests from unfinished checkpoints', /from genuinely unfinished checkpoints every mode finished the code, Muse Code resuming its own session included/, every(u, (m) => m.heldOut === m.runs)],
    ['the dearest mode', /and the packet was the dearest/, every(u, (m) => m.usd <= packetUsd)],
    ['the review recheck', /a recheck on Muse Spark 1\.3 flagged (\d+) of (\d+)/, [spark.caught, spark.red]],
    ['the visual set', /Muse Spark caught (\d+) of (\d+) seeded defects and failed none of (\d+) clean ones/, v.cleanWronglyFailed === 0 && [v.defectsCaught ?? 0, v.defects ?? 0, v.clean ?? 0]],
  ]);
}

/** The 2 November numbers docs/proofs.md cites: both rerun tables and their totals, the claims at a glance, the review recheck and the visual set. */
export function novemberProblems(text: string): string[] {
  const problems: string[] = [];
  const section = (heading: string) => {
    const at = text.indexOf(`\n${heading}\n`);
    if (at < 0) return '';
    const rest = text.slice(at + heading.length + 2);
    const end = rest.search(/\n#{2,3} /);
    return end < 0 ? rest : rest.slice(0, end);
  };
  for (const [heading, file, spendFile] of [
    ['### The fair rerun, 2 November', 'bench/fair/results.json', 'bench/fair/spend.json'],
    ['### The unfinished rerun, 2 November', 'bench/fair-unfinished/results.json', 'bench/fair-unfinished/spend.json'],
  ] as const) {
    const body = section(heading);
    const name = heading.slice(4);
    if (!body) {
      problems.push(`${name}: the section is missing`);
      continue;
    }
    const modes = tally(file);
    for (const [mode, t] of Object.entries(modes)) {
      const label = `${name}, ${LABEL[mode] ?? mode}`;
      const row = new RegExp(`^\\| ${escape(LABEL[mode] ?? mode)} \\| (\\d+) of (\\d+) \\| (\\d+) of (\\d+) \\| ([\\d,]+) tokens[^|]*\\| ([\\d,]+)(?:, (\\d+)% cached)? \\| \\$([\\d.]+) \\|$`, 'm').exec(body);
      if (!row) {
        problems.push(`${label}: the table has no row`);
        continue;
      }
      const [, held, heldOf, green, greenOf, prompt, input, cached, usd] = row as unknown as string[];
      if (Number(held) !== t.heldOut || Number(heldOf) !== t.runs) problems.push(`${label}: held-out tests passed ${held} of ${heldOf}, results say ${t.heldOut} of ${t.runs}`);
      if (Number(green) !== t.green || Number(greenOf) !== t.runs) problems.push(`${label}: verdict green ${green} of ${greenOf}, results say ${t.green} of ${t.runs}`);
      if (n(prompt as string) !== t.prompt) problems.push(`${label}: hand-over ${prompt} tokens, results say ${t.prompt}`);
      if (n(input as string) !== t.input) problems.push(`${label}: input ${input}, results say ${t.input}`);
      if (cached !== undefined && Number(cached) !== t.cachedPct) problems.push(`${label}: ${cached}% cached, results say ${t.cachedPct}%`);
      if (Number(usd) !== t.usd) problems.push(`${label}: cost $${usd}, results say ${t.usd}`);
    }
    const runs = Object.values(modes)[0]?.runs;
    for (const re of [/Input tokens, all (\d+) runs/, /Cost, (\d+) runs/]) {
      const said = re.exec(body)?.[1];
      if (Number(said) !== runs) problems.push(`${name}: the table header says ${said} runs, results say ${runs}`);
    }
    const total = /The rerun[^.]*? cost \$(\d+\.\d+)/.exec(body)?.[1];
    const spend = json<{ totalUsd: number }>(spendFile).totalUsd;
    if (Number(total) !== spend) problems.push(`${name}: says the rerun cost $${total}; ${spendFile} says ${spend}`);
  }

  const [f, u, rc, vs] = [fair(), unfinished(), recheck(), visualSet()];
  const [spark, glimmer] = [rc.tables['meta-api/muse-spark-1.3'], rc.tables['recorded glimmer']];
  if (!f.packet || !f.transcript || !f.diff || !u.resume || !spark || !glimmer) return [...problems, 'a 2 November results file has lost a mode or a reviewer'];
  for (const [label, t, cost] of [
    ['Muse Glimmer 30B, offline, 29 October', glimmer, 0],
    ['Muse Spark 1.3, Meta Model API, 2 November', spark, rc.spendUsd],
  ] as const) {
    const row = new RegExp(`^\\| ${escape(label)} \\| (\\d+) of (\\d+) \\| (\\d+) of (\\d+) \\| \\$([\\d.]+) \\|$`, 'm').exec(text);
    const want = [t.caught, t.red, t.wronglyBlocked, t.green, cost].join();
    if (!row) problems.push(`the review recheck has no row for ${label}`);
    else if (row.slice(1).map(Number).join() !== want) problems.push(`the review recheck, ${label}: says ${row.slice(1).join(', ')}; verdicts.json gives ${want}`);
  }

  const v = vs.table;
  for (const p of vs.pages.filter((p) => p.kind === 'defect')) {
    const cost = new RegExp(`^\\| \`${escape(p.id)}\` \\|.*\\| \\$([\\d.]+) \\|$`, 'm').exec(text)?.[1];
    if (Number(cost) !== p.cost.usd) problems.push(`the visual set, ${p.id}: says $${cost}; results say ${p.cost.usd}`);
  }
  const judge = usd4(vs.pages.reduce((s, p) => s + (p.judge?.cost.usd ?? 0), 0));
  const mark = usd4(vs.pages.reduce((s, p) => s + (p.mark?.cost.usd ?? 0), 0));
  const clean = usd4(vs.pages.filter((p) => p.kind === 'clean').reduce((s, p) => s + p.cost.usd, 0));
  const onTarget = v.boxesOnTarget === 2 ? 'both' : String(v.boxesOnTarget);
  problems.push(
    ...claimProblems(text, [
      ['the claims, hand-over sizes', /From one shared start, 2 November: ([\d,]+) hand-over tokens against ([\d,]+) for the transcript and ([\d,]+) for the task and the diff/, [f.packet.prompt, f.transcript.prompt, f.diff.prompt]],
      ['the claims, resume', /Muse Code resuming its own session is sent (\d+) tokens/, [u.resume.prompt]],
      [
        "the claims, the daemon's verdicts",
        /the daemon's verdict green (\d+) of (\d+) from the packet, (\d+) of (\d+) from the transcript, (\d+) of (\d+) from the task and the diff, with the held-out tests passed (\d+) of (\d+) in every mode/,
        every(f, (m) => m.heldOut === m.runs) && [f.packet.green, f.packet.runs, f.transcript.green, f.transcript.runs, f.diff.green, f.diff.runs, f.packet.heldOut, f.packet.runs],
      ],
      ['the claims, the review recheck', /Muse Spark 1\.3 flagged (\d+) of the (\d+) failing patches and none of the (\d+) passing ones/, spark.wronglyBlocked === 0 && [spark.caught, spark.red, spark.green]],
      [
        'the claims, the visual set',
        /Muse Spark 1\.3 failed (\d+) of (\d+) seeded defects and none of (\d+) clean pages; SAM 3\.1 boxed (\d+) of the (\d+) it caught, both on the seeded element, for \$([\d.]+)/,
        v.cleanWronglyFailed === 0 && v.boxesOnTarget === v.defectsBoxed && [v.defectsCaught ?? 0, v.defects ?? 0, v.clean ?? 0, v.defectsBoxed ?? 0, v.defectsCaught ?? 0, vs.totalUsd],
      ],
      [
        'what is real, the visual set',
        new RegExp(`The visual gate on ten pages: (\\d+) of (\\d+) seeded defects caught, (\\d+) of (\\d+) clean pages failed, (\\d+) boxes drawn, ${onTarget} on target, \\$([\\d.]+)`),
        vs.pages.length === 10 && [v.defectsCaught ?? 0, v.defects ?? 0, v.cleanWronglyFailed ?? 0, v.clean ?? 0, v.defectsBoxed ?? 0, vs.totalUsd],
      ],
      ['the visual set, its cost', /The ten checks cost \$([\d.]+): \$([\d.]+) for Muse Spark and \$([\d.]+) for SAM/, [vs.totalUsd, judge, mark]],
      ['the visual set, the clean pages', /^\| five clean pages \|.*\| \$([\d.]+) \|$/m, [clean]],
    ]),
  );
  return problems;
}

test('every test, link, image and packet size the README cites exists in the repository', () => {
  expect(readmeProblems(readme)).toEqual([]);
});

test('R-059 Acceptance 7: the measured numbers in docs/proofs.md match their results files, and fail the check when one is changed by hand', () => {
  expect(measuredProblems(proofs)).toEqual([]);
  expect(measuredProblems(proofs.replace(/(\| the transcript \| )[\d,]+ tokens/, '$14,000 tokens'))).toEqual([expect.stringContaining('hand-over prompt 4,000')]);
  expect(measuredProblems(proofs.replace(/9 of 9 tries/, '8 of 9 tries'))).toEqual([expect.stringContaining('golden: 8 of 9')]);
  expect(measuredProblems(proofs.replace(/from these \d+ tokens/, 'from these 300 tokens'))).toEqual([expect.stringContaining('300 tokens')]);
});

test('the check fails when a README number is changed by hand', () => {
  expect(readmeProblems(readme.replace(/packet is \d+ tokens/, 'packet is 99 tokens'))).toEqual([expect.stringContaining('says the packet is 99 tokens')]);
  expect(readmeProblems(`${readme}\nSee packages/daemon/test/nothing.test.ts.`)).toEqual([expect.stringContaining('nothing.test.ts')]);
  expect(readmeProblems(readme.replace(/take about \d+ seconds/, 'take about 5 seconds'))).toEqual([expect.stringContaining('CI measured')]);
  expect(readmeProblems(readme.replace(/9 of 10 continued runs/, '10 of 10 continued runs'))).toEqual([expect.stringContaining('10 of 10 packet runs')]);
});

test('the 2 November numbers in docs/proofs.md match bench/fair, bench/fair-unfinished, bench/review-recheck and bench/visual-set', () => {
  expect(novemberProblems(proofs)).toEqual([]);
});

test('the 2 November check fails when a number in docs/proofs.md or the README is changed by hand', () => {
  expect(novemberProblems(proofs.replace('| 320,731 |', '| 320,000 |'))).toEqual(['The fair rerun, 2 November, the packet: input 320,000, results say 320731']);
  expect(novemberProblems(proofs.replace(/(\| the task and the diff \| 4 of 4 \| )4 of 4/, '$13 of 4'))).toEqual([expect.stringContaining('the task and the diff: verdict green 3 of 4')]);
  expect(novemberProblems(proofs.replace('88% cached', '90% cached'))).toEqual([expect.stringContaining('90% cached, results say 88%')]);
  expect(novemberProblems(proofs.replace('The rerun cost $2.4059', 'The rerun cost $2.0000'))).toEqual([expect.stringContaining('says the rerun cost $2.0000')]);
  expect(novemberProblems(proofs.replace('| 5 of 15 | 0 of 3 |', '| 6 of 15 | 0 of 3 |'))).toEqual([expect.stringContaining('the review recheck, Muse Spark 1.3')]);
  expect(novemberProblems(proofs.replace('$0.0389 for Muse Spark', '$0.0400 for Muse Spark'))).toEqual([expect.stringContaining('the visual set, its cost')]);
  expect(readmeProblems(readme.replace('(864 tokens against', '(800 tokens against'))).toEqual(['the hand-over sizes: says 800, 5,124; the results give 864, 5124']);
  expect(readmeProblems(readme.replace('against 7 from the transcript', 'against 8 from the transcript'))).toEqual([expect.stringContaining("the daemon's verdicts: says 10, 10, 8, 4")]);
  expect(readmeProblems(readme.replace('caught 4 of 5 seeded', 'caught 5 of 5 seeded'))).toEqual([expect.stringContaining('the visual set: says 5, 5, 5')]);
  expect(readmeProblems(readme.replace('the packet was the dearest', 'the packet was the cheapest'))).toEqual(['the dearest mode: the sentence is missing']);
});
