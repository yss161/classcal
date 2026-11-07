/**
 * 极简 XLSX 读取器（零依赖）。
 *
 * .xlsx 本质是一个 ZIP，里面是几份 XML：
 *   xl/workbook.xml            工作表列表
 *   xl/_rels/workbook.xml.rels 工作表 id → 文件路径
 *   xl/sharedStrings.xml       共享字符串池
 *   xl/worksheets/sheetN.xml   单元格与合并区域
 *
 * 所以这里只需要：① ZIP 解压（stored / deflate 两种）② 三个 XML 的正则解析。
 * 运行环境只要有 DecompressionStream 即可（Worker / Node 18+ 都有）。
 */

export interface SheetData {
  name: string;
  rows: string[][];
  merges: { r1: number; c1: number; r2: number; c2: number }[];
}

export interface Workbook {
  sheets: SheetData[];
}

/* ---------------- ZIP ---------------- */

const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const feeder = (async () => {
    try {
      await writer.write(bytes as unknown as BufferSource);
      await writer.close();
    } catch {
      /* 读端会给出真正的错误 */
    }
  })();
  try {
    const buf = await new Response(stream.readable).arrayBuffer();
    await feeder;
    return new Uint8Array(buf);
  } finally {
    await feeder;
  }
}

/** 解出 ZIP 里所有文件（只支持 stored / deflate，足够 xlsx 用） */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  // 找 EOCD（从尾部往前找签名）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 xlsx/zip 文件（找不到 ZIP 目录）");

  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (!(bytes[p] === 0x50 && bytes[p + 1] === 0x4b && bytes[p + 2] === 0x01 && bytes[p + 3] === 0x02)) break;
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    const name = utf8(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (localOff + 30 > bytes.length) continue;
    const localNameLen = u16(bytes, localOff + 26);
    const localExtraLen = u16(bytes, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    try {
      out.set(name, method === 0 ? raw : await inflateRaw(raw));
    } catch {
      /* 单个文件坏了不影响其他文件 */
    }
  }
  return out;
}

/* ---------------- XML ---------------- */

function decodeXml(s: string): string {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, "&");
}

/** 去掉标签只留文本（富文本 run 会拼在一起） */
function textOf(xml: string): string {
  const parts: string[] = [];
  const re = /<t(?:[^>]*)>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) parts.push(decodeXml(m[1]));
  if (parts.length) return parts.join("");
  return "";
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si(?:[^>]*)>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1]));
  return out;
}

interface SheetRef { name: string; rid: string }

function parseWorkbook(xml: string): SheetRef[] {
  const out: SheetRef[] = [];
  const re = /<sheet\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const name = /\bname="([^"]*)"/.exec(attrs);
    const rid = /\br:id="([^"]*)"|\bid="(rId\d+)"/.exec(attrs);
    out.push({ name: decodeXml(name ? name[1] : "Sheet" + (out.length + 1)), rid: rid ? rid[1] || rid[2] : "" });
  }
  return out;
}

function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<Relationship\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const id = /\bId="([^"]*)"/.exec(m[1]);
    const target = /\bTarget="([^"]*)"/.exec(m[1]);
    if (id && target) map.set(id[1], target[1].replace(/^\.?\//, ""));
  }
  return map;
}

function colIndex(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowIndex(ref: string): number {
  const m = /([0-9]+)/.exec(ref || "");
  return m ? +m[1] - 1 : -1;
}

function parseSheet(xml: string, shared: string[]): { rows: string[][]; merges: SheetData["merges"] } {
  const rows: string[][] = [];
  const merges: SheetData["merges"] = [];

  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]);
    const r = rAttr ? +rAttr[1] - 1 : rows.length;
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[2]))) {
      const attrs = cm[1];
      const body = cm[2] || "";
      const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs);
      let c = ref ? colIndex(ref[1]) : cells.length;
      if (c < 0) c = cells.length;
      const type = (/\bt="([^"]+)"/.exec(attrs) || [])[1] || "";
      let value = "";
      if (type === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (v) value = shared[+v[1]] || "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else if (type === "str") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? decodeXml(v[1]) : "";
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? decodeXml(v[1]) : "";
      }
      while (cells.length < c) cells.push("");
      cells[c] = String(value).replace(/\u00a0/g, " ").trim();
    }
    rows[r] = cells;
  }

  const mergeRe = /<mergeCell\b[^>]*ref="([^"]+)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = mergeRe.exec(xml))) {
    const parts = mm[1].split(":");
    if (parts.length !== 2) continue;
    merges.push({ r1: rowIndex(parts[0]), c1: colIndex(parts[0]), r2: rowIndex(parts[1]), c2: colIndex(parts[1]) });
  }

  // 补齐稀疏行/列
  const maxCols = rows.reduce((n, r) => Math.max(n, r ? r.length : 0), 0);
  const filled: string[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const src = rows[r] || [];
    const row: string[] = [];
    for (let c = 0; c < maxCols; c++) row.push(src[c] || "");
    filled.push(row);
  }
  return { rows: filled, merges };
}

/** 读一个 xlsx，返回工作表内容 */
export async function readXlsx(bytes: Uint8Array): Promise<Workbook> {
  if (!bytes || bytes.length < 100) throw new Error("文件太小，不像 xlsx");
  // 老版 .xls（OLE2）不是 zip，直接给出明确提示
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new Error("这是老版 .xls 格式，请在 Excel/WPS 里「另存为 .xlsx」后再导入");
  }

  const files = await unzip(bytes);
  const get = (p: string) => (files.has(p) ? utf8(files.get(p)!) : "");
  const shared = parseSharedStrings(get("xl/sharedStrings.xml"));
  const rels = parseRels(get("xl/_rels/workbook.xml.rels"));
  const sheetRefs = parseWorkbook(get("xl/workbook.xml"));

  const sheets: SheetData[] = [];
  const names = sheetRefs.length ? sheetRefs : [{ name: "Sheet1", rid: "" }];
  let fallbackIndex = 1;
  for (const ref of names) {
    const target = (ref.rid && rels.get(ref.rid)) || "";
    const candidates = [
      target ? "xl/" + target : "",
      "xl/worksheets/sheet" + fallbackIndex + ".xml",
    ].filter(Boolean);
    let xml = "";
    for (const c of candidates) {
      if (files.has(c)) { xml = utf8(files.get(c)!); break; }
    }
    fallbackIndex++;
    if (!xml) continue;
    const parsed = parseSheet(xml, shared);
    if (!parsed.rows.length) continue;
    sheets.push({ name: ref.name, rows: parsed.rows, merges: parsed.merges });
  }

  if (!sheets.length) throw new Error("这个 xlsx 里没有读到工作表内容");
  return { sheets };
}

/** 标准 base64 → 字节（xlsx 走 JSON 时用） */
export function fromBase64(text: string): Uint8Array {
  const clean = String(text || "").replace(/^data:[^,]*base64,/, "").replace(/\s/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    if (ch === "=") break;
    const v = table.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
