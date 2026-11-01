// Hilfen für mehrere Testdateien. Alle Daten sind erfunden und relativ zu heute.
import { createHash } from 'node:crypto';

const p2 = (n) => String(n).padStart(2, '0');
/** Datum im Vormonat (Tag d) – damit Monatsansichten im Test immer vollständig sind */
export function vormonat(d) { const now = new Date(); const x = new Date(now.getFullYear(), now.getMonth() - 1, d); return { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate() }; }
export const monatWert = () => { const v = vormonat(1); return `${v.y}-${p2(v.m)}`; };

/** Kreditkarten-CSV mit Zeilen [Tag, Betrag, Händler, Ort] im Vormonat */
export function visaCSV(rows) {
  const head = 'TransactionId,CardId,Date,ValutaDate,Amount,Currency,OriginalAmount,OriginalCurrency,MerchantName,MerchantPlace,MerchantCountry,StateType,Details,Type';
  return [head, ...rows.map(([d, amt, mer, place], i) => {
    const v = vormonat(d); const dt = `${p2(v.m)}/${p2(v.d)}/${v.y}`;
    const pay = amt < 0;
    return [`E2E${v.y}${p2(v.m)}${i}`, 'TESTKARTE', `${dt} 12:00:00`, `${dt} 00:00:00`, amt.toFixed(2), 'CHF', amt.toFixed(2), 'CHF', pay ? '' : mer, place ?? '', 'CHE', 'BOOKED', pay ? 'Ihre Zahlung - Danke' : mer, 'merchant'].join(',');
  })].join('\n');
}

/** Bank-CSV mit Zeilen [Tag, Buchungstext, Belastung|null, Gutschrift|null] im Vormonat */
export function bankCSV(rows) {
  return ['Date,Value date,Booking text,Debit,Credit,Balance CHF', ...rows.map(([d, text, de, cr]) => {
    const v = vormonat(d); const dt = `${p2(v.d)}.${p2(v.m)}.${v.y}`;
    return [dt, dt, `" ${text} "`, de ?? '', cr ?? '', ''].join(',');
  })].join('\n');
}

export const datei = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

/** App öffnen ('' = Live, 'test/' = Test) und warten, bis sie bereit ist */
export async function gehe(page, pfad = '') {
  await page.goto(pfad);
  await page.locator('main section:not([hidden])').first().waitFor();
}
export const tab = (page, name) => page.click(`nav button[data-tab=${name}]`);
export const importiere = async (page, konto, files) => {
  await tab(page, 'import');
  await page.click(`[data-act=impAcc][data-id=${konto}]`);
  await page.setInputFiles('#fileIn', files);
  await page.locator('#toast:not([hidden])').waitFor();
};
/** Aktuelle Buchung über Knöpfe taggen */
export async function tagge(page, kategorie, unterkategorie) {
  await page.locator('.catbtn[data-act=pickCat]', { hasText: kategorie }).first().click();
  await page.locator('.catbtn[data-act=pickSub]', { hasText: unterkategorie ?? 'Ohne Unterkategorie' }).first().click();
}
export const keinQuerScrollen = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Simuliertes GitHub (Contents- und Git-API), wie die App es für den Sync nutzt. Mehrere Geräte teilen es. */
export function simuliertesGitHub() {
  const files = new Map();
  const state = { isPrivate: true, calls: 0 };
  const shaOf = (p) => createHash('sha1').update(p).digest('hex');
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  async function handler(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    state.calls++;
    const u = new URL(req.url());
    if (req.headers()['authorization'] !== 'Bearer github_pat_gut') return json(route, 401, { message: 'Bad credentials' });
    const m = u.pathname.match(/^\/repos\/ich\/finance-data(\/.*)?$/);
    if (!m) return json(route, 404, { message: 'Not Found' });
    const rest = m[1] ?? '';
    if (rest === '') return json(route, 200, { private: state.isPrivate, default_branch: 'main', full_name: 'ich/finance-data', permissions: { push: true } });
    if (rest.startsWith('/contents/')) {
      const path = decodeURIComponent(rest.slice('/contents/'.length));
      if (req.method() === 'GET') return files.has(path) ? json(route, 200, { content: files.get(path), sha: shaOf(path) }) : json(route, 404, { message: 'Not Found' });
      if (req.method() === 'PUT') {
        if (files.has(path)) return json(route, 422, { message: "sha wasn't supplied" });
        files.set(path, JSON.parse(req.postData()).content);
        return json(route, 201, { content: { path } });
      }
    }
    if (rest.startsWith('/git/trees/')) {
      if (!files.size) return json(route, 409, { message: 'Git Repository is empty.' });
      return json(route, 200, { tree: [...files.keys()].map((p) => ({ path: p, type: 'blob', sha: shaOf(p) })), truncated: false });
    }
    if (rest.startsWith('/git/blobs/')) {
      const p = [...files.keys()].find((k) => shaOf(k) === rest.slice('/git/blobs/'.length));
      return p ? json(route, 200, { content: files.get(p) }) : json(route, 404, { message: 'Not Found' });
    }
    return json(route, 404, { message: 'Not Found' });
  }
  return {
    files, state,
    text: () => [...files.entries()].map(([p, c]) => p + ' ' + Buffer.from(c, 'base64').toString('utf8')).join('\n'),
    anschliessen: (page) => page.context().route('https://api.github.com/**', handler),
  };
}

/** KAT-07: Kategorien in den Einstellungen aufklappen */
export async function kategorienOeffnen(page) {
  await tab(page, 'settings');
  const b = page.locator('[data-act=katOpen]');
  if (await b.count()) await b.click();
  await page.locator('#catCard .catedit').first().waitFor();
}

/**
 * GUI-01: Layout-Probleme im sichtbaren Tab bzw. im offenen Dialog.
 * - Bedienelemente überlappen sich nicht und halten mindestens MIN_ABSTAND px Abstand
 *   (ausser Teile eines zusammengehörigen Elements: Segment-Schalter, Unterkategorie-Chip, Wisch-Aktionen)
 * - Auswahlfelder und Knöpfe zeigen ihren Text ganz
 * - Bedienelemente in einer Zeile eines Formulars sind gleich hoch
 * - kein seitliches Scrollen
 */
export const layoutProbleme = (page) => page.evaluate(() => {
  const MIN_ABSTAND = 4;
  const dlg = document.querySelector('#dlg[open]');
  const root = dlg ?? document.querySelector('main section:not([hidden])');
  const out = [];
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]'); };
  const els = [...root.querySelectorAll('button, input:not([type=hidden]), select, textarea, .chip, .area')].filter(sichtbar)
    .filter((e) => !e.closest('.swipeact'));
  const name = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}[${(e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 24)}]`;
  const gruppe = (e) => e.closest('.seg, .subtag');
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.contains(b) || b.contains(a)) continue;
    const g = gruppe(a); if (g && g === gruppe(b)) continue;
    const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
    const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
    const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (ox > 0.5 && oy > 0.5) out.push(`überlappt: ${name(a)} / ${name(b)}`);
    else if ((ox > 2 && oy > -MIN_ABSTAND + 0.5) || (oy > 2 && ox > -MIN_ABSTAND + 0.5)) out.push(`zu wenig Abstand: ${name(a)} / ${name(b)}`);
  }
  const ctx = document.createElement('canvas').getContext('2d');
  for (const e of els) {
    const cs = getComputedStyle(e);
    if (e.tagName === 'SELECT') {
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = e.options[e.selectedIndex]?.text ?? '';
      const frei = e.clientWidth - parseFloat(cs.paddingLeft) - Math.max(parseFloat(cs.paddingRight), 24);
      if (ctx.measureText(text).width > frei + 1) out.push(`Text abgeschnitten: ${name(e)}`);
    } else if (e.tagName === 'BUTTON' && cs.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1) out.push(`Text abgeschnitten: ${name(e)}`);
  }
  // gleiche Höhe in einer Zeile: Felder und Knöpfe in Formularen und Kategorien
  const felder = els.filter((e) => /^(INPUT|SELECT|BUTTON)$/.test(e.tagName) && e.type !== 'checkbox' && e.type !== 'radio' && !gruppe(e) && e.closest('.catedit, form, .formrow'));
  for (let i = 0; i < felder.length; i++) for (let j = i + 1; j < felder.length; j++) {
    const A = felder[i].getBoundingClientRect(), B = felder[j].getBoundingClientRect();
    if (Math.abs(A.top + A.height / 2 - (B.top + B.height / 2)) < 6 && Math.abs(A.height - B.height) > 1 && !felder[i].classList.contains('link') && !felder[j].classList.contains('link'))
      out.push(`ungleich hoch: ${name(felder[i])} ${Math.round(A.height)} / ${name(felder[j])} ${Math.round(B.height)}`);
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`seitliches Scrollen: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  return [...new Set(out)];
});
