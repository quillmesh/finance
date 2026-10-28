// Kontoauszug camt.053 (ISO 20022, XML). Eigener kleiner XML-Leser ohne Browser-DOM,
// damit die Logik auch in den Unit-Tests läuft.
import { parseRappen } from '../money';
import type { Tx } from '../types';
import { hash } from './csv';
import { CASH_CAT, CASH_SUB } from '../defaults';
import { isCardPayment, isCashWithdrawal, newTx } from './common';

interface XNode { name: string; attrs: Record<string, string>; kids: XNode[]; text: string }

const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
  const map: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  if (map[e.toLowerCase()]) return map[e.toLowerCase()];
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return m;
});

/** Minimaler XML-Leser: Elemente, Attribute, Text. Namensräume werden entfernt (Präfix weg). */
export function parseXML(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^.*:/, '')] = decode(a[2] ?? a[3] ?? '');
      const node: XNode = { name: m[3].replace(/^.*:/, ''), attrs, kids: [], text: '' };
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  if (stack.length !== 1) throw new Error('XML ist unvollständig');
  return root;
}

const kids = (n: XNode | null | undefined, name: string) => (n ? n.kids.filter((k) => k.name === name) : []);
function at(n: XNode | null | undefined, path: string): XNode | null {
  let cur: XNode[] = n ? [n] : [];
  for (const p of path.split('/')) { cur = cur.flatMap((c) => kids(c, p)); if (!cur.length) return null; }
  return cur[0];
}
const txt = (n: XNode | null | undefined, path: string) => at(n, path)?.text.trim() ?? '';
function* all(n: XNode, name: string): Generator<XNode> {
  for (const k of n.kids) { if (k.name === name) yield k; else yield* all(k, name); }
}

export const isCamt = (text: string) => /<\?xml|<Document/.test(text.slice(0, 500)) && /camt\.05[234]/.test(text.slice(0, 3000));

export function parseCamt(text: string, acc: string, cardWords: string[] = []): Tx[] {
  const doc = parseXML(text);
  const out: Tx[] = [];
  for (const e of all(doc, 'Ntry')) {
    const amtEl = at(e, 'Amt');
    if (!amtEl) continue;
    const amt = parseRappen(amtEl.text);
    if (isNaN(amt)) continue;
    const dbit = txt(e, 'CdtDbtInd') === 'DBIT';
    const date = (txt(e, 'BookgDt/Dt') || txt(e, 'BookgDt/DtTm') || txt(e, 'ValDt/Dt') || txt(e, 'ValDt/DtTm')).slice(0, 10);
    const td = at(e, 'NtryDtls/TxDtls');
    const role = dbit ? 'Cdtr' : 'Dbtr';
    const party = txt(td, `RltdPties/${role}/Nm`) || txt(td, `RltdPties/${role}/Pty/Nm`);
    const rmt = txt(td, 'RmtInf/Ustrd');
    const addl = txt(e, 'AddtlNtryInf') || txt(td, 'AddtlTxInf');
    const ref = txt(e, 'AcctSvcrRef') || txt(td, 'Refs/AcctSvcrRef') || txt(e, 'NtryRef');
    const amount = dbit ? amt : -amt;
    const t = newTx({
      id: `${acc}:camt:${ref || hash(`${date}|${amount}|${addl}|${party}|${rmt}`)}`, acc, src: 'bank', date, amount,
      cur: amtEl.attrs.Ccy || 'CHF', merchant: party || addl || rmt || 'Bankbuchung', details: [addl, rmt].filter(Boolean).join(' · '),
    });
    const all3 = `${party} ${addl} ${rmt}`;
    if (isCardPayment(all3, cardWords)) Object.assign(t, { status: 'excluded', note: 'Kreditkartenzahlung (Transfer)' });
    else if (isCashWithdrawal(all3)) Object.assign(t, { status: 'tagged', cat: CASH_CAT, sub: CASH_SUB, note: 'Bargeldbezug' });
    out.push(t);
  }
  return out;
}
