import { dateOf, fmtDate, mondayOf, parseDateMs, parseHHMM, weekdayMon1, WEEKDAY_CN } from "./dates.ts";

export interface Period {
  /** 开始时间 "08:00" */
  s: string;
  /** 结束时间 "08:45" */
  e: string;
}

export interface Term {
  /** 学期名，会成为日历名 */
  name: string;
  /** 第 1 周周一，YYYY-MM-DD */
  start: string;
  /** 学期总周数 */
  weeks: number;
  /** 时区 */
  tz: string;
  /** 节次时间表，下标 0 = 第 1 节 */
  periods: Period[];
  /** 课前提醒分钟数，0 = 不提醒 */
  alarm: number;
}

export interface Course {
  /** 课程名 */
  name: string;
  /** 1=周一 ... 7=周日 */
  day: number;
  /** 起始节 */
  start: number;
  /** 结束节 */
  end: number;
  /** 上课周次列表，升序去重 */
  weeks: number[];
  /** 教室 */
  loc?: string;
  /** 教师 */
  teacher?: string;
}

export interface Timetable {
  term: Term;
  courses: Course[];
}

export const DEFAULT_PERIODS: Period[] = [
  { s: "08:00", e: "08:45" },
  { s: "08:55", e: "09:40" },
  { s: "10:00", e: "10:45" },
  { s: "10:55", e: "11:40" },
  { s: "14:00", e: "14:45" },
  { s: "14:55", e: "15:40" },
  { s: "16:00", e: "16:45" },
  { s: "16:55", e: "17:40" },
  { s: "19:00", e: "19:45" },
  { s: "19:55", e: "20:40" },
  { s: "20:50", e: "21:35" },
  { s: "21:45", e: "22:30" },
];

export function defaultTerm(): Term {
  // 默认：本学期开学日期留空时，用「下一个周一」占位
  const now = Date.now();
  const start = fmtDate(mondayOf(now));
  return { name: "我的课表", start, weeks: 18, tz: "Asia/Shanghai", periods: DEFAULT_PERIODS.map((p) => ({ ...p })), alarm: 10 };
}

export function defaultTimetable(): Timetable {
  return { term: defaultTerm(), courses: [] };
}

/* ---------------- 周次 ---------------- */

/** 解析 "1-16" / "1-16单" / "1,3,5-9" / "1-16o" / "1-16e" 等写法 */
export function parseWeeks(spec: string, total: number): number[] {
  const out = new Set<number>();
  const cap = total > 0 ? total : 30;
  const raw = String(spec || "")
    .replace(/周次?/g, " ")
    .replace(/[（(）)\[]/g, "")
    .replace(/[\]）]/g, "")
    .replace(/，/g, ",")
    .replace(/[~～至到]/g, "-")
    .trim();
  if (!raw) return [];
  // "(单)" 被拆成独立的一段时，粘回前一段
  const chunks: string[] = [];
  for (const piece of raw.split(/[,、\s]+/).filter(Boolean)) {
    if (/^[单双]$/.test(piece) && chunks.length) chunks[chunks.length - 1] += piece;
    else chunks.push(piece);
  }
  for (const chunkRaw of chunks) {
    let chunk = chunkRaw.trim();
    if (!chunk) continue;
    let parity = 0;
    if (/(单|odd|o)$/i.test(chunk)) { parity = 1; chunk = chunk.replace(/(单|odd|o)$/i, ""); }
    else if (/(双|even|e)$/i.test(chunk)) { parity = 2; chunk = chunk.replace(/(双|even|e)$/i, ""); }
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(chunk);
    if (!m) continue;
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    if (!isFinite(a) || !isFinite(b)) continue;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(cap, Math.max(a, b));
    for (let w = lo; w <= hi; w++) {
      if (parity === 1 && w % 2 === 0) continue;
      if (parity === 2 && w % 2 === 1) continue;
      out.add(w);
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** 周次列表 -> 紧凑写法，例如 [1..16] => "1-16"，[1,3,5] => "1-5单" */
export function weeksToSpec(weeks: number[]): string {
  const arr = [...new Set(weeks.filter((w) => w > 0))].sort((a, b) => a - b);
  if (!arr.length) return "";
  // 等差（全部奇/偶）时用单双周写法
  if (arr.length > 2) {
    const step2 = arr[1] - arr[0];
    const isArith = arr.every((w, i) => i === 0 || w - arr[i - 1] === step2);
    if (isArith && (step2 === 1 || step2 === 2)) {
      const tag = step2 === 2 ? (arr[0] % 2 === 1 ? "单" : "双") : "";
      return arr[0] + "-" + arr[arr.length - 1] + tag;
    }
  }
  const parts: string[] = [];
  let i = 0;
  while (i < arr.length) {
    let j = i;
    let step = arr.length > i + 1 ? arr[i + 1] - arr[i] : 1;
    while (j + 1 < arr.length && arr[j + 1] - arr[j] === step) j++;
    if (j - i >= 2 && step === 1) parts.push(arr[i] + "-" + arr[j]);
    else for (let k = i; k <= j; k++) parts.push(String(arr[k]));
    i = j + 1;
  }
  return parts.join(",");
}

/** 把周次切成「等差数列段」，用于生成 RRULE；[1..8,10..16] => 两段 */
export function weekRuns(weeks: number[]): { start: number; step: number; count: number }[] {
  const arr = [...new Set(weeks.filter((w) => w > 0))].sort((a, b) => a - b);
  const runs: { start: number; step: number; count: number }[] = [];
  let i = 0;
  while (i < arr.length) {
    const start = arr[i];
    let step = arr.length > i + 1 ? arr[i + 1] - arr[i] : 1;
    let count = 1;
    while (i + count < arr.length && arr[i + count] - arr[i + count - 1] === step) count++;
    runs.push({ start, step, count });
    i += count;
  }
  return runs;
}

/* ---------------- 规范化 ---------------- */

export function normalizeTimetable(input: unknown): Timetable {
  const raw = (input || {}) as Record<string, unknown>;
  const rawTerm = (raw.term || {}) as Record<string, unknown>;
  const base = defaultTerm();

  const periodsRaw = Array.isArray(rawTerm.periods) ? rawTerm.periods : base.periods;
  const periods: Period[] = [];
  for (const p of periodsRaw) {
    const o = (p || {}) as Record<string, unknown>;
    const s = String(o.s ?? "").trim();
    const e = String(o.e ?? "").trim();
    if (parseHHMM(s) >= 0 && parseHHMM(e) >= 0) periods.push({ s, e });
  }
  if (!periods.length) periods.push(...base.periods);

  const startMs = parseDateMs(String(rawTerm.start ?? ""));
  const term: Term = {
    name: String(rawTerm.name ?? base.name).trim().slice(0, 60) || base.name,
    start: isFinite(startMs) ? fmtDate(mondayOf(startMs)) : base.start,
    weeks: clampInt(rawTerm.weeks, 1, 60, base.weeks),
    tz: String(rawTerm.tz ?? base.tz).trim() || base.tz,
    periods: periods.slice(0, 20),
    alarm: clampInt(rawTerm.alarm, 0, 240, base.alarm),
  };

  const courses: Course[] = [];
  const list = Array.isArray(raw.courses) ? raw.courses : [];
  for (const c of list) {
    const o = (c || {}) as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const day = clampInt(o.day, 1, 7, 1);
    let start = clampInt(o.start, 1, term.periods.length, 1);
    let end = clampInt(o.end, 1, term.periods.length, start);
    if (end < start) { const t = start; start = end; end = t; }
    const weeks = Array.isArray(o.weeks)
      ? [...new Set((o.weeks as unknown[]).map((w) => Number(w)).filter((w) => isFinite(w) && w >= 1 && w <= term.weeks))].sort((a, b) => a - b)
      : [];
    if (!weeks.length) continue;
    courses.push({
      name: name.slice(0, 80),
      day,
      start,
      end,
      weeks,
      loc: String(o.loc ?? "").trim().slice(0, 60) || undefined,
      teacher: String(o.teacher ?? "").trim().slice(0, 60) || undefined,
    });
  }
  courses.sort((a, b) => a.day - b.day || a.start - b.start || a.name.localeCompare(b.name, "zh"));
  return { term, courses };
}

export function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

/** 供前端预览用：某课程在某周的实际日期 */
export function courseDateTime(term: Term, course: Course, week: number) {
  const startMs = parseDateMs(term.start);
  const ms = dateOf(startMs, week, course.day);
  const p1 = term.periods[course.start - 1];
  const p2 = term.periods[course.end - 1] || p1;
  return { date: fmtDate(ms), weekday: WEEKDAY_CN[weekdayMon1(ms)], start: p1 ? p1.s : "", end: p2 ? p2.e : "" };
}
