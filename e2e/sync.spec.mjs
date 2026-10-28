// NF-01/04/05, DAT-01: verschlüsselter Sync über ein simuliertes GitHub mit zwei Geräten
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { datei, gehe, importiere, simuliertesGitHub, tab, tagge, visaCSV } from './hilfen.mjs';

// Das simulierte GitHub antwortet absichtlich mit 401/404/409/422; der Browser meldet das in der Konsole.
test.use({ erlaubteKonsolenfehler: /401|404|409|422/ });

async function einrichten(P, pass, neu) {
  await tab(P, 'settings');
  await P.fill('#sOwner', 'ich'); await P.fill('#sRepo', 'finance-data'); await P.fill('#sToken', 'github_pat_gut');
  await P.click('#sGo');
  await P.locator('#sPassBox').waitFor();
  await P.fill('#sPass', pass);
  if (neu) await P.fill('#sPass2', pass); else await expect(P.locator('#sPass2Box')).toBeHidden();
  await P.click('#sGo');
  await expect(P.locator('#toast')).toContainText('Sync eingerichtet');
}
const liste = async (P) => { await tab(P, 'list'); return (await P.locator('.txrow').allInnerTexts()).sort(); };

test('zwei Geräte: einrichten, verschlüsselt hochladen, abgleichen, gleicher Stand', async ({ geraet }) => {
  const gh = simuliertesGitHub();
  const A = await geraet(COMPUTER, 'Computer');
  await gh.anschliessen(A);
  await gehe(A, '');
  await importiere(A, 'privat', datei('v.csv', visaCSV([[2, 11, 'Bäckerei Geheim', 'Musterhausen'], [3, 22, 'Velo Geheim', 'Beispielwil']])));
  await tagge(A, 'Essen & Ausgang', 'Café & Bäckerei');

  // Fehler verständlich: falsches Token, öffentliches Repo
  await tab(A, 'settings');
  await A.fill('#sOwner', 'ich'); await A.fill('#sRepo', 'finance-data'); await A.fill('#sToken', 'github_pat_falsch');
  await A.click('#sGo');
  await expect(A.locator('#toast')).toContainText('ungültig');
  gh.state.isPrivate = false;
  await A.fill('#sToken', 'github_pat_gut');
  await A.click('#sGo');
  await expect(A.locator('#toast')).toContainText('öffentlich');
  gh.state.isPrivate = true;
  await A.reload();
  await einrichten(A, 'sehr-geheime-passphrase', true);
  await expect(A.locator('#sync')).toContainText('ich/finance-data');
  expect(gh.files.has('finanzen.json')).toBe(true);
  expect(gh.text(), 'nichts im Klartext').not.toContain('Geheim');

  // Zweites Gerät
  const B = await geraet(HANDY, 'Handy');
  await gh.anschliessen(B);
  await gehe(B, '');
  await einrichten(B, 'sehr-geheime-passphrase', false);
  expect(await liste(B)).toEqual(await liste(A));

  // Änderung auf B, abgleichen auf A
  await tab(B, 'tag');
  await tagge(B, 'Hobby', 'Sport');
  await B.evaluate(() => window.finanzen.sync());
  await A.evaluate(() => window.finanzen.sync());
  const a = await liste(A), b = await liste(B);
  expect(a).toEqual(b);
  expect(a.join(' ')).toContain('Hobby › Sport');
  expect(gh.text()).not.toContain('Velo');
});
