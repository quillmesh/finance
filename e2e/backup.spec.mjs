// DAT-02: verschlüsseltes Backup herunterladen und auf einem anderen Gerät einspielen
import { test, expect, COMPUTER } from './fixtures.mjs';
import { datei, gehe, importiere, tab, tagge, visaCSV } from './hilfen.mjs';
import { readFileSync } from 'node:fs';

test('Backup: verschlüsselt, falsche Passphrase abgelehnt, auf neuem Gerät gleicher Stand', async ({ geraet }) => {
  const A = await geraet(COMPUTER, 'A');
  await gehe(A, '');
  await importiere(A, 'privat', datei('v.csv', visaCSV([[2, 11, 'Bäckerei Muster', 'Musterhausen'], [3, 22, 'Velo Muster', 'Beispielwil']])));
  await tagge(A, 'Essen & Ausgang', 'Café & Bäckerei');
  await tab(A, 'settings');
  await A.fill('#bPass', 'meine-passphrase');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('[data-act=backupExport]')]);
  const pfad = await dl.path();
  const inhalt = readFileSync(pfad, 'utf8');
  expect(inhalt).not.toContain('Bäckerei');
  expect(JSON.parse(inhalt).cipher.name).toBe('AES-256-GCM');

  const B = await geraet(COMPUTER, 'B');
  await gehe(B, '');
  await tab(B, 'settings');
  await B.setInputFiles('#bFile', pfad);
  await B.fill('#bPass', 'falsch');
  await B.click('[data-act=backupImport]');
  await expect(B.locator('#toast')).toContainText('Passphrase falsch');
  await B.fill('#bPass', 'meine-passphrase');
  await B.click('[data-act=backupImport]');
  await expect(B.locator('#toast')).toContainText('Backup eingespielt');
  await tab(B, 'list');
  await expect(B.locator('.txrow')).toHaveCount(2);
  await expect(B.locator('.txrow', { hasText: 'Bäckerei' })).toContainText('Café & Bäckerei');
  await expect(B.locator('.txrow', { hasText: 'Velo' })).toContainText('Nicht getaggt');
});
