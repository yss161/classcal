export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* ---------------- 生成一个真正的 xlsx（ZIP + deflate），给测试当夹具 ---------------- */

const enc = new TextEncoder();
let crcTable: number[] | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const feeder = (async () => { try { await writer.write(bytes as unknown as BufferSource); await writer.close(); } catch {} })();
  const buf = await new Response(stream.readable).arrayBuffer();
  await feeder;
  return new Uint8Array(buf);
}

export async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const comp = await deflateRaw(data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, comp);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + comp.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + eocd.length);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

const SHARED = ["节次", "星期一", "星期二", "星期三", "第1-2节", "第3-4节",
  "高等数学\n1-16周\n教1-101\n张老师",
  "大学英语\n1-16周(单)\n外语楼302",
  "程序设计\n1-8,10-16周\n机房A\n教师：陈老师",
  "课程名称", "星期", "节次", "周次", "教室", "教师",
  "线性代数", "周二", "5-6", "1-8", "教2-201", "李老师",
  "体育", "周五", "7-8", "1-16", "田径场", "赵老师"];

const sharedXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${SHARED.length}" uniqueCount="${SHARED.length}">
${SHARED.map((s) => "<si><t>" + s.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</t></si>").join("\n")}
</sst>`;

const sheetGrid = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>2026-2027学年第一学期 课表</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c><c r="D2" t="s"><v>3</v></c></row>
<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>6</v></c><c r="C3" t="s"><v>7</v></c></row>
<row r="4"><c r="A4" t="s"><v>5</v></c><c r="D4" t="s"><v>8</v></c></row>
</sheetData>
<mergeCells count="1"><mergeCell ref="B3:B4"/></mergeCells>
</worksheet>`;

const sheetList = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1">${["A", "B", "C", "D", "E", "F"].map((col, i) => `<c r="${col}1" t="s"><v>${9 + i}</v></c>`).join("")}</row>
<row r="2">${["A", "B", "C", "D", "E", "F"].map((col, i) => `<c r="${col}2" t="s"><v>${15 + i}</v></c>`).join("")}</row>
<row r="3">${["A", "B", "C", "D", "E", "F"].map((col, i) => `<c r="${col}3" t="s"><v>${21 + i}</v></c>`).join("")}</row>
</sheetData>
</worksheet>`;

const workbookXml = (sheets: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n")}
</sheets>
</workbook>`;

const relsXml = (sheets: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

/** 造一个测试用 xlsx：课表式 + 列表式两个 sheet 任意组合 */
export async function makeXlsxSample(opts: { grid?: boolean; list?: boolean }): Promise<Uint8Array> {
  const names: string[] = [];
  const files: Record<string, string> = {};
  if (opts.grid) names.push("课表");
  if (opts.list) names.push("课程列表");
  files["xl/workbook.xml"] = workbookXml(names);
  files["xl/_rels/workbook.xml.rels"] = relsXml(names);
  files["xl/sharedStrings.xml"] = sharedXml;
  if (opts.grid) files["xl/worksheets/sheet1.xml"] = sheetGrid;
  if (opts.list) files["xl/worksheets/sheet" + (opts.grid ? 2 : 1) + ".xml"] = sheetList;
  return buildZip(files);
}
