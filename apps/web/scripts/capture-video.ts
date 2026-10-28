// Records the demo video's footage: the replay played through the real daemon at 1.2x, the view switched on the
// replay's own clock to match docs/video.md, then the Factory and an end card. Silent 1920x1080; add the voiceover after.
// Usage, from the repository root: bun apps/web/scripts/capture-video.ts [--speed 1.2] [--out .loop/video]
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const root = resolve(import.meta.dir, '..', '..', '..');
const speed = Number(arg('speed', '1.2'));
const outDir = resolve(arg('out', join(root, '.loop', 'video')));
mkdirSync(outDir, { recursive: true });

/** The replay's position in recording seconds, read from the strip under the top bar ("playing, 0:40 of 2:35"). */
async function clock(page: Page): Promise<{ at: number; done: boolean }> {
  const text = (await page.getByTestId('replay-strip').textContent({ timeout: 2000 }).catch(() => '')) ?? '';
  const m = /(\d+):(\d\d) of/.exec(text);
  return { at: m ? Number(m[1]) * 60 + Number(m[2]) : -1, done: text.includes('finished') };
}

/** Waits until the replay reaches `seconds` of the recording, or has finished. */
async function at(page: Page, seconds: number): Promise<void> {
  for (;;) {
    const c = await clock(page);
    if (c.done || c.at >= seconds) return;
    await page.waitForTimeout(200);
  }
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
const nav = (page: Page, name: string) => page.getByRole('link', { name, exact: true }).first().click();
/** Opens a task from the board by its card, as a person would; a direct load if the card cannot be clicked. */
async function openTask(page: Page, url: string, id: string, title: RegExp) {
  await nav(page, 'Board').catch(() => undefined);
  await page.getByRole('link', { name: title }).first().click({ timeout: 3000 }).catch(() => page.goto(`${url}/t/${id}`));
  await page.waitForURL(`**/t/${id}**`);
}
async function scrollTo(page: Page, testId: string, dwellMs: number) {
  await page.getByTestId(testId).evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  await page.waitForTimeout(dwellMs);
}

const END_CARD = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#043051;color:#eef3f8;font-family:"Geist Variable","Geist",ui-sans-serif,system-ui,sans-serif}
body{display:grid;place-content:center;text-align:center;gap:18px}
h1{font-size:96px;margin:0;letter-spacing:-0.02em}p{margin:0;font-size:34px;color:#a7adb9}code{font-size:26px;color:#6b9dff}
</style><h1>Stint</h1><p>The task outlives the agent.</p><code>github.com/QuintinBotes/stint</code>`;

let daemon: ChildProcess | null = null;
const browser = await chromium.launch();
try {
  // a 1536x864 layout drawn at 1.25x fills 1080p with text a quarter larger and still sharp
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25, recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } } });
  const page = await context.newPage();
  // the daemon starts replaying as soon as it is up, so the board opens the moment its URL is printed
  const proc = spawn('bun', [join(root, 'packages', 'cli', 'bin', 'stint'), 'demo', '--speed', String(speed), '--keep'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  daemon = proc;
  const url = await new Promise<string>((ok, fail) => {
    let seen = '';
    proc.stdout?.on('data', (b: Buffer) => {
      seen += b.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+/.exec(seen);
      if (m) ok(m[0]);
    });
    proc.on('exit', () => fail(new Error('the demo daemon exited before printing its URL')));
  });
  await page.goto(url);
  await page.getByTestId('replay-strip').waitFor();

  // Beats on the recording's clock (seconds), from demo/recording.jsonl; at 1.2x they land on docs/video.md's times.
  await at(page, 11);
  await openTask(page, url, 'T-0042', /Rate-limit incoming webhooks per tenant/);
  await at(page, 14);
  await tab(page, 'Plan');
  await at(page, 40);
  await tab(page, 'Diff');
  await at(page, 60);
  await tab(page, 'Terminal');
  await at(page, 68);
  await tab(page, 'Packet');
  await at(page, 82);
  await tab(page, 'Diff');
  await at(page, 94);
  await tab(page, 'Verification');
  await at(page, 104);
  await tab(page, 'Review');
  // the skill is proposed at 129, measured at 131 and approved at 132; its card shows the eval with it and without
  await at(page, 129);
  await nav(page, 'Skills');
  const learned = page.locator('[data-list-skill="limiter-config-via-env"]');
  await learned.waitFor({ timeout: 20_000 }).catch(() => undefined);
  await learned.getByRole('button').first().click({ timeout: 3000 }).catch(() => undefined);
  await at(page, 141);
  await openTask(page, url, 'T-0043', /Rate-limit the admin API/);
  await at(page, 1e9);
  await page.waitForTimeout(1500);

  await nav(page, 'Factory');
  await page.getByTestId('models-at-work').waitFor();
  await page.waitForTimeout(5000);
  await scrollTo(page, 'models-at-work', 4500);
  await scrollTo(page, 'panel-bench', 6000);
  await scrollTo(page, 'any-harness', 5000);
  await page.setContent(END_CARD);
  await page.waitForTimeout(5000);

  const video = page.video();
  await context.close();
  const webm = join(outDir, `stint-replay-${speed}x.webm`);
  if (video) renameSync(await video.path(), webm);
  const mp4 = webm.replace(/\.webm$/, '.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  console.log(ff.status === 0 ? `Footage: ${mp4}` : `Footage: ${webm} (ffmpeg could not make the mp4)`);
} finally {
  await browser.close();
  daemon?.kill();
}
