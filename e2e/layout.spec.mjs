// GUI-01: klares Layout ohne Überlappungen; TAG-16: Kategorien beim Taggen am festen Ort; KAT-07: Kategorien auf Knopfdruck
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { gehe, tab, kategorienOeffnen, layoutProbleme, importiere, datei, visaCSV, bankCSV } from './hilfen.mjs';
import { bauePdf, vormonatTag } from '../tests/pdf-bauen.mjs';

const touch = (w, h) => ({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const GERAETE = {
  'Handy 360': touch(360, 740), 'Handy 390': HANDY, 'Android 412': touch(412, 915),
  'Tablet hoch': touch(820, 1180), 'Tablet quer': touch(1180, 820), Computer: COMPUTER,
};
/** Antippen auf Touch-Geräten, sonst klicken */
const drueck = (page, sel) => (page.touch ? page.locator(sel).first().tap() : page.locator(sel).first().click());

async function pruefe(page, wo) {
  expect.soft(await layoutProbleme(page), wo).toEqual([]);
}
/** bis eine Buchung mit dem Schalter Nur ich / Geteilt kommt */
async function privateAusgabe(page) {
  for (let i = 0; i < 40 && !(await page.locator('#shareBox').count()); i++) await drueck(page, '[data-act=skip]');
  await expect(page.locator('#shareBox')).toBeVisible();
}

for (const [geraet, opts] of Object.entries(GERAETE)) {
  test.describe(geraet, () => {
    test.use(opts);
    test('GUI-01: keine Überlappungen in allen Tabs und Dialogen', async ({ page }) => {
      page.touch = !!opts.hasTouch;
      await gehe(page, 'test/');
      for (const t of ['import', 'tag', 'overview', 'list', 'manual', 'settings']) {
        await drueck(page, `nav button[data-tab=${t}]`);
        await expect(page.locator(`#view-${t}`)).toBeVisible();
        await pruefe(page, `Tab ${t}`);
      }
      // Taggen in allen Zuständen
      await drueck(page, 'nav button[data-tab=tag]');
      await pruefe(page, 'Taggen');
      await privateAusgabe(page);
      for (const v of ['5000', '6667']) { await drueck(page, `[data-act=share][data-v="${v}"]`); await pruefe(page, `Taggen geteilt ${v}`); }
      await drueck(page, '[data-act=shareInd]'); await page.fill('#shareInd', '35'); await page.locator('#shareInd').blur();
      await pruefe(page, 'Taggen individuell');
      await drueck(page, '#noteBtn'); await pruefe(page, 'Taggen Notiz');
      await page.locator('#noteIn').press('Escape');
      await drueck(page, '.catbtn[data-act=pickCat][data-id=k-haushalt]');
      await pruefe(page, 'Unterkategorien');
      await drueck(page, '[data-act=newSub]'); await pruefe(page, 'neue Unterkategorie');
      await drueck(page, '.catbtn[data-act=pickSub][data-id=k-haushalt-1]'); // damit der Dialog beim Löschen erscheint
      // Einstellungen mit offenen Kategorien
      await kategorienOeffnen(page);
      await pruefe(page, 'Kategorien offen');
      // Dialoge
      await drueck(page, '#catCard .catedit[data-cat=k-haushalt] .subtag [data-act=delSub]');
      await expect(page.locator('#dlg[open]')).toBeVisible();
      await pruefe(page, 'Dialog Unterkategorie löschen');
      await drueck(page, '#subCancel');
      await drueck(page, '#delOpenBtn');
      await expect(page.locator('#dlg[open]')).toBeVisible();
      await pruefe(page, 'Dialog alle ungetaggten löschen');
      await drueck(page, '#dangerNo');
      await drueck(page, 'nav button[data-tab=list]');
      await drueck(page, '#txlist .txrow');
      await expect(page.locator('#dlg[open] #editForm')).toBeVisible();
      await pruefe(page, 'Dialog Buchung bearbeiten');
      await drueck(page, '[data-act=dlgClose]');
      await drueck(page, 'nav button[data-tab=manual]');
      const man = page.locator('#view-manual .txrow');
      if (await man.count()) {
        await drueck(page, '#view-manual .txrow');
        await expect(page.locator('#dlg[open] #editForm')).toBeVisible();
        await pruefe(page, 'Dialog manueller Eintrag');
        await drueck(page, '[data-act=dlgClose]');
      }
    });
  });
}

test.describe('Rückfrage beim Import', () => {
  for (const [geraet, opts] of [['Handy 360', GERAETE['Handy 360']], ['Tablet hoch', GERAETE['Tablet hoch']]]) {
    test.describe(geraet, () => {
      test.use(opts);
      test('GUI-01: Dialog «Bitte prüfen» ohne Überlappungen', async ({ page }) => {
        page.touch = !!opts.hasTouch;
        await gehe(page, '');
        await importiere(page, 'privat', datei('karte.csv', visaCSV([[5, 12.35, 'Dorfladen Muster', 'Musterdorf']])));
        const t = (d, text, amount) => ({ d: vormonatTag(d), v: vormonatTag(d), text, amount, branch: 'Supermärkte, Lebensmittel' });
        const s = { previous: 0, payment: { d: vormonatTag(2), v: vormonatTag(3) }, cards: [{ no: '5412 34XX XXXX 9876', name: 'Visa Muster, Max Muster', tx: [t(5, 'Dorfladen Muster, Musterdorf CH', 1235)] }], cardTotal: { '5412 34XX XXXX 9876': 99999 }, invoice: 99999 };
        await tab(page, 'import');
        await page.click('[data-act=impAcc][data-id=privat]');
        await page.setInputFiles('#fileIn', { name: 'abrechnung-mit-langem-namen.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bauePdf(s)) });
        await expect(page.locator('#dlg[open] #impAsk')).toBeVisible();
        await pruefe(page, 'Dialog Bitte prüfen');
      });
    });
  }
});

/** Position jedes Kategorie-Knopfs (data-id → x,y) */
const raster = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#catgrid [data-act=pickCat]')]
  .map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.id, `${Math.round(r.left)},${Math.round(r.top + scrollY)}`]; })));

for (const [geraet, opts] of [['Handy', HANDY], ['Computer', COMPUTER]]) {
  test.describe(`TAG-16 ${geraet}`, () => {
    test.use(opts);
    test('TAG-16: alle Kategorien immer am selben Ort, nicht gültige ausgegraut', async ({ page }) => {
      page.touch = !!opts.hasTouch;
      await gehe(page, 'test/');
      await tab(page, 'tag');
      const btn = (id) => page.locator(`#catgrid [data-act=pickCat][data-id=${id}]`);
      const gutschrift = () => page.locator('#txcard .chip.warn', { hasText: 'Gutschrift' }).count();
      while (await gutschrift()) await drueck(page, '[data-act=skip]');
      const fest = await raster(page);
      expect(Object.keys(fest)).toHaveLength(16);
      // alle Buchungen der Reihe nach: gemeinsames und persönliches Konto, mit und ohne Vorschlag (Gutschriften ausgenommen)
      const n = { gemeinsam: 0, privat: 0 };
      for (let i = 0; i < 40 && (await page.locator('#txcard').count()); i++) {
        if (!(await gutschrift())) {
          const wer = `Buchung ${i}: ${await page.locator('#txcard .mer').textContent()}`;
          expect(await raster(page), wer).toEqual(fest);
          if (await page.locator('#txcard .area.gemeinsam').count()) {
            n.gemeinsam++;
            await expect(btn('k-ferien')).toBeDisabled();
            await expect(btn('k-wohnen')).toBeEnabled();
          } else if (!n.privat++) {
            // persönlich: beim Umschalten der Aufteilung bleibt alles am Platz
            await drueck(page, '[data-act=share][data-v=me]');
            await expect(btn('k-wohnen')).toBeDisabled();
            await expect(btn('k-ferien')).toBeEnabled();
            expect(await raster(page), `${wer}, Nur ich`).toEqual(fest);
            for (const v of ['5000', '6667']) {
              await drueck(page, `[data-act=share][data-v="${v}"]`);
              expect(await raster(page), `${wer}, geteilt ${v}`).toEqual(fest);
              await expect(btn('k-wohnen')).toBeEnabled();
            }
            await drueck(page, '[data-act=shareInd]');
            expect(await raster(page), `${wer}, individuell offen`).toEqual(fest);
            await page.fill('#shareInd', '40'); await page.locator('#shareInd').blur();
            await expect(page.locator('#shareBox .on')).toHaveText('40 %');
            expect(await raster(page), `${wer}, individuell 40 %`).toEqual(fest);
          }
        }
        await drueck(page, '[data-act=skip]');
      }
      expect(n.gemeinsam).toBeGreaterThan(0);
      expect(n.privat).toBeGreaterThan(0);
    });
  });
}

test.describe('TAG-16 Tasten', () => {
  test.use(COMPUTER);
  test('TAG-16: Tasten 1–0 bleiben an den Plätzen 1–10; ausgegraute reagieren nicht', async ({ page }) => {
    await gehe(page, '');
    await importiere(page, 'gemeinsam', datei('g.csv', bankCSV([[3, 'Tankstelle Blitz', '40.00', null]])));
    await tab(page, 'tag');
    await expect(page.locator('#txcard .area.gemeinsam')).toBeVisible();
    await page.keyboard.press('1'); // Platz 1: Gemeinsamer Haushalt – gilt nicht fürs gemeinsame Konto
    await expect(page.locator('[data-act=backCat]')).toHaveCount(0);
    await page.keyboard.press('0'); // Platz 10: Wohnen
    await expect(page.locator('.stephead')).toContainText('Wohnen');
  });
});

test.describe('KAT-07', () => {
  test.use(HANDY);
  test('KAT-07: Kategorien erst auf Knopfdruck, dann alle offen', async ({ page }) => {
    await gehe(page, 'test/');
    await page.locator('nav button[data-tab=settings]').tap();
    await expect(page.locator('#catCard')).toContainText('16 Kategorien');
    await expect(page.locator('#catCard .catedit')).toHaveCount(0);
    await page.locator('[data-act=katOpen]').tap();
    await expect(page.locator('#catCard .catedit')).toHaveCount(16);
    await expect(page.locator('#catCard .catedit select[data-set=kind]')).toHaveCount(16);
    // Änderung bleibt offen, nach «Fertig» wieder zu
    await page.locator('#catCard [data-act=addSub][data-cat=k-hobby]').tap();
    await expect(page.locator('#catCard .catedit')).toHaveCount(16);
    await page.locator('[data-act=katClose]').tap();
    await expect(page.locator('#catCard .catedit')).toHaveCount(0);
    await expect(page.locator('#catCard')).toContainText('16 Kategorien');
  });
});

/** Reihenfolge der Knöpfe im Raster (data-id) */
const reihe = (page, act) => page.evaluate((act) => [...document.querySelectorAll(`#catgrid [data-act=${act}]`)].map((b) => b.dataset.id).filter(Boolean), act);

for (const [geraet, opts] of [['Handy', HANDY], ['Computer', COMPUTER]]) {
  test.describe(`TAG-17 ${geraet}`, () => {
    test.use(opts);
    test('TAG-17: Reihenfolge beim Taggen ändern – je ein Knopf für Kategorien und Unterkategorien, zwei Plätze tauschen', async ({ page }) => {
      page.touch = !!opts.hasTouch;
      await gehe(page, 'test/');
      await tab(page, 'tag');
      const vorher = await reihe(page, 'pickCat');
      // Kategorien
      await expect(page.locator('#arrBtn')).toHaveAttribute('data-v', 'cat');
      await drueck(page, '#arrBtn');
      await expect(page.locator('#arrBar')).toBeVisible();
      await expect(page.locator('#catgrid [data-act=arrPick]')).toHaveCount(16);
      await expect(page.locator('#catgrid [data-act=arrPick][disabled]')).toHaveCount(0); // auch ausgegraute lassen sich verschieben
      await expect(page.locator('.actions')).toHaveAttribute('inert', '');
      await pruefe(page, 'Kategorien ordnen');
      await drueck(page, '#catgrid [data-id=k-hobby]');
      await expect(page.locator('#arrBar')).toContainText('«Hobby» tauschen mit');
      await drueck(page, '#catgrid [data-id=k-einkaufen]');
      const erwartet = vorher.map((id) => (id === 'k-hobby' ? 'k-einkaufen' : id === 'k-einkaufen' ? 'k-hobby' : id));
      expect(await reihe(page, 'arrPick')).toEqual(erwartet);
      await drueck(page, '#arrDone');
      await expect(page.locator('#arrBar')).toHaveCount(0);
      expect(await reihe(page, 'pickCat')).toEqual(erwartet);
      // Unterkategorien: eigener Knopf im zweiten Schritt
      await drueck(page, '#catgrid [data-act=pickCat][data-id=k-auto]');
      await expect(page.locator('#arrBtn')).toHaveAttribute('data-v', 'sub');
      const subs = await reihe(page, 'pickSub');
      await drueck(page, '#arrBtn');
      await expect(page.locator('#catgrid [data-act=arrPick]')).toHaveCount(subs.length);
      await expect(page.locator('#catgrid [data-act=pickSub][data-id=""]')).toBeDisabled();
      await pruefe(page, 'Unterkategorien ordnen');
      await drueck(page, `#catgrid [data-id=${subs[0]}]`);
      await drueck(page, `#catgrid [data-id=${subs[2]}]`);
      await drueck(page, '#arrDone');
      const neu = [subs[2], subs[1], subs[0], ...subs.slice(3)];
      expect(await reihe(page, 'pickSub')).toEqual(neu);
      // bleibt nach dem Neuladen
      await page.reload();
      await tab(page, 'tag');
      expect(await reihe(page, 'pickCat')).toEqual(erwartet);
      await drueck(page, '#catgrid [data-act=pickCat][data-id=k-auto]');
      expect(await reihe(page, 'pickSub')).toEqual(neu);
    });
  });
}
