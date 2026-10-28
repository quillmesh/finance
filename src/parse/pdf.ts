// Eigener, kleiner PDF-Leser (IMP-09): Text mit Position aus einfachen PDFs, ohne fremde Bibliothek.
// Unterstützt: unkomprimierte und FlateDecode-Ströme (entpackt vom Browser), Objekt-Ströme, Seitenbaum,
// Textbefehle Tm/Td/TD/T*/TL/'/"/Tj/TJ, Schriften mit WinAnsi-Kodierung.
// Nicht unterstützt: verschlüsselte PDFs, Schriften mit eigener Zeichentabelle (dann wird der Text unlesbar
// und das Format nicht erkannt) – die Summenkontrolle beim Import fängt fehlende Zeilen ab.

export interface PdfCell { x: number; text: string }
export interface PdfLine { page: number; y: number; cells: PdfCell[] }

/** Windows-1252 (WinAnsi) → Unicode für die Zeichen 0x80–0x9F; der Rest entspricht Latin-1 */
const WIN: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
const winAnsi = (s: string) => s.replace(/[\x80-\x9f]/g, (c) => WIN[c.charCodeAt(0)] ?? c);

function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

export const isPdf = (b: Uint8Array) => latin1(b.subarray(0, 1024)).includes('%PDF-');

async function inflate(b: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Obj { dict: string; stream?: Uint8Array }
const refs = (s: string) => [...s.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => +x[1]);

async function streamText(o: Obj): Promise<string> {
  if (!o.stream) return '';
  const f = o.dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] ?? '';
  const filters = f.match(/\/\w+/g) ?? [];
  let b = o.stream;
  for (const x of filters) {
    if (x === '/FlateDecode') b = await inflate(b);
    else return ''; // Bilder (DCTDecode) und Unbekanntes: kein Text
  }
  return latin1(b);
}

/** Alle Objekte „n 0 obj … endobj“, Länge der Ströme aufgelöst, Objekt-Ströme entpackt */
async function objects(bytes: Uint8Array): Promise<Map<number, Obj>> {
  const s = latin1(bytes);
  const m = new Map<number, Obj>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let r: RegExpExecArray | null;
  const lengths: { o: Obj; len: string }[] = [];
  while ((r = re.exec(s))) {
    const start = r.index + r[0].length;
    const si = s.indexOf('stream', start);
    const ei = s.indexOf('endobj', start);
    if (ei < 0) break;
    let o: Obj;
    if (si >= 0 && si < ei && s.slice(start, si).includes('>>')) {
      const nl = s[si + 6] === '\r' && s[si + 7] === '\n' ? 8 : 7;
      const end = s.lastIndexOf('endstream', ei);
      o = { dict: s.slice(start, si), stream: bytes.subarray(si + nl, end > si ? end : ei) };
      const L = o.dict.match(/\/Length\s+(\d+)(\s+\d+\s+R)?/);
      if (L) lengths.push({ o, len: L[2] ? `ref:${L[1]}` : L[1] });
    } else o = { dict: s.slice(start, ei) };
    m.set(+r[1], o);
    re.lastIndex = ei;
  }
  for (const { o, len } of lengths) {
    const n = len.startsWith('ref:') ? parseInt(m.get(+len.slice(4))?.dict.trim() ?? '', 10) : +len;
    if (Number.isFinite(n) && n >= 0 && n <= o.stream!.length) o.stream = o.stream!.subarray(0, n);
  }
  // Objekt-Ströme (PDF 1.5): enthalten weitere Objekte ohne eigenes „obj … endobj“
  for (const o of [...m.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const n = +(o.dict.match(/\/N\s+(\d+)/)?.[1] ?? 0), first = +(o.dict.match(/\/First\s+(\d+)/)?.[1] ?? 0);
    let t = '';
    try { t = await streamText(o); } catch { continue; }
    const head = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const id = head[2 * i], off = first + head[2 * i + 1], next = i + 1 < n ? first + head[2 * i + 3] : t.length;
      if (Number.isFinite(id) && !m.has(id)) m.set(id, { dict: t.slice(off, next) });
    }
  }
  return m;
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const ID: M = [1, 0, 0, 1, 0, 0];

function literal(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') { out += c; continue; }
    const n = raw[++i];
    if (n === undefined) break;
    if (n >= '0' && n <= '7') {
      let o = n;
      while (o.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') o += raw[++i];
      out += String.fromCharCode(parseInt(o, 8) & 0xff);
    } else if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b') out += '\b';
    else if (n === 'f') out += '\f';
    else if (n === '\r' || n === '\n') { if (n === '\r' && raw[i + 1] === '\n') i++; }
    else out += n;
  }
  return winAnsi(out);
}
function hexString(h: string): string {
  const c = h.replace(/\s/g, '');
  let s = '';
  for (let i = 0; i < c.length; i += 2) s += String.fromCharCode(parseInt(c.slice(i, i + 2).padEnd(2, '0'), 16));
  return winAnsi(s);
}

// Zeichenketten (mit verschachtelten Klammern), Hex-Strings, Arrays, Namen, Zahlen, Operatoren; Wörterbücher werden übersprungen
const TOKEN = /\((?:\\[\s\S]|[^\\()]|\((?:\\[\s\S]|[^\\()])*\))*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s/[\]()<>{}%]+|[+-]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"*]+|%[^\r\n]*/g;

/**
 * Text eines Inhaltsstroms als Zellen mit Position. Ein grosser Abstand innerhalb eines TJ-Befehls
 * (wie zwischen Datum, Valuta und Text) beginnt eine neue Zelle, ein mittlerer gilt als Leerzeichen.
 */
function textRuns(content: string, page: number, out: { page: number; x: number; y: number; text: string }[]) {
  let lm: M = ID, ctm: M = ID, tl = 0, arr: string[] | null = null, depth = 0;
  const ctmStack: M[] = [];
  const stack: string[] = [];
  const show = (items: string[]) => {
    const d = mul(lm, ctm);
    let cur = '', k = 0;
    const push = () => { if (cur.trim()) out.push({ page, x: d[4] + k++ * 0.001, y: d[5], text: cur.replace(/\s+/g, ' ').trim() }); cur = ''; };
    for (const it of items) {
      if (it[0] === '(') cur += literal(it.slice(1, -1));
      else if (it[0] === '<') cur += hexString(it.slice(1, -1));
      else { const n = +it; if (n < -250) push(); else if (n < -150) cur += ' '; }
    }
    push();
  };
  let t: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((t = TOKEN.exec(content))) {
    const v = t[0];
    if (v[0] === '%') continue;
    if (v === '<<') { depth++; continue; }
    if (v === '>>') { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    if (v === '[') { arr = []; continue; }
    if (v === ']') { stack.push('\u0000' + JSON.stringify(arr ?? [])); arr = null; continue; }
    if (arr) { arr.push(v); continue; }
    if (!/^[A-Za-z'"*]+$/.test(v) || v === 'true' || v === 'false' || v === 'null') { stack.push(v); continue; }
    const n = (i: number) => +stack[stack.length - i];
    const six = (): M => [n(6), n(5), n(4), n(3), n(2), n(1)];
    switch (v) {
      case 'q': ctmStack.push(ctm); break;
      case 'Q': ctm = ctmStack.pop() ?? ID; break;
      case 'cm': ctm = mul(six(), ctm); break;
      case 'BT': lm = ID; break;
      case 'TL': tl = n(1); break;
      case 'Tm': lm = six(); break;
      case 'Td': lm = mul([1, 0, 0, 1, n(2), n(1)], lm); break;
      case 'TD': tl = -n(1); lm = mul([1, 0, 0, 1, n(2), n(1)], lm); break;
      case 'T*': lm = mul([1, 0, 0, 1, 0, -tl], lm); break;
      case 'Tj': case 'TJ': case "'": case '"': {
        if (v === "'" || v === '"') lm = mul([1, 0, 0, 1, 0, -tl], lm);
        const top = stack[stack.length - 1] ?? '';
        show(top[0] === '\u0000' ? JSON.parse(top.slice(1)) : [top]);
        break;
      }
    }
    stack.length = 0;
  }
}

/** Gruppiert Zellen mit gleicher Höhe (±1.5 pt) zu Zeilen, von oben nach unten und links nach rechts */
export function groupLines(runs: { page: number; x: number; y: number; text: string }[]): PdfLine[] {
  const sorted = [...runs].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const res: PdfLine[] = [];
  for (const r of sorted) {
    const last = res[res.length - 1];
    if (last && last.page === r.page && Math.abs(last.y - r.y) < 1.5) last.cells.push({ x: r.x, text: r.text });
    else res.push({ page: r.page, y: r.y, cells: [{ x: r.x, text: r.text }] });
  }
  for (const l of res) l.cells.sort((a, b) => a.x - b.x);
  return res;
}

/** Liest alle Textzeilen eines PDFs in Seitenreihenfolge. Wirft einen Fehler, wenn das PDF nicht lesbar ist. */
export async function pdfLines(bytes: Uint8Array): Promise<PdfLine[]> {
  if (!isPdf(bytes)) throw new Error('Keine PDF-Datei');
  const m = await objects(bytes);
  if ([...m.values()].some((o) => /\/Encrypt\b/.test(o.dict))) throw new Error('Das PDF ist verschlüsselt und kann nicht gelesen werden.');
  const catalog = [...m.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const pages: number[] = [];
  const seen = new Set<number>();
  const walk = (id: number) => {
    const o = m.get(id);
    if (!o || seen.has(id)) return;
    seen.add(id);
    if (/\/Type\s*\/Pages\b/.test(o.dict)) for (const k of refs(o.dict.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] ?? '')) walk(k);
    else if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(id);
  };
  const root = catalog?.dict.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
  if (root) walk(+root[1]);
  if (!pages.length) throw new Error('Im PDF wurden keine Seiten gefunden.');
  const runs: { page: number; x: number; y: number; text: string }[] = [];
  for (let p = 0; p < pages.length; p++) {
    const c = m.get(pages[p])!.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/);
    let text = '';
    for (const id of refs(c?.[1] ?? '')) {
      const o = m.get(id);
      if (o) text += (await streamText(o)) + '\n';
    }
    textRuns(text, p + 1, runs);
  }
  return groupLines(runs);
}
