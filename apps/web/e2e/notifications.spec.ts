import { expect, test } from '@playwright/test';

test('The palette asks for desktop notification permission and the sound choice is remembered', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as { __permAsked: number; Notification: unknown };
    win.__permAsked = 0;
    class FakeNotification {
      static permission = 'default';
      static async requestPermission(): Promise<string> {
        win.__permAsked += 1;
        FakeNotification.permission = 'granted';
        return 'granted';
      }
      onclick: (() => void) | null = null;
      constructor(
        readonly title: string,
        readonly options?: unknown,
      ) {}
    }
    win.Notification = FakeNotification;
  });
  await page.goto('/');

  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Type a command or a task').fill('desktop notifications');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __permAsked: number }).__permAsked)).toBe(1);
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');

  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Type a command or a task').fill('Turn sound off');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => {
    try {
      return localStorage.getItem('stint.sound');
    } catch {
      return null;
    }
  })).toBe('off');

  await page.reload();
  await page.keyboard.press('Meta+k');
  await expect(page.getByText('Turn sound on')).toBeVisible();
  await page.keyboard.press('Escape');
});
