// Erfundene Beispieldaten für die Test-App und die Tests (UMG-04).
// Komplett neu erzeugt, reproduzierbar über einen Startwert. Keine Daten aus echten Auszügen.
// Die Dateien haben dasselbe Format wie die echten Exporte, damit der Import mitgeprüft wird.

/** Zufall mit Startwert (wiederholbar) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const pad = (n: number) => String(n).padStart(2, '0');
const money = (r: number) => (r / 100).toFixed(2);
const chMoney = (r: number) => { const [i, f] = money(r).split('.'); return `${i.replace(/\B(?=(\d{3})+$)/g, "'")}.${f}`; };

/** Monate rückwärts ab `today`: [{ y, m }] älteste zuerst */
function monthsBack(today: Date, n: number) {
  const out: { y: number; m: number }[] = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); out.push({ y: d.getFullYear(), m: d.getMonth() + 1 }); }
  return out;
}
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

interface Row { y: number; m: number; d: number; amount: number }

/** Tage bis heute im laufenden Monat, sonst ganzer Monat */
function dayIn(r: () => number, y: number, m: number, today: Date) {
  const max = y === today.getFullYear() && m === today.getMonth() + 1 ? today.getDate() : lastDay(y, m);
  return 1 + Math.floor(r() * max);
}
const inPast = (y: number, m: number, d: number, today: Date) => new Date(y, m - 1, d) <= today;

// ---------- Kreditkarte ----------

const VISA_SHOPS: [name: string, place: string, country: string, min: number, max: number, cur?: string][] = [
  ['Frischmarkt', 'Musterdorf', 'CHE', 1500, 9000], ['Quartierladen Sonne', 'Beispielstadt', 'CHE', 1200, 7000], ['Kantine Campus', 'Beispielstadt', 'CHE', 1100, 1800],
  ['Bäckerei Musterbeck', 'Musterdorf', 'CHE', 400, 1500], ['Bar Zentral', 'Seestadt', 'CHE', 900, 4500], ['Tankstelle Blitz', 'Musterdorf', 'CHE', 6000, 9500],
  ['Elektro Muster', 'Zürich', 'CHE', 2000, 25000], ['Streamingdienst Muster', '', '', 1395, 1395], ['Flugschule Alpenwind', 'Bergdorf', 'CHE', 9500, 22000],
  ['Bahn Ticket', 'Bern', 'CHE', 500, 4500], ['Sportshop Muster', 'Musterhausen', 'CHE', 3000, 12000], ['Café Lago', 'Musterhausen', 'CHE', 500, 1600],
  ['Hotel Mar Azul', 'Porto', 'PRT', 30000, 60000, 'EUR'],
];

export function sampleCardCSV(seed: number, today: Date, months = 3): string {
  const r = rng(seed);
  const lines = ['TransactionId,CardId,Date,ValutaDate,Amount,Currency,OriginalAmount,OriginalCurrency,MerchantName,MerchantPlace,MerchantCountry,StateType,Details,Type'];
  let n = 0;
  for (const { y, m } of monthsBack(today, months)) {
    const count = 14 + Math.floor(r() * 8);
    const rows: (Row & { s: typeof VISA_SHOPS[number] })[] = [];
    for (let i = 0; i < count; i++) {
      const s = VISA_SHOPS[Math.floor(r() * (VISA_SHOPS.length - 1))];
      rows.push({ y, m, d: dayIn(r, y, m, today), amount: s[3] + Math.round((r() * (s[4] - s[3])) / 5) * 5, s });
    }
    if (m % 3 === 0) rows.push({ y, m, d: Math.min(12, dayIn(r, y, m, today)), amount: 41000, s: VISA_SHOPS[VISA_SHOPS.length - 1] });
    // Zahlung der Vormonats-Rechnung („Ihre Zahlung – Danke“)
    if (inPast(y, m, 3, today)) rows.push({ y, m, d: 3, amount: -(80000 + Math.round(r() * 60000)), s: ['', '', '', 0, 0] });
    rows.sort((a, b) => a.d - b.d);
    for (const x of rows) {
      const date = `${pad(x.m)}/${pad(x.d)}/${x.y}`;
      const id = `TRX${x.y}${pad(x.m)}${pad(x.d)}${String(++n).padStart(6, '0')}`;
      const pay = x.amount < 0;
      const name = pay ? '' : x.s[0];
      const details = pay ? 'Ihre Zahlung - Danke' : `${x.s[0]} ${x.s[1]}`.trim();
      lines.push([id, 'TESTKARTE0001', `${date} ${pad(8 + Math.floor(r() * 12))}:${pad(Math.floor(r() * 60))}:00`, `${date} 00:00:00`,
        money(x.amount), 'CHF', money(x.amount), x.s[5] ?? 'CHF', name, x.s[1], x.s[2], 'BOOKED', details, pay ? 'payment' : 'merchant'].map(csvCell).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// ---------- Bankkonto ----------

const BANK_HEAD = 'Date,Value date,Booking text,Debit,Credit,Balance CHF';
let ref = 0;
const nextRef = (r: () => number) => String(1500000000 + (++ref) * 7919 + Math.floor(r() * 1000));
function bankLine(y: number, m: number, d: number, text: string, debit: number | null, credit: number | null) {
  const dt = `${pad(d)}.${pad(m)}.${y}`;
  return [dt, dt, csvCell(` ${text} `), debit === null ? '' : chMoney(debit), credit === null ? '' : chMoney(credit), ''].join(',');
}
const twint = (shop: string, place: string, y: number, m: number, d: number) => `TWINT-Zahlung ${shop}, ${place} +41790000000 ${pad(d)}.${pad(m)}.${y} 12:15`;
const ebank = (r: () => number, who: string, msg = '') => `Belastung e-banking / Ref.-Nr. ${nextRef(r)} ${who}${msg ? ` Mitteilung: ${msg}` : ''} Ursprünglicher Auftraggeber: Max Muster 000000000000000000000000000`;

/** Privates Bankkonto: Lohn, Einzahlung aufs gemeinsame Konto, Visa-Abbuchung, TWINT, Rechnungen */
export function sampleBankPrivatCSV(seed: number, today: Date, months = 3): string {
  const r = rng(seed); ref = 0;
  const lines = [BANK_HEAD];
  for (const { y, m } of monthsBack(today, months)) {
    const rows: [number, string][] = [];
    const add = (d: number, text: string, debit: number | null, credit: number | null) => { if (inPast(y, m, d, today)) rows.push([d, bankLine(y, m, d, text, debit, credit)]); };
    add(25, `Zahlungseingang / Ref.-Nr. ${nextRef(r)} MUSTER ARBEITGEBER AG BAHNHOFSTRASSE 1 CH-1000 MUSTERSTADT Referenz: WAGE/SALARY ${y}${pad(m)}`, null, 650000);
    add(1, `Belastung Dauerauftrag / Ref.-Nr. ${nextRef(r)} Gemeinschaftskonto Muster Beispiel Dorfstrasse 1 1234 Musterdorf Mitteilung: Haushalt`, 150000, null);
    add(29, `Belastung: Lastschriftverfahren / Ref.-Nr. ${nextRef(r)} ** Kartenherausgeber Muster AG Musterweg 1 Postfach 1000 Musterstadt Mitteilung: BELASTUNG GEMAESS RECHNUNG KARTENKONTO 0000`, 90000 + Math.round(r() * 80000), null);
    add(19, ebank(r, 'Mobilfunk Muster AG Musterweg 4 3000 Bern Schweiz', 'Abo Monat'), 3490, null);
    add(5, ebank(r, 'Muster Krankenkasse AG 6000 Seestadt Schweiz'), 38450, null);
    if (m === 9) add(30, ebank(r, 'VORSORGESTIFTUNG BEISPIEL LINDENHOF 3 4000 BASEL Schweiz'), 70000, null);
    if (m % 2 === 0) add(13, ebank(r, 'Steueramt Musterdorf 1234 Musterdorf Schweiz', 'Steuern Raten'), 85000, null);
    for (let i = 0; i < 5; i++) {
      const [shop, place, min, max] = ([['QUARTIERLADEN SONNE', 'BEISPIELSTADT', 600, 2500], ['PARKPLATZ APP', 'BEISPIELSTADT', 300, 900], ['GEMUESEKORB.CH', 'MUSTERDORF', 2490, 2490], ['TICKETS MUSTER AG', 'BERN', 1500, 6000]] as const)[Math.floor(r() * 4)];
      const d = dayIn(r, y, m, today);
      add(d, twint(shop, place, y, m, d), min + Math.round((r() * (max - min)) / 5) * 5, null);
    }
    const d = dayIn(r, y, m, today);
    add(d, `TWINT-Gutschrift Geld erhalten von Lukas Beispiel +41790000001 Drinks ${pad(d)}.${pad(m)}.${y} 21:45`, null, 1800);
    if (inPast(y, m, 15, today)) add(15, 'Bargeldbezug Bancomat Musterdorf', 20000, null);
    rows.sort((a, b) => b[0] - a[0]);
    lines.push(...rows.map((x) => x[1]));
  }
  return lines.join('\n') + '\n';
}

/** Gemeinsames Konto: Einzahlungen beider, Miete, Einkäufe, Auto */
export function sampleBankGemeinsamCSV(seed: number, today: Date, months = 3): string {
  const r = rng(seed); ref = 0;
  const lines = [BANK_HEAD];
  for (const { y, m } of monthsBack(today, months)) {
    const rows: [number, string][] = [];
    const add = (d: number, text: string, debit: number | null, credit: number | null) => { if (inPast(y, m, d, today)) rows.push([d, bankLine(y, m, d, text, debit, credit)]); };
    add(1, `Zahlungseingang / Ref.-Nr. ${nextRef(r)} MAX MUSTER DORFSTRASSE 1 CH 1234 MUSTERDORF Referenz: HAUSHALT`, null, 150000);
    add(1, `Zahlungseingang / Ref.-Nr. ${nextRef(r)} ANNA BEISPIEL DORFSTRASSE 1 CH 1234 MUSTERDORF Referenz: HAUSHALT`, null, 150000);
    add(1, ebank(r, 'Muster Immobilien AG Hauptstrasse 3 1234 Musterdorf Schweiz', 'Miete'), 190000, null);
    add(14, ebank(r, 'EW Musterdorf 1234 Musterdorf Schweiz', 'Strom'), 9000 + Math.round(r() * 5000), null);
    if (m % 3 === 1) add(6, ebank(r, 'Serafe AG Postfach 8010 Zürich Schweiz'), 8375, null);
    for (let i = 0; i < 7; i++) {
      const [shop, place, min, max] = ([['FRISCHMARKT', 'MUSTERDORF', 4000, 16000], ['GROSSMARKT NORD', 'BEISPIELSTADT', 3000, 12000], ['TANKSTELLE BLITZ', 'MUSTERDORF', 7000, 9500], ['MOEBELHAUS MUSTER', 'BEISPIELSTADT', 3000, 25000]] as const)[Math.floor(r() * 4)];
      const d = dayIn(r, y, m, today);
      add(d, twint(shop, place, y, m, d), min + Math.round((r() * (max - min)) / 5) * 5, null);
    }
    if (m === 9 || m === 3) add(19, ebank(r, 'Garage Muster AG 1234 Musterdorf Schweiz', 'Service'), 48000, null);
    rows.sort((a, b) => b[0] - a[0]);
    lines.push(...rows.map((x) => x[1]));
  }
  return lines.join('\n') + '\n';
}

/** Zuordnung der Beispiel-Händler zu Kategorien (für das automatische Taggen der Test-App) */
export const SAMPLE_TAGS: [match: RegExp, cat: string, sub: number][] = [
  [/^(frischmarkt|quartierladen|gemuesekorb|grossmarkt)/i, 'k-einkaufen', 1], [/kantine/i, 'k-essen', 2], [/bäckerei|café/i, 'k-essen', 4],
  [/bar zentral/i, 'k-essen', 3], [/tankstelle/i, 'k-auto', 1], [/parkplatz/i, 'k-auto', 3], [/garage/i, 'k-auto', 2],
  [/elektro/i, 'k-persoenlich', 1], [/streaming/i, 'k-abos', 2], [/mobilfunk/i, 'k-abos', 1], [/flugschule/i, 'k-hobby', 1],
  [/sportshop/i, 'k-hobby', 2], [/bahn/i, 'k-freizeit', 1], [/tickets/i, 'k-freizeit', 3], [/hotel mar azul/i, 'k-ferien', 1],
  [/arbeitgeber/i, 'k-einnahmen', 1], [/lukas beispiel/i, 'k-essen', 3], [/gemeinschaftskonto/i, 'k-haushalt', 1],
  [/krankenkasse/i, 'k-steuern', 3], [/steueramt/i, 'k-steuern', 1], [/vorsorgestiftung/i, 'k-sparen', 1],
  [/max muster/i, 'k-einzahlungen', 1], [/anna beispiel/i, 'k-einzahlungen', 2], [/immobilien/i, 'k-wohnen', 1],
  [/ew musterdorf|serafe/i, 'k-wohnen', 2], [/moebelhaus/i, 'k-wohnen', 3],
];

export const SAMPLE_SEED = 20261023;
