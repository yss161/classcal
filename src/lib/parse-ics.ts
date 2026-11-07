import { mergeCourses } from "./parse-text.ts";
import type { ParseResult } from "./parse-text.ts";
import { parseDateMs, parseHHMM, weekdayMon1 } from "./dates.ts";
import { normalizeTimetable, type Course, type Term } from "./model.ts";

interface Vevent {
  summary: string;
  location: string;
  description: string;
  dtstart: string;
  dtend: string;
  duration: string;
  rrule: string;
  exdates: string[];
}

function unescapeText(s: string): string {
  return String(s || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\/g, "\\");
}

function unfold(raw: string): string[] {
  const lines = String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseIcsDate(v: string, tzOffsetMin: number): { ms: number; minutes: number } | null {
  const s = String(v || "").trim();
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(s);
  if (m) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const minutes = +m[4] * 60 + +m[5];
    if (m[7]) return { ms, minutes: minutes + tzOffsetMin };
    return { ms, minutes };
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), minutes: -1 };
  return null;
}

function nearestPeriod(periods: Term["periods"], minutes: number, key: "s" | "e"): number {
  let best = -1;
  let bestDiff = Infinity;
  periods.forEach((p, i) => {
    const v = parseHHMM(p[key]);
    if (v < 0) return;
    const d = Math.abs(v - minutes);
    if (d < bestDiff) { bestDiff = d; best = i + 1; }
  });
  return bestDiff <= 20 ? best : -1;
}

export function parseIcs(text: string, term: Term): ParseResult {
  const warnings: string[] = [];
  const tzOffset = term.tz === "Asia/Shanghai" ? 480 : 480;
  const lines = unfold(text);

  const events: Vevent[] = [];
  let cur: Vevent | null = null;
  let inAlarm = false;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) { cur = { summary: "", location: "", description: "", dtstart: "", dtend: "", duration: "", rrule: "", exdates: [] }; inAlarm = false; continue; }
    if (upper.startsWith("END:VEVENT")) { if (cur) events.push(cur); cur = null; inAlarm = false; continue; }
    // 提醒块里的 DESCRIPTION 会覆盖日程描述，必须跳过
    if (upper.startsWith("BEGIN:VALARM")) { inAlarm = true; continue; }
    if (upper.startsWith("END:VALARM")) { inAlarm = false; continue; }
    if (!cur || inAlarm) continue;
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const head = line.slice(0, ci).toUpperCase();
    const value = line.slice(ci + 1);
    const name = head.split(";")[0];
    if (name === "SUMMARY") cur.summary = unescapeText(value);
    else if (name === "LOCATION") cur.location = unescapeText(value);
    else if (name === "DESCRIPTION") cur.description = unescapeText(value);
    else if (name === "DTSTART") cur.dtstart = value;
    else if (name === "DTEND") cur.dtend = value;
    else if (name === "DURATION") cur.duration = value;
    else if (name === "RRULE") cur.rrule = value;
    else if (name === "EXDATE") cur.exdates.push(...value.split(","));
  }

  if (!events.length) return { courses: [], warnings: ["这个 .ics 里没有找到日程（VEVENT）"] };
  const termStartMs = parseDateMs(term.start);
  if (!isFinite(termStartMs)) return { courses: [], warnings: ["学期开始日期无效"] };

  const courses: Course[] = [];
  for (const ev of events) {
    const name = (ev.summary || "").trim();
    if (!name) continue;
    const start = parseIcsDate(ev.dtstart, tzOffset);
    if (!start || start.minutes < 0) { warnings.push("跳过全天/无效日程：" + name); continue; }

    const day = weekdayMon1(start.ms);
    const week = Math.floor((start.ms - termStartMs) / 86400000 / 7) + 1;
    if (week < 1) continue;

    let endMinutes = start.minutes + 45;
    if (ev.dtend) {
      const e = parseIcsDate(ev.dtend, tzOffset);
      if (e && e.minutes >= 0) endMinutes = e.minutes;
    } else if (/^PT(\d+)M$/.test(ev.duration)) {
      endMinutes = start.minutes + Number(/^PT(\d+)M$/.exec(ev.duration)![1]);
    }

    const pStart = nearestPeriod(term.periods, start.minutes, "s");
    const pEnd = nearestPeriod(term.periods, endMinutes, "e");
    if (pStart < 0) { warnings.push("「" + name + "」的开始时间对不上节次表，已跳过（可先修改节次时间再导入）"); continue; }
    const s = pStart;
    const e = pEnd > 0 && pEnd >= s ? pEnd : s;

    // 展开 RRULE
    const weeks = new Set<number>();
    const rrule = ev.rrule ? ev.rrule.toUpperCase() : "";
    let step = 1;
    let count = 1;
    let untilMs = 0;
    if (rrule) {
      const im = /INTERVAL=(\d+)/.exec(rrule);
      if (im) step = Math.max(1, Number(im[1]));
      const cm = /COUNT=(\d+)/.exec(rrule);
      if (cm) count = Math.max(1, Number(cm[1]));
      const um = /UNTIL=([0-9TZ]+)/.exec(rrule);
      if (um) { const u = parseIcsDate(um[1], tzOffset); if (u) untilMs = u.ms; }
      if (!/FREQ=WEEKLY/.test(rrule)) count = 1;
    }
    for (let i = 0; i < count; i++) {
      const w = week + i * step;
      if (w > term.weeks) break;
      if (untilMs && start.ms + i * step * 7 * 86400000 > untilMs) break;
      weeks.add(w);
    }
    for (const ex of ev.exdates) {
      const d = parseIcsDate(ex, tzOffset);
      if (!d) continue;
      const w = Math.floor((d.ms - termStartMs) / 86400000 / 7) + 1;
      weeks.delete(w);
    }

    const teacherMatch = /(?:教师|老师|授课教师)[：:]\s*([^\n,，;；]+)/.exec(ev.description || "");
    courses.push({
      name,
      day,
      start: s,
      end: e,
      weeks: [...weeks].sort((a, b) => a - b),
      loc: (ev.location || "").trim() || undefined,
      teacher: teacherMatch ? teacherMatch[1].trim() : undefined,
    });
  }

  const merged = mergeCourses(courses.filter((c) => c.weeks.length), term);
  if (!merged.length) warnings.push("没有解析出可用课程，检查学期开始日期是否与 .ics 里的日期一致");
  return { courses: merged, warnings };
}

/** .ics 里最早一个日程的日期（会自动对齐到周一），方便前端推断学期开始日 */
export function guessTermStart(text: string, term: Term): string {
  const lines = unfold(text);
  let minMs = Infinity;
  let inEvent = false;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) { inEvent = true; continue; }
    if (upper.startsWith("END:VEVENT")) { inEvent = false; continue; }
    if (!inEvent || !upper.startsWith("DTSTART")) continue;
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const d = parseIcsDate(line.slice(ci + 1), 480);
    if (d && isFinite(d.ms) && d.ms < minMs) minMs = d.ms;
  }
  if (!isFinite(minMs)) return normalizeTimetable({ term }).term.start;
  const monday = minMs - (weekdayMon1(minMs) - 1) * 86400000;
  const dt = new Date(monday);
  const p = (n: number) => String(n).padStart(2, "0");
  return dt.getUTCFullYear() + "-" + p(dt.getUTCMonth() + 1) + "-" + p(dt.getUTCDate());
}
