import { parseText } from "../parse-text.ts";
import type { Course, Term } from "../model.ts";
import { detectSystem, type SystemInfo } from "./detect.ts";
import { parseTimetableHtml } from "./grid.ts";
import { coursesFromJson, extractKbListJson, findCourseArray } from "./zf.ts";

export type JwMode = "json" | "kbList" | "html" | "text";

export interface JwImportResult {
  ok: boolean;
  system: SystemInfo;
  mode: JwMode;
  courses: Course[];
  warnings: string[];
  stats?: { tables?: number; weekdayCols?: number; periodRows?: number; cells?: number };
}

/**
 * 教务系统导入总入口：粘什么都行 ——
 * 课表页源码（HTML）、页面里抠出的 JSON（kbList）、或者复制出来的纯文本。
 */
export function importJw(text: string, term: Term): JwImportResult {
  const raw = String(text || "").trim();
  const system = detectSystem(raw);
  if (!raw) return { ok: false, system, mode: "text", courses: [], warnings: ["没有收到内容"] };

  // 1) 纯 JSON
  if (/^[[{]/.test(raw)) {
    try {
      const data = JSON.parse(raw);
      const r = coursesFromJson(data, term);
      if (r.courses.length) return { ok: true, system, mode: "json", courses: r.courses, warnings: r.warnings };
      if (!/<table/i.test(raw)) return { ok: false, system, mode: "json", courses: [], warnings: r.warnings };
    } catch {
      /* 不是合法 JSON，继续往下试 */
    }
  }

  // 2) HTML：优先抠页面里内嵌的 kbList
  if (/<table|<tr|<td|<html|<div/i.test(raw)) {
    const embedded = extractKbListJson(raw);
    if (embedded) {
      const r = coursesFromJson(embedded, term);
      if (r.courses.length) {
        return { ok: true, system, mode: "kbList", courses: r.courses, warnings: r.warnings };
      }
    }
    const grid = parseTimetableHtml(raw, term);
    if (grid.courses.length) {
      return { ok: true, system, mode: "html", courses: grid.courses, warnings: grid.warnings, stats: grid.stats };
    }
    // HTML 但解析不出课程：把可见文本当纯文本再试一次
    const plain = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(td|th|tr|div|p|li|span|font|table|body|html)>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
    const fb = parseText(plain, term);
    if (fb.courses.length) {
      return { ok: true, system, mode: "text", courses: fb.courses, warnings: grid.warnings.concat(fb.warnings) };
    }
    return { ok: false, system, mode: "html", courses: [], warnings: grid.warnings.length ? grid.warnings : ["没能从这段 HTML 里解析出课程"] };
  }

  // 3) 纯文本
  const t = parseText(raw, term);
  return { ok: t.courses.length > 0, system, mode: "text", courses: t.courses, warnings: t.warnings };
}

export { detectSystem } from "./detect.ts";
export { parseTimetableHtml } from "./grid.ts";
export { findCourseArray } from "./zf.ts";
