import { parseWeeks, type Course, type Term } from "../model.ts";

/**
 * 通用「课表表格」解析器。
 *
 * 国内教务系统的课表绝大多数都是「星期 × 节次」的 HTML 表格，差异只在
 * 单元格里课程信息的顺序和分隔方式。所以这里不针对某一家写死，而是：
 *   ① 还原 colspan/rowspan 的矩阵；
 *   ② 用「表头行 + 行首列」判定星期列与节次行（避免把行首的 "2" 当成星期二）；
 *   ③ 单元格文本按行切分后逐行归类（课程名 / 周次 / 教室 / 教师 / 格内节次）。
 */

export interface GridCell {
  text: string;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  isHeader: boolean;
  /** 被合并区域「覆盖」出来的空位（Excel 的合并单元格 / HTML 的 rowspan-colspan 占位） */
  covered?: boolean;
}

export interface ParsedTable {
  cells: GridCell[][];
  rowCount: number;
  colCount: number;
}

const WEEKDAY_HINTS: [RegExp, number][] = [
  [/^(星期|周|礼拜)\s*一$|^一$|^1$|^mon/i, 1],
  [/^(星期|周|礼拜)\s*二$|^二$|^2$|^tue/i, 2],
  [/^(星期|周|礼拜)\s*三$|^三$|^3$|^wed/i, 3],
  [/^(星期|周|礼拜)\s*四$|^四$|^4$|^thu/i, 4],
  [/^(星期|周|礼拜)\s*五$|^五$|^5$|^fri/i, 5],
  [/^(星期|周|礼拜)\s*六$|^六$|^6$|^sat/i, 6],
  [/^(星期|周|礼拜)\s*[日天]$|^[日天]$|^7$|^sun/i, 7],
];

const LOC_HINT = /(楼|教|室|馆|厅|场|区|栋|房|机|堂|中心|基地|实验室|^[A-Za-z]?\d+[-#]?\d*$)/;
const TEACHER_PREFIX = /^\s*(教师|老师|任课教师|授课教师)\s*[:：]\s*/;
const LOC_PREFIX = /^\s*(地点|教室|上课地点|场地)\s*[:：]\s*/;
const PERIOD_IN_CELL = /(?:周|星期|礼拜)\s*([一二三四五六日天])\s*第?\s*([\d,，、\-~～至到]+)\s*节/;
const WEEKS_IN_LINE = /([\d,，、~～\-—\s]+?)\s*周(?:次)?\s*[（(\[]?\s*([单双])?\s*[）)\]]?/;

function decodeEntities(s: string): string {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

function cellText(html: string): string {
  return decodeEntities(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|td|span|font)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

function attrOf(tag: string, name: string): number {
  const m = new RegExp(name + '\\s*=\\s*"?([0-9]+)', "i").exec(tag);
  return m ? Math.max(1, Math.min(50, +m[1])) : 1;
}

/** 解析一个 <table> 的 HTML 片段，还原成矩阵（colspan/rowspan 展开） */
export function parseTableHtml(tableHtml: string): ParsedTable {
  const rowHtmls = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const grid: (GridCell | null)[][] = [];
  const occupy: Record<string, GridCell> = {};
  let maxCol = 0;

  rowHtmls.forEach((rowHtml, r) => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(rowHtml))) {
      while (grid[r][c] || occupy[r + ":" + c]) c++;
      const cell: GridCell = {
        text: cellText(m[3]),
        row: r,
        col: c,
        rowspan: attrOf(m[2], "rowspan"),
        colspan: attrOf(m[2], "colspan"),
        isHeader: m[1].toLowerCase() === "th",
      };
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (!grid[rr]) grid[rr] = [];
          if (rr === r && cc === c) grid[rr][cc] = cell;
          else occupy[rr + ":" + cc] = cell;
        }
      }
      c += cell.colspan;
      if (c > maxCol) maxCol = c;
    }
  });

  const cells: GridCell[][] = [];
  for (let r = 0; r < grid.length; r++) {
    cells[r] = [];
    for (let c = 0; c < maxCol; c++) {
      const own = grid[r] && grid[r][c];
      const covered = occupy[r + ":" + c];
      if (own) cells[r][c] = own;
      else if (covered) cells[r][c] = { text: "", row: r, col: c, rowspan: 1, colspan: 1, isHeader: false, covered: true };
      else cells[r][c] = { text: "", row: r, col: c, rowspan: 1, colspan: 1, isHeader: false };
    }
  }
  return { cells, rowCount: cells.length, colCount: maxCol };
}

function weekdayOf(text: string): number {
  const t = String(text || "").replace(/\s/g, "");
  if (!t || t.length > 8) return 0;
  for (const [re, day] of WEEKDAY_HINTS) if (re.test(t)) return day;
  return 0;
}

function periodOf(text: string): { start: number; end: number } | null {
  const t = String(text || "").replace(/\s/g, "");
  if (!t || t.length > 10) return null;
  let m = /第?(\d{1,2})\s*(?:[-~～至到,，、]\s*(\d{1,2}))?\s*节/.exec(t);
  if (m) return { start: +m[1], end: m[2] ? +m[2] : +m[1] };
  m = /^(\d{1,2})\s*[-~～至到]\s*(\d{1,2})$/.exec(t);
  if (m) return { start: +m[1], end: +m[2] };
  m = /^(\d{1,2})$/.exec(t);
  if (m) return { start: +m[1], end: +m[1] };
  return null;
}

export interface TableLayout {
  headerRow: number;
  colDay: Record<number, number>;
  rowPeriod: Record<number, { start: number; end: number }>;
  weekdayCols: number;
  periodRows: number;
}

/**
 * 认出课表结构：
 * - 表头行 = 前 6 行里第一个「至少 2 个单元格是星期」的行；
 * - 星期列 = 那一行命中的列（之后所有节次行都从这些列取课程）；
 * - 节次行 = 表头行之后、非星期列里能读出「第几节」的行。
 */
export function analyzeTable(cells: GridCell[][]): TableLayout {
  const layout: TableLayout = { headerRow: -1, colDay: {}, rowPeriod: {}, weekdayCols: 0, periodRows: 0 };

  for (let r = 0; r < Math.min(6, cells.length); r++) {
    const row = cells[r] || [];
    const colDay: Record<number, number> = {};
    let n = 0;
    for (let c = 0; c < row.length; c++) {
      const d = weekdayOf(row[c].text);
      if (d && !colDay[c]) { colDay[c] = d; n++; }
    }
    if (n >= 2) {
      layout.headerRow = r;
      layout.colDay = colDay;
      layout.weekdayCols = n;
      break;
    }
  }
  if (layout.headerRow < 0) return layout;

  for (let r = layout.headerRow + 1; r < cells.length; r++) {
    const row = cells[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (layout.colDay[c]) continue;
      const p = periodOf(row[c].text);
      if (p) { layout.rowPeriod[r] = p; layout.periodRows++; break; }
    }
  }
  return layout;
}

/** 判断一张表「像不像课表」 */
export function tableShape(cells: GridCell[][]): { weekdayCols: number; periodRows: number; filled: number } {
  const layout = analyzeTable(cells);
  let filled = 0;
  for (const row of cells) for (const cell of row) if (cell.text) filled++;
  return { weekdayCols: layout.weekdayCols, periodRows: layout.periodRows, filled };
}

/** 把整页 HTML 里所有表格解析出来，挑最像课表的那个 */
export function pickTimetable(html: string): ParsedTable | null {
  const tables = String(html || "").match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  let best: ParsedTable | null = null;
  let bestRank = -1;
  for (const t of tables) {
    const parsed = parseTableHtml(t);
    const shape = tableShape(parsed.cells);
    if (shape.weekdayCols < 2 || shape.periodRows < 1) continue;
    const rank = shape.weekdayCols * 10 + shape.periodRows * 2 + shape.filled * 0.05;
    if (rank > bestRank) { bestRank = rank; best = parsed; }
  }
  return best;
}

/** 从一行里抠周次，保留 (单)/(双) 标记 */
function weeksFromLine(line: string, total: number): number[] {
  const m = WEEKS_IN_LINE.exec(line.replace(/[{}]/g, " "));
  if (!m) return [];
  return parseWeeks(m[1].replace(/\s+/g, "") + (m[2] || ""), total);
}

/** 单元格文本 → 若干门课 */
export function parseCellCourses(text: string, term: Term, day: number, periods: { start: number; end: number }): Course[] {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  interface Draft {
    name: string;
    weeks: number[];
    loc?: string;
    teacher?: string;
    day: number;
    start: number;
    end: number;
  }
  const drafts: Draft[] = [];
  const blank = (): Draft => ({ name: "", weeks: [], day, start: periods.start, end: periods.end });
  let cur = blank();

  const push = () => {
    if (cur.name) drafts.push(cur);
    cur = blank();
  };

  for (const raw of lines) {
    let line = raw;

    // 格内的「周一第1,2节」优先于表格位置
    const pm = PERIOD_IN_CELL.exec(line);
    if (pm) {
      const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
      const nums = (pm[2].match(/\d{1,2}/g) || []).map(Number).filter((n) => n >= 1 && n <= 20);
      cur.day = map[pm[1]] || day;
      if (nums.length) {
        cur.start = Math.min(...nums);
        cur.end = Math.max(...nums);
      }
      line = line.replace(PERIOD_IN_CELL, " ").trim();
      if (!line) continue;
    }

    if (TEACHER_PREFIX.test(line)) { cur.teacher = line.replace(TEACHER_PREFIX, "").trim(); continue; }
    if (LOC_PREFIX.test(line)) { cur.loc = line.replace(LOC_PREFIX, "").trim(); continue; }

    // 周次行（可能带 { } 或 (单)）
    const weeks = weeksFromLine(line, term.weeks);
    if (/周/.test(line) && weeks.length) {
      cur.weeks = [...new Set([...cur.weeks, ...weeks])].sort((a, b) => a - b);
      continue;
    }

    // 已经有了课程名之后的行：先认教室，再认教师
    if (cur.name) {
      if (!cur.loc && LOC_HINT.test(line) && /[\dA-Za-z]|楼|教|室|馆|厅|场|区|栋|房|机|堂/.test(line)) { cur.loc = line; continue; }
      if (!cur.teacher && cur.weeks.length && /^[\u4e00-\u9fa5]{2,5}$/.test(line) && !/(楼|室|房|馆|场|区|栋)$/.test(line)) {
        cur.teacher = line;
        continue;
      }
    }

    if (cur.name) push();
    cur.name = line;
  }
  push();

  const out: Course[] = [];
  for (const d of drafts) {
    if (!d.name || !d.weeks.length) continue;
    out.push({
      name: d.name.slice(0, 80),
      day: d.day,
      start: d.start,
      end: d.end,
      weeks: d.weeks.filter((x) => x >= 1 && x <= term.weeks),
      loc: d.loc?.slice(0, 60),
      teacher: d.teacher?.slice(0, 60),
    });
  }
  return out.filter((c) => c.weeks.length);
}

/** 二维字符串 + 合并区域 → 和 HTML 表格同样的结构（给 Excel 用） */
export function matrixToTable(rows: string[][], merges: { r1: number; c1: number; r2: number; c2: number }[]): ParsedTable {
  const rowCount = rows.length;
  let colCount = rows.reduce((n, r) => Math.max(n, r.length), 0);
  for (const m of merges) colCount = Math.max(colCount, m.c2 + 1);

  const cells: GridCell[][] = [];
  for (let r = 0; r < rowCount; r++) {
    cells[r] = [];
    for (let c = 0; c < colCount; c++) {
      const text = (rows[r] && rows[r][c]) || "";
      cells[r][c] = { text: String(text).trim(), row: r, col: c, rowspan: 1, colspan: 1, isHeader: false };
    }
  }

  for (const m of merges) {
    const origin = cells[m.r1] && cells[m.r1][m.c1];
    if (!origin) continue;
    origin.rowspan = Math.max(1, m.r2 - m.r1 + 1);
    origin.colspan = Math.max(1, m.c2 - m.c1 + 1);
    for (let r = m.r1; r <= m.r2; r++) {
      for (let c = m.c1; c <= m.c2; c++) {
        if (r === m.r1 && c === m.c1) continue;
        cells[r][c] = { text: "", row: r, col: c, rowspan: 1, colspan: 1, isHeader: false, covered: true };
      }
    }
  }
  return { cells, rowCount, colCount };
}

/**
 * 从已经认好结构的表格里取课程。
 * 只处理合并区域的「左上角」单元格，并用 rowspan/colspan 推断跨了几节课 / 几天。
 */
export function collectCourses(table: ParsedTable, layout: TableLayout, term: Term): { courses: Course[]; cells: number } {
  const courses: Course[] = [];
  let cells = 0;
  for (let r = layout.headerRow + 1; r < table.rowCount; r++) {
    const basePeriods = layout.rowPeriod[r] || null;
    for (const c of Object.keys(layout.colDay).map(Number)) {
      const cell = table.cells[r] && table.cells[r][c];
      if (!cell || !cell.text || cell.covered) continue;
      if (weekdayOf(cell.text)) continue;
      // 某些表把「上午/下午」做成合并行、节次写在单元格里，这时行上没有节次表，
      // 只要单元格自己带「周一第1,2节」这种信息就仍然能救回来
      if (!basePeriods && !PERIOD_IN_CELL.test(cell.text)) continue;
      cells++;

      // 竖向合并：跨了几行节次，结束节次跟着延后
      let periods = basePeriods || { start: 1, end: 1 };
      if (cell.rowspan > 1) {
        for (let k = 1; k < cell.rowspan; k++) {
          const next = layout.rowPeriod[r + k];
          if (next) periods = { start: periods.start, end: Math.max(periods.end, next.end) };
        }
      }

      // 横向合并：一门课占了两天（少见），两边都算上
      for (let d = 0; d < Math.max(1, cell.colspan); d++) {
        const day = layout.colDay[c + d];
        if (day) courses.push(...parseCellCourses(cell.text, term, day, periods));
      }
    }
  }
  return { courses, cells };
}

export interface GridParseResult {
  courses: Course[];
  warnings: string[];
  stats: { tables: number; weekdayCols: number; periodRows: number; cells: number };
}

/** 从整页 HTML 里抽出课表 */
export function parseTimetableHtml(html: string, term: Term): GridParseResult {
  const warnings: string[] = [];
  const all = String(html || "").match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  const table = pickTimetable(html);
  if (!table) {
    if (!/<table/i.test(html)) {
      warnings.push("这段内容里没有表格。如果是复制网页文本（不是源码），请改用「粘贴文本」。");
    } else {
      warnings.push("找到了表格，但不像课表（没认出「星期」表头和「第几节」行头）。可以把这段 HTML 发给我加适配。");
    }
    return { courses: [], warnings, stats: { tables: all.length, weekdayCols: 0, periodRows: 0, cells: 0 } };
  }

  const layout = analyzeTable(table.cells);
  const collected = collectCourses(table, layout, term);
  const courses = collected.courses;
  const cells = collected.cells;

  const merged = new Map<string, Course>();
  for (const c of courses) {
    const key = [c.name, c.day, c.start, c.end].join("|");
    const hit = merged.get(key);
    if (hit) {
      hit.weeks = [...new Set([...hit.weeks, ...c.weeks])].sort((a, b) => a - b);
      if (!hit.loc && c.loc) hit.loc = c.loc;
      if (!hit.teacher && c.teacher) hit.teacher = c.teacher;
    } else merged.set(key, { ...c });
  }

  const result = [...merged.values()].sort((a, b) => a.day - b.day || a.start - b.start);
  if (!result.length && layout.periodRows && layout.weekdayCols) {
    warnings.push("表格认出来了，但单元格里没找到带周次的课程。可能是页面还没渲染完（在浏览器里打开课表页再复制源码）。");
  }
  return {
    courses: result,
    warnings,
    stats: { tables: all.length, weekdayCols: layout.weekdayCols, periodRows: layout.periodRows, cells },
  };
}
