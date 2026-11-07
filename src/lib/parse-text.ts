import { parseWeeks, type Course, type Term } from "./model.ts";

const DAY_MAP: Record<string, number> = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
};

const LOC_HINT = /(楼|教|室|馆|厅|场|区|栋|中心|基地|实验室|^[A-Za-z]?\d+[-#]?\d*$)/;

const TEACHER_HINT = /(老师|教授|讲师|助教|\b[A-Z][a-z]+\b)/;

/** 看起来像纯周次的一列，例如 "1-16"、"1-8,10-16"、"1-16单" */
const WEEKLIKE = /^\d{1,2}(\s*[-–—~～至到]\s*\d{1,2})?(\s*[,，、]\s*\d{1,2}(\s*[-–—~～至到]\s*\d{1,2})?)*\s*[单双]?$/;

function parseDay(s: string): number {
  const m = /(?:周|星期|礼拜|week\s*)([一二三四五六日天1-7])/i.exec(s);
  if (m) return DAY_MAP[m[1]] || 0;
  return 0;
}

function parsePeriods(s: string): { start: number; end: number } | null {
  let m = /第?\s*(\d{1,2})\s*[-–—~～、,，至到]\s*(\d{1,2})\s*节/.exec(s);
  if (m) return { start: +m[1], end: +m[2] };
  m = /第?\s*(\d{1,2})\s*节/.exec(s);
  if (m) return { start: +m[1], end: +m[1] };
  // 形如 "1-2" 单独一列
  m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(s.trim());
  if (m) return { start: +m[1], end: +m[2] };
  m = /^(\d{1,2})$/.exec(s.trim());
  if (m) return { start: +m[1], end: +m[1] };
  return null;
}

function parseWeeksFrom(s: string, total: number): number[] {
  const cleaned = s.replace(/第?\s*\d{1,2}\s*[-–—~～、,，至到]?\s*\d{0,2}\s*节/g, " ").replace(/周[一二三四五六日天1-7]/g, " ");
  const out = new Set<number>();
  const re = /((?:\d{1,2}(?:\s*[-–—~～至到]\s*\d{1,2})?\s*[,，、]?\s*)+)\s*周(?:次)?\s*[（(]?\s*([单双])?\s*[）)]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const spec = m[1] + (m[2] || "");
    for (const x of parseWeeks(spec, total)) out.add(x);
  }
  return [...out].sort((a, b) => a - b);
}

function splitFields(line: string): string[] {
  if (/[\t|]/.test(line)) return line.split(/[\t|]+/).map((x) => x.trim()).filter(Boolean);
  if (/,/.test(line)) return line.split(/[,，]+/).map((x) => x.trim()).filter(Boolean);
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
  return line.split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

export interface ParseResult {
  courses: Course[];
  warnings: string[];
}

/** 解析「复制粘贴式」课表文本 */
export function parseText(text: string, term: Term): ParseResult {
  const warnings: string[] = [];
  const courses: Course[] = [];
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return;
    const fields = splitFields(line);

    let day = 0;
    let periods: { start: number; end: number } | null = null;
    let weeks: number[] = [];
    const rest: string[] = [];

    // 逐个字段「剥」信息：星期 / 节次 / 周次，剥完剩下的才可能是课程名、教室、教师
    for (const f of fields) {
      let leftover = f;
      let usedPeriod = false;

      if (!day) {
        const d = parseDay(leftover);
        if (d) { day = d; leftover = leftover.replace(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, " "); }
      }
      if (!periods) {
        const p = parsePeriods(leftover);
        if (p) {
          periods = p;
          usedPeriod = true;
          leftover = leftover.replace(/第?\s*\d{1,2}\s*(?:[-–—~～、,，至到]\s*\d{1,2}\s*)?节/g, " ");
          if (/^[\d\s,，、~～\-—至到]+$/.test(leftover.trim())) leftover = " ";
        }
      }
      if (!weeks.length) {
        const w = parseWeeksFrom(leftover, term.weeks);
        if (w.length) {
          weeks = w;
          leftover = leftover.replace(/(?:第)?[\d,，、~～\-—\s]+?\s*周(?:次)?\s*[（(]?\s*[单双]?\s*[）)]?/g, " ");
        }
      }
      if (!weeks.length && periods && !usedPeriod && WEEKLIKE.test(leftover.trim())) {
        const w2 = parseWeeks(leftover, term.weeks);
        if (w2.length) { weeks = w2; leftover = " "; }
      }

      leftover = leftover.replace(/[{}（）()]/g, " ").replace(/\s+/g, " ").trim();
      if (leftover) rest.push(leftover);
    }

    if (!day || !periods || !weeks.length) {
      warnings.push("第 " + (idx + 1) + " 行解析失败（需要星期 / 节次 / 周次）：" + line);
      return;
    }

    let name = "";
    let loc: string | undefined;
    let teacher: string | undefined;
    for (const f of rest) {
      if (!name && /[\u4e00-\u9fa5A-Za-z]/.test(f) && !LOC_HINT.test(f)) { name = f; continue; }
      if (!loc && LOC_HINT.test(f)) { loc = f; continue; }
      if (!teacher && TEACHER_HINT.test(f)) { teacher = f; continue; }
      if (!name) { name = f; continue; }
      if (!loc) { loc = f; continue; }
      if (!teacher) { teacher = f; continue; }
    }
    if (!name && fields.length) name = fields[0];
    if (!name) { warnings.push("第 " + (idx + 1) + " 行没有课程名：" + line); return; }

    courses.push({ name, day, start: periods.start, end: periods.end, weeks, loc, teacher });
  });

  return { courses: mergeCourses(courses, term), warnings };
}

/** 合并同一门课的重复行（同一天、同节次、周次取并集） */
export function mergeCourses(list: Course[], term: Term): Course[] {
  const map = new Map<string, Course>();
  for (const c of list) {
    const key = [c.name, c.day, c.start, c.end].join("|");
    const hit = map.get(key);
    if (hit) {
      hit.weeks = [...new Set([...hit.weeks, ...c.weeks])].filter((w) => w >= 1 && w <= term.weeks).sort((a, b) => a - b);
      if (!hit.loc && c.loc) hit.loc = c.loc;
      if (!hit.teacher && c.teacher) hit.teacher = c.teacher;
    } else {
      map.set(key, { ...c, weeks: [...new Set(c.weeks)].filter((w) => w >= 1 && w <= term.weeks).sort((a, b) => a - b) });
    }
  }
  return [...map.values()];
}
