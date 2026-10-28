// Solarized hell/dunkel: Einstellung, System, nach Neuladen
import { test, expect, COMPUTER } from './fixtures.mjs';
import { gehe, tab } from './hilfen.mjs';

test.use({ ...COMPUTER, colorScheme: 'light' });
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('Wie System, Hell, Dunkel; bleibt nach Neuladen', async ({ page }) => {
  await gehe(page, '');
  expect(await bg(page)).toBe('rgb(253, 246, 227)'); // Solarized base3
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg(page)).toBe('rgb(0, 43, 54)'); // Solarized base03
  await page.emulateMedia({ colorScheme: 'light' });
  await tab(page, 'settings');
  await page.click('[data-act=theme][data-value=dark]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg(page)).toBe('rgb(0, 43, 54)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await tab(page, 'settings');
  await page.click('[data-act=theme][data-value=light]');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg(page)).toBe('rgb(253, 246, 227)');
  await page.click('[data-act=theme][data-value=system]');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  expect(await bg(page)).toBe('rgb(0, 43, 54)');
});
