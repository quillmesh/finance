// Baut erfundene Kreditkarten-Abrechnungen als PDF im Aufbau der echten Exporte (für Unit- und End-to-End-Tests).
// Alle Namen, Nummern und Beträge sind erfunden. Genutzt von tests/unit/pdf.test.ts und e2e/pdf.spec.mjs.
import { deflateSync } from 'node:zlib';

const f2 = (r) => {
  const neg = r < 0, a = Math.abs(r);
  const ch = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${ch}.${String(a % 100).padStart(2, '0')}${neg ? ' -' : ''}`;
};
/** PDF-Zeichenkette mit Oktal-Escapes für alles ausserhalb ASCII (WinAnsi = Latin-1 für diese Zeichen) */
const str = (s) => '(' + [...s].map((c) => {
  const n = c.charCodeAt(0);
  if (c === '(' || c === ')' || c === '\\') return '\\' + c;
  if (n < 32 || n > 126) return '\\' + (n & 0xff).toString(8).padStart(3, '0');
  return c;
}).join('') + ')';

/**
 * spec: {
 *   previous: Rappen, payment: { d, v } | null (Zahlung = previous),
 *   fees: [{ d, v, text, amount }],              Buchungen ausserhalb der Karte (z. B. Rechnungsgebühr)
 *   cards: [{ no: '5412 34XX XXXX 9876', name, tx: [{ d, v, text, branch, amount }] }],
 *   perPage: Buchungen pro Seite (Kartenkopf und Übertrag wiederholen sich),
 *   cardTotal: Map/Objekt no → Rappen (überschreibt das richtige Total), invoice: Rappen (überschreibt),
 *   compress: true, objStm: false
 * }
 * Datumswerte als „TT.MM.JJ“.
 */
export function bauePdf(spec) {
  const perPage = spec.perPage ?? 12;
  const compress = spec.compress ?? true;
  const pages = [];
  let lines = [];
  let y = 0;
  const T = (x, yy, parts, amountX) => lines.push({ x, y: yy, parts, amountX });
  const newPage = () => {
    if (lines.length) pages.push(lines);
    lines = [];
    y = 760;
    T(388, y, ['Herausgegeben von']); T(388, y - 10, ['Muster Kartendienst AG']); T(388, y - 20, ['Beispielweg 1, 9999 Musterstadt']);
    y -= 70;
    lines.push({ header: true, y });
    y -= 18;
  };
  const row = (cells, amount) => { T(67, y, cells, amount); y -= 12; };
  const branch = (text) => { lines.push({ branch: text, y }); y -= 10; };

  newPage();
  const prevTotalDate = spec.payment?.v ?? '01.01.26';
  row([prevTotalDate, 'Totalbetrag letzte Abrechnung'], spec.previous ?? 0);
  if (spec.payment) row([spec.payment.d, spec.payment.v, 'Ihre Zahlung - Danke'], -(spec.previous ?? 0));
  for (const f of spec.fees ?? []) row([f.d, f.v, f.text], f.amount);
  let all = (spec.fees ?? []).reduce((a, f) => a + f.amount, 0);
  const cardTotal = spec.cardTotal ?? {};
  for (const c of spec.cards ?? []) {
    let sum = 0, onPage = 0;
    const head = () => { row([`${c.no} ${c.name}`]); row(['Kartenlimite CHF 5\'000']); };
    head();
    for (const t of c.tx) {
      if (onPage === perPage) {
        row(['Zwischensumme Karte'], sum); row([`Seite ${pages.length + 1}`]);
        newPage(); row(['Übertrag Total'], sum); head(); row(['Übertrag Karte'], sum); onPage = 0;
      }
      row([t.d, t.v, t.text], t.amount);
      if (t.branch) branch(t.branch);
      sum += t.amount; onPage++;
    }
    all += sum;
    row([`Total Karte ${c.name.split(',')[0]} ${c.no}`], cardTotal[c.no] ?? sum);
  }
  // Rechnungsbetrag = letzte Abrechnung − Zahlung + alle Buchungen (nicht bezahlter Saldo wird übertragen)
  const invoice = spec.invoice ?? ((spec.previous ?? 0) - (spec.payment ? spec.previous ?? 0 : 0) + all);
  row(['Total Rechnungsbetrag zu unseren Gunsten'], invoice);
  row(['Der fällige Betrag wird Ihrem Konto CH00 0000 0000 0000 0000 0 belastet'], invoice);
  row(['Werbung: Angebot für nur CHF 9.90! Bestellung (Klammer) und Ümlaut']);
  pages.push(lines);

  // Inhaltsströme: Zeile = BT … Tm [(Datum)-418(Valuta)-423(Text)]TJ  Td [(Betrag)]TJ ET; Branche mit TL und '
  const contents = pages.map((ls) => ls.map((l) => {
    if (l.header) {
      const cols = [['Datum', 67], ['Valuta', 101], ['Details', 135], ['Währung', 402], ['Betrag', 495], ['Betrag in CHF', 527]];
      let x0 = 67, s = `BT\n/F1 1 Tf\n9 0 0 9 67 ${l.y} Tm\n`;
      for (const [t, x] of cols) { s += `${((x - x0) / 9).toFixed(4)} 0 Td\n[${str(t)}]TJ\n`; x0 = x; }
      return s + 'ET';
    }
    if (l.branch) return `BT\n/F1 1 Tf\n9 0 0 9 135 ${(l.y + 9.9).toFixed(2)} Tm\n1.1 TL\n${str(l.branch)}'\nET`;
    const arr = l.parts.map((p, i) => (i ? (i === 1 ? '-418' : '-423') : '') + str(p)).join('');
    let s = `BT\n/F1 1 Tf\n9 0 0 9 ${l.x} ${l.y} Tm\n[${arr}]TJ\n`;
    if (l.amountX !== undefined) {
      const a = f2(l.amountX);
      const items = a.endsWith(' -') ? `${str(a.slice(0, -2))}-318${str('-')}` : `${str(a)}-318${str(' ')}`;
      s += `${((540 - l.x) / 9).toFixed(4)} -0 Td\n[${items}]TJ\n`;
    }
    return s + 'ET';
  }).join('\n'));

  // PDF-Objekte zusammensetzen
  const objs = []; // [nr, dict, streamBytes?]
  const n = pages.length;
  const catalogNr = 1, pagesNr = 2, fontNr = 3;
  const pageNr = (i) => 4 + i, contentNr = (i) => 4 + n + i;
  const dicts = new Map();
  dicts.set(catalogNr, '<< /Type /Catalog /Pages 2 0 R >>');
  dicts.set(pagesNr, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageNr(i)} 0 R`).join(' ')}] >>`);
  dicts.set(fontNr, '<< /Type /Font /Subtype /TrueType /BaseFont /Arial /Encoding /WinAnsiEncoding >>');
  for (let i = 0; i < n; i++) dicts.set(pageNr(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.3 841.9] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNr(i)} 0 R >>`);
  const enc = (s) => Buffer.from(s, 'latin1');
  const streams = new Map();
  for (let i = 0; i < n; i++) streams.set(contentNr(i), enc(contents[i]));

  if (spec.objStm) {
    const ids = [...dicts.keys()];
    let head = '', body = '';
    for (const id of ids) { head += `${id} ${body.length} `; body += dicts.get(id) + '\n'; }
    const data = enc(head + body);
    streams.set(100, data);
    dicts.clear();
    dicts.set(100, `<< /Type /ObjStm /N ${ids.length} /First ${head.length} `);
  }
  for (const [nr, d] of dicts) objs.push([nr, d]);
  for (const [nr, b] of streams) {
    const raw = compress ? deflateSync(b) : b;
    const extra = nr === 100 ? dicts.get(100) : '<< ';
    objs.push([nr, `${extra}/Length ${raw.length}${compress ? ' /Filter /FlateDecode' : ''} >>`, raw]);
  }
  const chunks = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let off = chunks[0].length;
  const xref = [];
  for (const [nr, d, s] of objs.filter((o) => !(spec.objStm && o[0] === 100 && !o[2]))) {
    xref.push([nr, off]);
    const parts = [Buffer.from(`${nr} 0 obj\n${d}\n`, 'latin1')];
    if (s) parts.push(Buffer.from('stream\n', 'latin1'), s, Buffer.from('\nendstream\n', 'latin1'));
    parts.push(Buffer.from('endobj\n', 'latin1'));
    for (const p of parts) { chunks.push(p); off += p.length; }
  }
  chunks.push(Buffer.from(`xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

/** Datum relativ zu heute: Tag d im Vormonat als „TT.MM.JJ“ */
export function vormonatTag(d) {
  const now = new Date(); const x = new Date(now.getFullYear(), now.getMonth() - 1, d);
  return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getFullYear()).slice(2)}`;
}
