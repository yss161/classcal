/**
 * 前端 ICS 生成（逐周展开版）
 *
 * 与 Worker 里的订阅版（src/lib/ics.ts）刻意不同：
 *  - 订阅版：把连续周次压成 RRULE，事件少、能原地更新
 *  - 下载版：每个具体周次一个 VEVENT，便于核对、也避免各种日历客户端对 RRULE 的处理差异
 * UID = 课程序号 + 内容 hash（不含 raw），保证同一份课表内唯一且可复现。
 */

import { parseWeeksSpec } from "./course-table-schema.js";

const TZ_OFFSET_MIN = 480; // Asia/Shanghai，无夏令时

/* ---------------- 文本处理 ---------------- */

export function escapeText(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** 75 字节折行（UTF-8 安全），续行以一个空格开头 */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = [];
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch);
    if (curLen + b.length > limit) {
      out.push(new TextDecoder().decode(new Uint8Array(cur)));
      cur = [];
      curLen = 0;
      limit = 74;
    }
    for (const x of b) cur.push(x);
    curLen += b.length;
  }
  if (cur.length) out.push(new TextDecoder().decode(new Uint8Array(cur)));
  return out.join("\r\n ");
}

/** FNV-1a 32bit → 8 位十六进制 */
export function hash32(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

/* ---------------- 日期 ---------------- */

export function parseDateMs(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || "").trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function ymd(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
}

function utcStamp(date) {
  const d = date instanceof Date ? date : new Date();
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"
  );
}

/** 第 week 周、星期 weekday(1-7) 的日期 */
export function dateOfWeek(termStartMs, week, weekday) {
  return termStartMs + ((week - 1) * 7 + (weekday - 1)) * 86400000;
}

/* ---------------- 事件展开 ---------------- */

/**
 * @param {Array} courses 已校验的课程
 * @param {object} term { name, start:"YYYY-MM-DD"(第1周周一), periods:[{s,e}], alarm, weeks }
 * @returns {{events:Array, issues:string[]}}
 */
export function buildEvents(courses, term) {
  const issues = [];
  const termStartMs = parseDateMs(term && term.start);
  if (!isFinite(termStartMs)) {
    return { events: [], issues: ["学期开始日期无效，请先选「开学第一周的周一」。"] };
  }
  const periods = Array.isArray(term.periods) ? term.periods : [];
  const totalWeeks = Number(term.weeks) > 0 ? Number(term.weeks) : 20;
  const events = [];

  (courses || []).forEach((course, i) => {
    const weeks = parseWeeksSpec(course.weeks, totalWeeks);
    if (!weeks.length) {
      issues.push("「" + course.name + "」的周次解析不出来，已跳过。");
      return;
    }
    const p1 = periods[Number(String(course.periods).split("-")[0]) - 1];
    const p2 = periods[Number(String(course.periods).split("-").slice(-1)[0]) - 1] || p1;
    if (!p1 || !p2) {
      issues.push("「" + course.name + "」的节次（" + course.periods + "）超出作息时间表范围，已跳过。");
      return;
    }

    for (const week of weeks) {
      const dateMs = dateOfWeek(termStartMs, week, course.weekday);
      const day = ymd(dateMs);
      const uidBody = [course.name, course.weekday, course.periods, week, course.location || "", course.teacher || ""].join("|");
      events.push({
        uid: "c" + i + "-" + hash32(uidBody) + "@classcal",
        week,
        date: day,
        dtStart: day + "T" + p1.s.replace(":", "") + "00",
        dtEnd: day + "T" + p2.e.replace(":", "") + "00",
        summary: course.name,
        location: course.location || "",
        description: buildDescription(course, week),
      });
    }
  });

  return { events, issues };
}

function buildDescription(course, week) {
  const parts = [];
  if (course.teacher) parts.push("教师：" + course.teacher);
  parts.push("周次：" + course.weeks + "（第 " + week + " 周）");
  parts.push("节次：第 " + course.periods + " 节");
  return parts.join("\n");
}

/* ---------------- ICS 文本 ---------------- */

/**
 * @param {Array} events buildEvents 的结果
 * @param {object} options { calendarName, timezone, alarm }
 */
export function buildIcsText(events, options = {}) {
  const timezone = options.timezone || "Asia/Shanghai";
  const now = utcStamp(options.now instanceof Date ? options.now : new Date());
  const tzName = timezone === "Asia/Shanghai" ? "CST" : timezone;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClassCal//course-table-v1 export//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapeText(options.calendarName || "我的课表"),
    "X-WR-TIMEZONE:" + timezone,
    "BEGIN:VTIMEZONE",
    "TZID:" + timezone,
    "X-LIC-LOCATION:" + timezone,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:" + tzName,
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + ev.uid,
      "DTSTAMP:" + now,
      "DTSTART;TZID=" + timezone + ":" + ev.dtStart,
      "DTEND;TZID=" + timezone + ":" + ev.dtEnd,
      "SUMMARY:" + escapeText(ev.summary)
    );
    if (ev.location) lines.push("LOCATION:" + escapeText(ev.location));
    if (ev.description) lines.push("DESCRIPTION:" + escapeText(ev.description));
    if (Number(options.alarm) > 0) {
      lines.push(
        "BEGIN:VALARM",
        "TRIGGER:-PT" + Number(options.alarm) + "M",
        "ACTION:DISPLAY",
        "DESCRIPTION:" + escapeText(ev.summary),
        "END:VALARM"
      );
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** 一步到位：课程 + 学期设置 → .ics 文本 */
export function coursesToIcs(courses, term) {
  const built = buildEvents(courses, term);
  const text = buildIcsText(built.events, {
    calendarName: (term && term.name) || "我的课表",
    timezone: "Asia/Shanghai",
    alarm: term && term.alarm,
  });
  return { text, events: built.events, issues: built.issues };
}
