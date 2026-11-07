import { parseWeeks, type Course, type Term } from "../model.ts";

/**
 * 正方教务（ZFSoft）等系统会在课表页里返回 JSON（正方新版是 kbList），
 * 这里把「一堆字段名不统一的对象」映射成课程。
 * 顺便也能吃 kcList / 任意字段名合理的数组。
 */

const NAME_KEYS = ["kcmc", "kcmc_display", "课程名称", "课程", "kc", "name", "courseName", "title", "subject"];
const DAY_KEYS = ["xqj", "星期", "周几", "weekday", "day", "xingqi", "skxq", "skrq"];
const PERIOD_KEYS = ["jc", "节次", "period", "jcs", "skjc", "jcstr", "djj"];
const WEEKS_KEYS = ["zcd", "周次", "weeks", "zc", "skzc", "zcmc", "qzz"];
const LOC_KEYS = ["cdmc", "教室", "上课地点", "地点", "location", "room", "skdd", "jxdd"];
const TEACHER_KEYS = ["xm", "教师", "老师", "teacher", "jsxm", "skjs"];

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() && String(v).trim() !== "undefined") return String(v).trim();
  }
  // 大小写/前后空格不敏感兜底
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase().replace(/\s/g, ""), obj[k]]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function parseDay(v: string): number {
  const s = String(v || "").trim();
  if (!s) return 0;
  const cn: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const m = /(?:星期|周|礼拜)?\s*([一二三四五六日天1-7])/.exec(s);
  if (m && cn[m[1]]) return cn[m[1]];
  if (m && /^[1-7]$/.test(m[1])) return +m[1];
  return 0;
}

function parsePeriodField(v: string): { start: number; end: number } | null {
  const s = String(v || "").trim();
  if (!s) return null;
  // "0102节" / "0102"
  let m = /^(\d{2})(\d{2})$/.exec(s);
  if (m) return { start: +m[1], end: +m[2] };
  const nums = (s.match(/\d{1,2}/g) || []).map(Number).filter((n) => n >= 1 && n <= 20);
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

/** 从任意 JSON 里找出课程数组（kbList / kcList / 顶层数组） */
export function findCourseArray(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) {
    const objs = data.filter((x) => x && typeof x === "object");
    return objs.length ? (objs as Record<string, unknown>[]) : null;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["kbList", "kcList", "kblist", "list", "rows", "data", "items", "courses"]) {
      const v = obj[key];
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Record<string, unknown>[];
    }
    for (const v of Object.values(obj)) {
      const found = findCourseArray(v);
      if (found) return found;
    }
  }
  return null;
}

export function coursesFromJson(data: unknown, term: Term): { courses: Course[]; warnings: string[] } {
  const warnings: string[] = [];
  const arr = findCourseArray(data);
  if (!arr) return { courses: [], warnings: ["这段 JSON 里没找到课程数组（正方的 kbList / 类似结构）"] };

  const courses: Course[] = [];
  for (const item of arr) {
    const name = pick(item, NAME_KEYS);
    const day = parseDay(pick(item, DAY_KEYS));
    const periods = parsePeriodField(pick(item, PERIOD_KEYS));
    const weeksRaw = pick(item, WEEKS_KEYS);
    const weeks = parseWeeks(weeksRaw, term.weeks);
    if (!name) continue;
    if (!day || !periods || !weeks.length) {
      warnings.push("跳过字段不全的条目：" + JSON.stringify(item).slice(0, 80));
      continue;
    }
    courses.push({
      name,
      day,
      start: periods.start,
      end: periods.end,
      weeks,
      loc: pick(item, LOC_KEYS) || undefined,
      teacher: pick(item, TEACHER_KEYS) || undefined,
    });
  }

  const merged = new Map<string, Course>();
  for (const c of courses) {
    const key = [c.name, c.day, c.start, c.end].join("|");
    const hit = merged.get(key);
    if (hit) hit.weeks = [...new Set([...hit.weeks, ...c.weeks])].sort((a, b) => a - b);
    else merged.set(key, { ...c });
  }
  return { courses: [...merged.values()].sort((a, b) => a.day - b.day || a.start - b.start), warnings };
}

/** 从 HTML 里把 "kbList":[...] 这段 JSON 抠出来（正方新版课表页常见） */
export function extractKbListJson(html: string): unknown {
  const src = String(html || "");
  const anchor = /["']?kbList["']?\s*[:=]\s*/i.exec(src);
  if (!anchor) return null;
  const start = src.indexOf("[", anchor.index + anchor[0].length - 1);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const raw = src.slice(start, i + 1);
        try {
          return JSON.parse(raw.replace(/'/g, '"'));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
