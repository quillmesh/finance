// TAG-06, TAG-11, NF-07: auf dem Handy mit echten Touch-Ereignissen bedienbar, alle Kategorien ohne Scrollen sichtbar
import { test, expect, HANDY } from './fixtures.mjs';
import { gehe, keinQuerScrollen } from './hilfen.mjs';

test.use(HANDY);

/** Unterster Kategorie-Knopf liegt im sichtbaren Bereich, ohne gescrollt zu haben */
const alleSichtbar = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll('#catgrid .catbtn')];
  return window.scrollY === 0 && b.length > 0 && Math.max(...b.map((x) => x.getBoundingClientRect().bottom)) <= window.innerHeight;
});

test('Test-App auf dem Handy: alle Kategorien sichtbar, taggen per Antippen, alle Ansichten ohne Querscrollen', async ({ page }) => {
  await gehe(page, 'test/');
  await expect(page.locator('#txcard')).toBeVisible();
  // eine private Ausgabe suchen (dort gibt es den Schalter Nur ich / Geteilt)
  for (let i = 0; i < 40 && !(await page.locator('#shareBox').count()); i++) await page.locator('[data-act=skip]').tap();
  await expect(page.locator('#shareBox')).toBeVisible();
  expect(await alleSichtbar(page), 'Nur ich: alle Kategorien sichtbar').toBe(true);
  await page.locator('[data-act=share][data-v="6667"]').tap();
  expect(await alleSichtbar(page), 'geteilt (mehr Kategorien): alle sichtbar').toBe(true);
  await page.locator('[data-act=shareInd]').tap();
  expect(await alleSichtbar(page), 'individuell: alle sichtbar').toBe(true);
  const vorher = await page.locator('#openBadge').textContent();
  await page.locator('.catbtn[data-act=pickCat]').first().tap();
  expect(await alleSichtbar(page), 'Unterkategorien sichtbar').toBe(true);
  await page.locator('.catbtn[data-act=pickSub]').first().tap();
  await expect(page.locator('#openBadge')).not.toHaveText(vorher);
  for (const t of ['import', 'tag', 'overview', 'list', 'manual', 'settings']) {
    await page.locator(`nav button[data-tab=${t}]`).tap();
    await expect(page.locator(`#view-${t}`)).toBeVisible();
    expect(await keinQuerScrollen(page), `kein Querscrollen: ${t}`).toBe(true);
  }
  await page.locator('nav button[data-tab=overview]').tap();
  await page.selectOption('#ovPeriod', { index: 1 });
  await page.locator('#ovTable tr.click').first().tap();
  await expect(page.locator('#byAccount')).toBeVisible();
});
