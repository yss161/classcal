import { analyzeTable, collectCourses, matrixToTable } from "./jw/grid.ts";
import { parseCsv } from "./parse-csv.ts";
import { readXlsx, type Workbook } from "./xlsx.ts";
import type { Course, Term } from "./model.ts";

export interface XlsxParseResult {
  courses: Course[];
  warnings: string[];
  /** 命中的工作表名 */
  sheet: string;
  /** 命中方式：grid = 星期×节次 课表；list = 一行一门课的列表 */
  mode: "grid" | "list" | "none";
}

function mergeCourses(list: Course[]): Course[] {
  const map = new Map<string, Course>();
  for (const c of list) {
    const key = [c.name, c.day, c.start, c.end].join("|");
    const hit = map.get(key);
    if (hit) {
      hit.weeks = [...new Set([...hit.weeks, ...c.weeks])].sort((a, b) => a - b);
      if (!hit.loc && c.loc) hit.loc = c.loc;
      if (!hit.teacher && c.teacher) hit.teacher = c.teacher;
    } else map.set(key, { ...c });
  }
  return [...map.values()].sort((a, b) => a.day - b.day || a.start - b.start);
}

/** 一张工作表 → 课程（先按「星期×节次」课表解析，不行再按列表式解析） */
export function parseSheet(sheetRows: string[][], merges: { r1: number; c1: number; r2: number; c2: number }[], term: Term): { courses: Course[]; mode: "grid" | "list" | "none" } {
  // 1) 课表式
  const table = matrixToTable(sheetRows, merges);
  const layout = analyzeTable(table.cells);
  if (layout.weekdayCols >= 2 && layout.periodRows >= 1) {
    const got = collectCourses(table, layout, term);
    if (got.courses.length) return { courses: mergeCourses(got.courses), mode: "grid" };
  }

  // 2) 列表式（一行一门课：课程,星期,节次,周次,教室,教师）
  const csvText = sheetRows.map((r) => r.map((c) => String(c || "").replace(/,/g, "，")).join(",")).join("\n");
  const asCsv = parseCsv(csvText, term);
  if (asCsv.courses.length) return { courses: mergeCourses(asCsv.courses), mode: "list" };

  return { courses: [], mode: "none" };
}

/** 整个工作簿 → 课程（挑课程数最多的工作表） */
export function parseWorkbook(wb: Workbook, term: Term): XlsxParseResult {
  const warnings: string[] = [];
  let best: { courses: Course[]; sheet: string; mode: "grid" | "list" | "none" } = { courses: [], sheet: "", mode: "none" };

  for (const sheet of wb.sheets) {
    const r = parseSheet(sheet.rows, sheet.merges, term);
    if (r.courses.length > best.courses.length) best = { courses: r.courses, sheet: sheet.name, mode: r.mode };
  }

  if (!best.courses.length) {
    warnings.push(
      "Excel 里没解析出课程。需要是「星期 × 节次」的课表，或者带表头的一行一门课（课程名/星期/节次/周次）。工作表：" +
        wb.sheets.map((s) => s.name).join("、")
    );
  } else if (wb.sheets.length > 1) {
    warnings.push("工作簿里有 " + wb.sheets.length + " 张表，已用课程最多的那张：" + best.sheet);
  }
  return { courses: best.courses, warnings, sheet: best.sheet, mode: best.mode };
}

/** base64 → 课程（Web 端上传用） */
export async function parseXlsxBase64(base64: string, term: Term): Promise<XlsxParseResult> {
  const wb = await readXlsx(fromBase64Local(base64));
  return parseWorkbook(wb, term);
}

function fromBase64Local(text: string): Uint8Array {
  const clean = String(text || "").replace(/^data:[^,]*base64,/, "").replace(/\s/g, "");
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
