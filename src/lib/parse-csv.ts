import { mergeCourses, type ParseResult } from "./parse-text.ts";
import { parseWeeks, type Course, type Term } from "./model.ts";

const DAY_MAP: Record<string, number> = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7,
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function detectHeader(cells: string[]): Record<string, number> | null {
  const idx: Record<string, number> = {};
  cells.forEach((c, i) => {
    const v = c.toLowerCase().replace(/\s/g, "");
    if (!("name" in idx) && /(课程名|课程|课名|名称|subject|course|name)/.test(v)) idx.name = i;
    else if (!("day" in idx) && /(星期|周几|day|weekday)/.test(v)) idx.day = i;
    else if (!("period" in idx) && /(节次|节|period|section)/.test(v)) idx.period = i;
    else if (!("start" in idx) && /(开始节|起始节|start)/.test(v)) idx.start = i;
    else if (!("end" in idx) && /(结束节|终止节|end)/.test(v)) idx.end = i;
    else if (!("weeks" in idx) && /(周次|周数|week)/.test(v)) idx.weeks = i;
    else if (!("loc" in idx) && /(教室|地点|位置|location|room|place)/.test(v)) idx.loc = i;
    else if (!("teacher" in idx) && /(教师|老师|任课|teacher)/.test(v)) idx.teacher = i;
  });
  return "name" in idx && ("period" in idx || "start" in idx) ? idx : null;
}

function parseDay(s: string): number {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return 0;
  if (DAY_MAP[v]) return DAY_MAP[v];
  const m = /(?:周|星期|礼拜)?\s*([一二三四五六日天1-7])/.exec(v);
  if (m && DAY_MAP[m[1]]) return DAY_MAP[m[1]];
  const e = /^(mon|tue|wed|thu|fri|sat|sun)/.exec(v);
  if (e) return DAY_MAP[e[1]] || 0;
  return 0;
}

function parsePeriod(s: string): { start: number; end: number } | null {
  const v = String(s || "").trim();
  const m = /(\d{1,2})\s*[-–—~～至到]\s*(\d{1,2})/.exec(v);
  if (m) return { start: +m[1], end: +m[2] };
  const s1 = /(\d{1,2})/.exec(v);
  if (s1) return { start: +s1[1], end: +s1[1] };
  return null;
}

export function parseCsv(text: string, term: Term): ParseResult {
  const warnings: string[] = [];
  const rows = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!rows.length) return { courses: [], warnings: ["CSV 内容为空"] };

  const header = detectHeader(splitCsvLine(rows[0]));
  const dataRows = header ? rows.slice(1) : rows;
  if (!header) warnings.push("没识别到表头，按「课程名,星期,节次,周次,教室,教师」顺序解析");

  const courses: Course[] = [];
  dataRows.forEach((row, i) => {
    const cells = splitCsvLine(row);
    const pick = (k: string, fallback: number) => (header && typeof header[k] === "number" ? cells[header[k]] : cells[fallback]);
    const name = String(pick("name", 0) || "").trim();
    const day = parseDay(String(pick("day", 1) || ""));
    const periodSrc = header && "start" in header
      ? String(cells[header.start] || "") + "-" + String(header && "end" in header ? cells[header.end] || cells[header.start] || "" : cells[header.start] || "")
      : String(pick("period", 2) || "");
    const periods = parsePeriod(periodSrc);
    const weeks = parseWeeks(String(pick("weeks", 3) || ""), term.weeks);
    const loc = String(pick("loc", 4) || "").trim();
    const teacher = String(pick("teacher", 5) || "").trim();
    if (!name || !day || !periods || !weeks.length) {
      warnings.push("第 " + (i + (header ? 2 : 1)) + " 行数据不完整，已跳过：" + row.slice(0, 60));
      return;
    }
    courses.push({ name, day, start: periods.start, end: periods.end, weeks, loc: loc || undefined, teacher: teacher || undefined });
  });

  return { courses: mergeCourses(courses, term), warnings };
}
