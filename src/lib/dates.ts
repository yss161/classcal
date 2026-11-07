export const WEEKDAY_CN = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function parseDateMs(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

export function ymd(ms: number): string {
  return fmtDate(ms).replace(/-/g, "");
}

export function addDays(ms: number, days: number): number {
  return ms + days * 86400000;
}

/** 1=周一 ... 7=周日 */
export function weekdayMon1(ms: number): number {
  const d = new Date(ms).getUTCDay();
  return d === 0 ? 7 : d;
}

/** 把任意日期对齐到所在周的周一 */
export function mondayOf(ms: number): number {
  const wd = weekdayMon1(ms);
  return addDays(ms, -(wd - 1));
}

/** 第 week 周、星期 day 的日期 */
export function dateOf(termStartMs: number, week: number, day: number): number {
  return addDays(termStartMs, (week - 1) * 7 + (day - 1));
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return -1;
  return +m[1] * 60 + +m[2];
}
