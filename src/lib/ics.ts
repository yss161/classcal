import { dateOf, parseDateMs, ymd } from "./dates.ts";
import { weekRuns, weeksToSpec, type Course, type Timetable } from "./model.ts";

/**
 * 各时区的 UTC 偏移（分钟）。中国无夏令时，固定 +480 精确可靠。
 * 不在表里的时区按 +480 处理。
 */
const TZ_OFFSET: Record<string, number> = {
  "Asia/Shanghai": 480,
  "Asia/Chongqing": 480,
  "Asia/Hong_Kong": 480,
  "Asia/Macau": 480,
  "Asia/Taipei": 480,
  "Asia/Singapore": 480,
  "Asia/Tokyo": 540,
  "Asia/Seoul": 540,
  "Asia/Bangkok": 420,
  "Europe/London": 0,
  "Europe/Berlin": 60,
  "America/New_York": -300,
  "America/Los_Angeles": -480,
  "UTC": 0,
};

function offsetOf(tz: string): number {
  const v = TZ_OFFSET[tz];
  return typeof v === "number" ? v : 480;
}

function offsetString(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  const h = String(Math.floor(a / 60)).padStart(2, "0");
  const m = String(a % 60).padStart(2, "0");
  return sign + h + m;
}

/** RFC 5545 TEXT 转义 */
export function escapeText(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** 按 75 字节折行（UTF-8 安全） */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur: number[] = [];
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch);
    if (curLen + b.length > limit) {
      out.push(new TextDecoder().decode(new Uint8Array(cur)));
      cur = [];
      curLen = 0;
      limit = 74; // 续行前面要加一个空格
    }
    for (const x of b) cur.push(x);
    curLen += b.length;
  }
  if (cur.length) out.push(new TextDecoder().decode(new Uint8Array(cur)));
  return out.join("\r\n ");
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z"
  );
}

/** 生成单个 VEVENT 的行数组 */
function eventLines(tt: Timetable, course: Course, run: { start: number; step: number; count: number }, now: string): string[] {
  const { term } = tt;
  const startMs = parseDateMs(term.start);
  if (!isFinite(startMs)) return [];
  const dayMs = dateOf(startMs, run.start, course.day);
  const p1 = term.periods[course.start - 1];
  const p2 = term.periods[course.end - 1] || p1;
  if (!p1 || !p2) return [];
  const dtStart = ymd(dayMs) + "T" + p1.s.replace(":", "") + "00";
  const dtEnd = ymd(dayMs) + "T" + p2.e.replace(":", "") + "00";

  const uid = fnv1a([term.start, course.name, course.day, course.start, course.end, run.start].join("|")) + "-" + run.start + "@kcb-ics";
  const descParts: string[] = [];
  if (course.teacher) descParts.push("教师：" + course.teacher);
  descParts.push("周次：" + weeksToSpec(course.weeks));
  descParts.push("节次：第" + course.start + (course.end !== course.start ? "-" + course.end : "") + "节");

  const lines: string[] = [
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + now,
    "LAST-MODIFIED:" + now,
    "SEQUENCE:0",
    "DTSTART;TZID=" + term.tz + ":" + dtStart,
    "DTEND;TZID=" + term.tz + ":" + dtEnd,
    "SUMMARY:" + escapeText(course.name),
  ];
  if (course.loc) lines.push("LOCATION:" + escapeText(course.loc));
  lines.push("DESCRIPTION:" + escapeText(descParts.join("\n")));
  if (run.count > 1) lines.push("RRULE:FREQ=WEEKLY;INTERVAL=" + run.step + ";COUNT=" + run.count);
  if (term.alarm > 0) {
    lines.push("BEGIN:VALARM", "TRIGGER:-PT" + term.alarm + "M", "ACTION:DISPLAY", "DESCRIPTION:" + escapeText(course.name), "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

/** 生成完整 .ics 文本 */
export function buildIcs(tt: Timetable, nowDate?: Date): string {
  const now = utcStamp(nowDate instanceof Date ? nowDate : new Date());
  const off = offsetString(offsetOf(tt.term.tz));
  const head: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//kcb-ics//Course Table to iCal//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapeText(tt.term.name),
    "X-WR-TIMEZONE:" + tt.term.tz,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    "BEGIN:VTIMEZONE",
    "TZID:" + tt.term.tz,
    "X-LIC-LOCATION:" + tt.term.tz,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:" + off,
    "TZOFFSETTO:" + off,
    "TZNAME:" + (tt.term.tz === "Asia/Shanghai" ? "CST" : tt.term.tz),
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  const body: string[] = [];
  for (const course of tt.courses) {
    for (const run of weekRuns(course.weeks)) body.push(...eventLines(tt, course, run, now));
  }

  const all = [...head, ...body, "END:VCALENDAR"];
  return all.map(foldLine).join("\r\n") + "\r\n";
}

/** 统计事件数量，用于前端提示 */
export function countEvents(tt: Timetable): number {
  return tt.courses.reduce((n, c) => n + weekRuns(c.weeks).length, 0);
}
