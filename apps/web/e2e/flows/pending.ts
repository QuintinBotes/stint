// Holds a mutation's requests in the browser until the test lets them go, counting them, so a test can press a button
// again while the first request is still running and see that only one reached the daemon.
import type { Page } from '@playwright/test';

export async function holdRequests(page: Page, url: string, method = 'POST') {
  let count = 0;
  let release = () => {};
  const gate = new Promise<void>((go) => {
    release = go;
  });
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    count += 1;
    await gate;
    await route.continue();
  });
  return { count: () => count, release };
}
