// Parser für Kreditkarten-CSV, Bank-CSV und camt.053. Alle Beispiele sind erfunden.
import { describe, expect, test } from 'bun:test';
import { detect, parseCSV, parseFile } from '../../src/parse';
import { partyName, parseBookingText } from '../../src/parse/bank';
import { parseXML } from '../../src/parse/camt';
import { titleCase } from '../../src/parse/common';

const VISA_HEAD = 'TransactionId,CardId,Date,ValutaDate,Amount,Currency,OriginalAmount,OriginalCurrency,MerchantName,MerchantPlace,MerchantCountry,StateType,Details,Type';
const BANK_HEAD = 'Date,Value date,Booking text,Debit,Credit,Balance CHF';

describe('CSV', () => {
  test('Anführungszeichen, Kommas im Feld, CRLF, BOM, Semikolon', () => {
    expect(parseCSV('﻿a,b\r\n1,"x, ""y"""\r\n')).toEqual([['a', 'b'], ['1', 'x, "y"']]);
    expect(parseCSV('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('IMP-01: Kreditkarten-CSV', () => {
  const csv = [VISA_HEAD,
    'TRX1,KARTE,11/22/2026 10:11:12,11/23/2026 00:00:00,33.300,CHF,33.300,CHF,Musterladen,Beispielstadt,CHE,BOOKED,Musterladen-77 Beispielstadt,merchant',
    'TRX2,KARTE,12/09/2026 20:21:22,12/10/2026 00:00:00,105.800,CHF,98.00,EUR,Strandbar Sol,Porto,PRT,BOOKED,STRANDBAR SOL,merchant',
    'TRX3,KARTE,12/03/2026 08:00:00,12/03/2026 00:00:00,-1500.00,CHF,-1500.00,CHF,,,,BOOKED,Ihre Zahlung - Danke,payment',
    'TRX4,KARTE,12/05/2026 08:00:00,12/05/2026 00:00:00,10.00,CHF,10.00,CHF,- Kiosk,,,PENDING,Kiosk,merchant',
    'TRX5,KARTE,kaputt,,abc,CHF,,,,,,,,',
  ].join('\n');

  test('liest Datum (MM/DD), Betrag in Rappen, Händler, Ort, Fremdwährung', () => {
    const { format, tx } = parseFile(csv, 'privat');
    expect(format).toBe('visa');
    expect(tx).toHaveLength(4);
    expect(tx[0]).toMatchObject({ id: 'privat:visa:TRX1', date: '2026-11-22', amount: 3330, merchant: 'Musterladen', place: 'Beispielstadt, CHE', status: 'open', src: 'visa' });
    expect(tx[1]).toMatchObject({ amount: 10580, origCur: 'EUR' });
  });
  test('IMP-05: Kartenzahlung wird ausgeschlossen', () => {
    const t = parseFile(csv, 'privat').tx[2];
    expect(t).toMatchObject({ status: 'excluded', merchant: 'Zahlung an Kreditkarte', amount: -150000 });
  });
  test('vorgemerkte Buchung bekommt einen Hinweis, führender Strich im Händler fällt weg', () => {
    expect(parseFile(csv, 'privat').tx[3]).toMatchObject({ merchant: 'Kiosk', note: 'Status: PENDING' });
  });
  test('ID enthält das Konto: gleiche Datei in zwei Konten kollidiert nicht', () => {
    expect(parseFile(csv, 'gemeinsam').tx[0].id).toBe('gemeinsam:visa:TRX1');
  });
});

describe('IMP-02: Bank-CSV', () => {
  // Ein Fall pro Buchungstyp: [Buchungstext, erwarteter Händler, Ort, Details-Anfang]
  test.each([
    ['TWINT-Zahlung ELEKTRO MUSTER AG, ZUERICH +41790000000 03.02.2026 09:15', 'Elektro Muster AG', 'Zuerich', 'TWINT'],
    ['TWINT-Zahlung QUARTIERLADEN SONNE NORD., BEISPIELSTADT +41790000000 04.02.2026 17:30', 'Quartierladen Sonne Nord.', 'Beispielstadt', 'TWINT'],
    ['TWINT-Zahlung GEMUESEKORB.CH, MUSTERDORF +41790000000 05.02.2026 08:05', 'Gemuesekorb.ch', 'Musterdorf', 'TWINT'],
    ['TWINT-Belastung Geld gesendet an Sara +41790000000 Pizza Abend 06.02.2026 21:10', 'Sara', '', 'TWINT gesendet · Pizza Abend'],
    ['TWINT-Belastung Geld gesendet an Peter Beispiel +41790000000 07.02.2026 22:50', 'Peter Beispiel', '', 'TWINT gesendet'],
    ['TWINT-Gutschrift Geld erhalten von Lukas Beispiel +41790000000 08.02.2026 20:00', 'Lukas Beispiel', '', 'TWINT erhalten'],
    ['Belastung e-banking / Ref.-Nr. 900001 Mobilfunk Muster SA Avenue du Lac 2 1000 Lausanne Schweiz Mitteilung: Abo Februar Ursprünglicher Auftraggeber: Max Muster 000000000000000000000000000', 'Mobilfunk Muster SA', '', 'Belastung e-banking · Abo Februar'],
    ['Belastung e-banking / Ref.-Nr. 900002 Ferienkasse Beispiel (FKB) Genossenschaft Ringgasse 15 3000 Bern Schweiz Ursprünglicher Auftraggeber: Max Muster', 'Ferienkasse Beispiel (FKB) Genossenschaft', '', 'Belastung e-banking'],
    ['Belastung e-banking / Ref.-Nr. 900003 Internet Muster GmbH Postfach 8000 Zürich Schweiz', 'Internet Muster GmbH', '', 'Belastung e-banking'],
    ['Belastung e-banking / Ref.-Nr. 900004 STIFTUNG BEISPIEL LINDENHOF 3 4000 BASEL Schweiz', 'Stiftung Beispiel', '', 'Belastung e-banking'],
    ['Belastung e-banking / Ref.-Nr. 900005 Steueramt Musterdorf 1234 Musterdorf Schweiz Mitteilung: Steuern Raten', 'Steueramt Musterdorf', '', 'Belastung e-banking · Steuern Raten'],
    ['Zahlungseingang / Ref.-Nr. 900006 MUSTER ARBEITGEBER AG BAHNHOFSTRASSE 1 CH-1000 MUSTERSTADT Referenz: WAGE/SALARY 202602', 'Muster Arbeitgeber AG', '', 'Zahlungseingang · WAGE/SALARY 202602'],
    ['Zahlungseingang / Ref.-Nr. 900007 ANNA BEISPIEL DORFSTRASSE 1 CH 1234 MUSTERDORF Referenz: RUECKZAHLUNG', 'Anna Beispiel', '', 'Zahlungseingang · RUECKZAHLUNG'],
    ['Belastung: Lastschriftverfahren / Ref.-Nr. 900008 ** Kartenherausgeber Muster AG Musterweg 1 Postfach 1000 Musterstadt Mitteilung: 0000 BELASTUNG KARTENKONTO 0000', 'Kartenherausgeber Muster AG', '', 'Belastung: Lastschriftverfahren'],
    ['Kreditkartengebühr Visa Muster ****************0000 01.01.2026 - 31.03.2026', 'Kreditkartengebühr Visa Muster', '', ''],
  ])('%s', (text, merchant, place, details) => {
    const p = parseBookingText(text);
    expect(p.merchant).toBe(merchant);
    expect(p.place).toBe(place);
    expect(p.details.startsWith(details)).toBe(true);
  });

  const csv = [BANK_HEAD,
    `12.02.2026,10.02.2026,TWINT-Gutschrift Geld erhalten von Lukas Beispiel +41790000000 10.02.2026 20:30,,15,`,
    `09.02.2026,09.02.2026," TWINT-Zahlung PAPETERIE MUSTER, BERN +41790000000 09.02.2026 11:11 ",3.4,,`,
    `06.02.2026,06.02.2026, Übertrag von 0000.0000.0000 Muster Max / Ref.-Nr. 900010 ,,1'800.00,`,
    `06.02.2026,06.02.2026, Übertrag an 0000.0000.0001 Sparkonto / Ref.-Nr. 900011 ,400,,`,
    `03.02.2026,03.02.2026, Belastung: Lastschriftverfahren / Ref.-Nr. 900012 ** Kartenherausgeber Muster AG Musterweg 1 Mitteilung: KARTENKONTO 0000 ,1'234.55,,`,
    `02.02.2026,02.02.2026,Kreditkartengebühr Visa Muster ****************0000 01.11.2025 - 31.01.2026,20,,`,
    `01.02.2026,01.02.2026,Bargeldbezug Bancomat Musterdorf,300.00,,`,
    `,,,,,`,
  ].join('\n');

  test('Valutadatum, Belastung positiv, Gutschrift negativ, Tausender mit Apostroph', () => {
    const { format, tx } = parseFile(csv, 'privat');
    expect(format).toBe('bank');
    expect(tx).toHaveLength(7);
    expect(tx[0]).toMatchObject({ date: '2026-02-10', amount: -1500, merchant: 'Lukas Beispiel' });
    expect(tx[1]).toMatchObject({ amount: 340, merchant: 'Papeterie Muster', place: 'Bern' });
    expect(tx[4].amount).toBe(123455);
  });
  test('IMP-05: Übertrag von eigenem Konto und Visa-Abbuchung ausgeschlossen; Gebühr und Übertrag an bleiben offen', () => {
    const st = parseFile(csv, 'privat').tx.map((t) => t.status);
    expect(st).toEqual(['open', 'open', 'excluded', 'open', 'excluded', 'open', 'tagged']);
  });
  test('BAR-02: Bargeldbezug zählt als Ausgabe «Bargeld › Nicht zugeordnet»', () => {
    expect(parseFile(csv, 'privat').tx[6]).toMatchObject({ status: 'tagged', cat: 'k-bargeld', sub: 'k-bargeld-1', amount: 30000 });
  });
  test('IMP-04: ID aus Ref.-Nr., sonst stabile Prüfsumme', () => {
    const a = parseFile(csv, 'privat').tx, b = parseFile(csv, 'privat').tx;
    expect(a[2].id).toBe('privat:bank:900010');
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(new Set(a.map((t) => t.id)).size).toBe(a.length);
  });
  test('deutsche Spaltennamen', () => {
    const de = 'Datum,Valuta,Buchungstext,Belastung,Gutschrift,Saldo CHF\n01.10.2026,01.10.2026,Belastung e-banking / Ref.-Nr. 1 Muster AG 1000 Musterstadt,10.00,,';
    expect(parseFile(de, 'privat').tx[0]).toMatchObject({ merchant: 'Muster AG', amount: 1000, date: '2026-10-01' });
  });
  test('Adresse abschneiden', () => {
    expect(partyName('Muster Immobilien AG Hauptstrasse 3 1234 Musterdorf')).toBe('Muster Immobilien AG');
    expect(partyName('EW Musterdorf 1234 Musterdorf Schweiz')).toBe('EW Musterdorf');
    expect(titleCase('VEREIN MUSTER & PARTNER SA')).toBe('Verein Muster & Partner SA');
    expect(titleCase('Gemischt Gross')).toBe('Gemischt Gross');
  });
});

describe('camt.053', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
<Ntry><Amt Ccy="CHF">1925.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-01-02</Dt></BookgDt><AcctSvcrRef>R1</AcctSvcrRef><AddtlNtryInf>Zahlung Kartenkonto Muster</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="CHF">1450.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-01-01</Dt></BookgDt><AcctSvcrRef>R2</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Cdtr><Pty><Nm>Muster &amp; Co Immobilien</Nm></Pty></Cdtr></RltdPties><RmtInf><Ustrd>Miete Januar</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="CHF">200.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><ValDt><Dt>2026-01-03</Dt></ValDt><AddtlNtryInf>Bargeldbezug Bancomat</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="CHF">6000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-01-25</Dt></BookgDt><AcctSvcrRef>R4</AcctSvcrRef><AddtlNtryInf>Lohn</AddtlNtryInf></Ntry>
<!-- Kommentar --></Stmt></BkToCstmrStmt></Document>`;
  test('liest Einträge mit Namensraum, Entitäten, Gutschrift negativ', () => {
    const { format, tx } = parseFile(xml, 'privat');
    expect(format).toBe('camt');
    expect(tx.map((t) => [t.date, t.amount, t.merchant, t.status])).toEqual([
      ['2026-01-02', 192500, 'Zahlung Kartenkonto Muster', 'excluded'],
      ['2026-01-01', 145000, 'Muster & Co Immobilien', 'open'],
      ['2026-01-03', 20000, 'Bargeldbezug Bancomat', 'tagged'],
      ['2026-01-25', -600000, 'Lohn', 'open'],
    ]);
  });
  test('kaputtes XML wird abgelehnt', () => {
    expect(() => parseXML('<a><b>')).toThrow();
  });
});

describe('Format erkennen', () => {
  test('unbekannte Datei', () => {
    expect(detect('x,y\n1,2')).toBeNull();
    expect(() => parseFile('x,y\n1,2', 'privat')).toThrow(/Format nicht erkannt/);
  });
});

describe('IMP-02: Bank-CSV mit Sammelbuchungen (Semikolon)', () => {
  const HEAD = 'Datum;Buchungstext;Whg;Betrag Detail;Bank-Referenz;Referenznummer;Belastung CHF;Gutschrift CHF;Valuta;Saldo CHF;Zahlungszweck;Details';
  const csv = [HEAD,
    '30.03.2026;Belastungen Dauerauftrag (2);;;R100;;2073;;30.03.2026;300.00;;',
    ';Miete;CHF;1953;;;;;;;Monatsmiete Musterweg 1;',
    ';Parkplatz;CHF;120;;;;;;;Garage;',
    '28.03.2026;Einkauf Bank Visa Debit Card Nr. xxxx 0000, FRISCHMARKT NORD;;;R101;;20.55;;27.03.2026;2373.00;;',
    '27.03.2026;Belastung aus Lastschrift mit Widerspruch: Kartenherausgeber Muster AG;;;R102;;732.3;;27.03.2026;2393.55;;',
    '25.03.2026;Gutschrift Auftraggeber: Anna Beispiel, Musterweg 1, 1234;;;R103;;;1300;25.03.2026;3125.85;MONATSMIETE;Detailangaben 1',
    '04.03.2026;Gebühr Bank Kontoführung;;;R104;;4;;28.02.2026;1825.85;;',
    '03.03.2026;Belastungen Dauerauftrag (2);;;R105;;500;;03.03.2026;1829.85;;',
    ';Posten A;CHF;100;;;;;;;;',
    ';Posten B;CHF;100;;;;;;;;',
  ].join('\n');

  test('erkannt; Sammelbuchung in Einzelposten aufgeteilt; Valuta massgebend', () => {
    const { format, tx } = parseFile(csv, 'gemeinsam');
    expect(format).toBe('bankdetail');
    expect(tx.map((t) => [t.date, t.amount, t.merchant])).toEqual([
      ['2026-03-30', 195300, 'Miete'], ['2026-03-30', 12000, 'Parkplatz'],
      ['2026-03-27', 2055, 'Frischmarkt Nord'],
      ['2026-03-27', 73230, 'Kartenherausgeber Muster AG'],
      ['2026-03-25', -130000, 'Anna Beispiel'],
      ['2026-02-28', 400, 'Gebühr Bank Kontoführung'],
      ['2026-03-03', 50000, 'Belastungen Dauerauftrag (2)'],
    ]);
    expect(tx[0]).toMatchObject({ id: 'gemeinsam:bank:R100-1', details: 'Belastungen Dauerauftrag (2) · Monatsmiete Musterweg 1' });
    expect(tx[4].details).toBe('Gutschrift · MONATSMIETE · Detailangaben 1');
  });
  test('Einzelposten, die nicht aufgehen: Sammelbuchung bleibt ganz, mit Hinweis', () => {
    expect(parseFile(csv, 'gemeinsam').tx[6].note).toContain('Sammelbuchung');
  });
  test('IMP-05: Kreditkarten-Abbuchung über Stichwort des Nutzers ausgeschlossen', () => {
    expect(parseFile(csv, 'gemeinsam').tx[3].status).toBe('open');
    expect(parseFile(csv, 'gemeinsam', ['kartenherausgeber muster']).tx[3]).toMatchObject({ status: 'excluded', note: 'Kreditkartenzahlung (Transfer)' });
    expect(parseFile(csv, 'gemeinsam', ['  ', '']).tx[3].status).toBe('open');
  });
  test('IMP-04: gleiche IDs bei erneutem Lesen', () => {
    expect(parseFile(csv, 'gemeinsam').tx.map((t) => t.id)).toEqual(parseFile(csv, 'gemeinsam').tx.map((t) => t.id));
  });
});
