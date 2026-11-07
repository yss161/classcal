/**
 * course-table-v1 校验模块（纯逻辑、零依赖、不碰 DOM）
 *
 * 职责：文本 → JSON → 规范化 → 校验 → { ok, data, errors, warnings }
 * 供前端「JSON 导入」面板与 test/schema.ts 共用，不在组件里散落逻辑。
 */

export const SCHEMA_VERSION = "course-table-v1";

/* ---------------- 周次 / 节次 ---------------- */

/** "1-16" / "1-16单" / "1,3,5" / "1-8,10-16" / "1-16周(双)" → number[] */
export function parseWeeksSpec(spec, max = 30) {
  const cap = max > 0 ? max : 30;
  const raw = String(spec == null ? "" : spec)
    .replace(/周次?/g, " ")
    .replace(/[（(）)\[\]]/g, "")
    .replace(/，/g, ",")
    .replace(/[~～至到—–]/g, "-")
    .trim();
  if (!raw) return [];
  const chunks = [];
  for (const piece of raw.split(/[,、\s]+/).filter(Boolean)) {
    if (/^[单双]$/.test(piece) && chunks.length) chunks[chunks.length - 1] += piece;
    else chunks.push(piece);
  }
  const out = new Set();
  for (const chunkRaw of chunks) {
    let chunk = chunkRaw.trim();
    let parity = 0;
    if (/(单|odd|o)$/i.test(chunk)) { parity = 1; chunk = chunk.replace(/(单|odd|o)$/i, ""); }
    else if (/(双|even|e)$/i.test(chunk)) { parity = 2; chunk = chunk.replace(/(双|even|e)$/i, ""); }
    const m = /^(\d{1,2})\s*(?:-\s*(\d{1,2}))?$/.exec(chunk);
    if (!m) continue;
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(cap, Math.max(a, b));
    for (let v = lo; v <= hi; v++) {
      if (parity === 1 && v % 2 === 0) continue;
      if (parity === 2 && v % 2 === 1) continue;
      out.add(v);
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** number[] → "1-16" / "1-16单" / "1-8,10-16" */
export function formatWeeks(weeks) {
  const arr = [...new Set((weeks || []).filter((w) => w > 0))].sort((a, b) => a - b);
  if (!arr.length) return "";
  const step = arr.length > 1 ? arr[1] - arr[0] : 1;
  const isArith = arr.every((v, i) => i === 0 || v - arr[i - 1] === step);
  if (isArith && step === 1) return arr[0] + "-" + arr[arr.length - 1];
  if (isArith && step === 2) return arr[0] + "-" + arr[arr.length - 1] + (arr[0] % 2 ? "单" : "双");
  const parts = [];
  let i = 0;
  while (i < arr.length) {
    let j = i;
    while (j + 1 < arr.length && arr[j + 1] - arr[j] === 1) j++;
    if (j - i >= 1) parts.push(arr[i] + "-" + arr[j]);
    else for (let k = i; k <= j; k++) parts.push(String(arr[k]));
    i = j + 1;
  }
  return parts.join(",");
}

/** "1-2" / "第1-2节" / "1,2" / "3" → { start, end } */
export function parsePeriodsSpec(spec, max = 20) {
  const t = String(spec == null ? "" : spec).replace(/\s/g, "").replace(/第|节/g, "").replace(/，/g, ",");
  if (!t) return null;
  const nums = (t.match(/\d{1,2}/g) || []).map(Number).filter((n) => n >= 1 && n <= max);
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

/* ---------------- JSON 清洗 ---------------- */

/** V8 的报错里带位置，换算成行列好提示 */
function positionOf(text, message) {
  const m = /position (\d+)/i.exec(message || "");
  if (!m) return null;
  const pos = Math.min(+m[1], text.length);
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return { line, col };
}

/** 从第一个 { 开始做括号配平（跳过字符串里的括号），拿到最外层对象 */
function sliceBalancedObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * 宽松解析：去 BOM / 去 ```json 围栏 / 去前后解释文字 / 去尾逗号 / 换直引号
 * @returns {{ok:true, value:unknown, notes:string[]} | {ok:false, error:{code:string,message:string,hint?:string}}}
 */
export function parseJsonLoose(input) {
  if (input && typeof input === "object") return { ok: true, value: input, notes: ["已是对象，跳过解析"] };
  let text = String(input == null ? "" : input).replace(/^\uFEFF/, "").trim();
  const notes = [];
  if (!text) {
    return { ok: false, error: { code: "E_EMPTY", message: "内容是空的，把 AI 返回的 JSON 粘进来。", hint: "应该以 { 开头、以 } 结尾。" } };
  }

  // 1) 代码块围栏
  const fence = /\`\`\`(?:json|JSON|js|javascript)?\s*\n?([\s\S]*?)\`\`\`/.exec(text);
  if (fence) {
    text = fence[1].trim();
    notes.push("已去掉 ```json 代码块围栏");
  } else if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*/, "").replace(/```$/, "").trim();
    notes.push("已去掉不完整的代码块围栏");
  }

  // 2) 只保留最外层对象/数组
  if (!/^[[{]/.test(text)) {
    const sliced = sliceBalancedObject(text);
    if (sliced) {
      text = sliced.trim();
      notes.push("已忽略 JSON 前后的多余文字");
    }
  }

  // 3) 常见小毛病
  const cleaned = text
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");

  try {
    return { ok: true, value: JSON.parse(cleaned), notes };
  } catch (e) {
    const where = positionOf(cleaned, e && e.message);
    return {
      ok: false,
      error: {
        code: "E_JSON_PARSE",
        message: "不是合法的 JSON" + (where ? "（第 " + where.line + " 行第 " + where.col + " 个字符附近）" : "") + "：" + (e && e.message ? e.message : ""),
        hint: "常见原因：中文引号、对象之间少了逗号、字符串里有多余换行、结尾多了逗号。",
        at: where || undefined,
      },
    };
  }
}

/* ---------------- 规范化 ---------------- */

const WEEKDAY_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

function normalizeWeekday(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= 7 ? { day: value, coerced: false } : { day: 0, coerced: false };
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (/^[1-7]$/.test(s)) return { day: +s, coerced: true };
    const m = /(?:周|星期|礼拜)?\s*([一二三四五六日天1-7])/.exec(s);
    if (m) {
      const day = WEEKDAY_CN[m[1]] || (/^[1-7]$/.test(m[1]) ? +m[1] : 0);
      if (day) return { day, coerced: true };
    }
  }
  return { day: 0, coerced: false };
}

function cleanTeacher(value) {
  if (value == null) return { teacher: null, starred: false };
  const raw = String(value).trim();
  if (!raw) return { teacher: null, starred: false };
  const stripped = raw.replace(/^[\s*＊]+/, "").trim();
  return { teacher: stripped || null, starred: stripped !== raw };
}

function looksMultiCourse(name) {
  if (!name) return false;
  if (/[\/／、;；]/.test(name)) return true;
  if (name.replace(/\s/g, "").length > 28) return true;
  return false;
}

/* ---------------- 主校验 ---------------- */

/**
 * @param {unknown} input 对象或 JSON 字符串
 * @param {{totalWeeks?:number, maxPeriod?:number}} [options]
 * @returns {{ok:boolean, data:null|{schemaVersion:string, meta:object, courses:Array}, errors:Array, warnings:Array}}
 */
export function validateCourseTable(input, options = {}) {
  const totalWeeks = Number(options.totalWeeks) > 0 ? Number(options.totalWeeks) : 20;
  const maxPeriod = Number(options.maxPeriod) > 0 ? Number(options.maxPeriod) : 20;

  const errors = [];
  const warnings = [];
  const pushError = (index, path, code, message, hint) => errors.push({ index, path, code, message, hint });
  const pushWarning = (index, path, code, message) => warnings.push({ index, path, code, message });

  const parsed = parseJsonLoose(input);
  if (!parsed.ok) {
    pushError(null, "$", parsed.error.code, parsed.error.message, parsed.error.hint);
    return { ok: false, data: null, errors, warnings };
  }
  const root = parsed.value;

  if (!root || typeof root !== "object" || Array.isArray(root)) {
    pushError(null, "$", "E_ROOT_NOT_OBJECT", "最外层必须是一个对象（以 { 开头），现在是 " + (Array.isArray(root) ? "数组" : typeof root) + "。", '结构应为 { "schemaVersion": "course-table-v1", "courses": [ ... ] }');
    return { ok: false, data: null, errors, warnings };
  }

  if (root.schemaVersion !== SCHEMA_VERSION) {
    pushError(
      null,
      "$.schemaVersion",
      "E_SCHEMA_VERSION",
      "schemaVersion 必须是 \"" + SCHEMA_VERSION + "\"，现在是 " + JSON.stringify(root.schemaVersion),
      "如果 AI 给的是别的版本号，把它改成 " + SCHEMA_VERSION + " 再导入。"
    );
  }

  if (!Array.isArray(root.courses)) {
    pushError(null, "$.courses", "E_COURSES_MISSING", "缺少 courses 数组。", '应该是 { "courses": [ { "name": ... } ] }');
    return { ok: false, data: null, errors, warnings };
  }
  if (!root.courses.length) {
    pushError(null, "$.courses", "E_COURSES_EMPTY", "courses 是空数组，没有课程可导入。", "让 AI 重新输出，或检查是不是把课表放到了别的字段里。");
    return { ok: false, data: null, errors, warnings };
  }

  const courses = [];
  const seen = new Map();

  root.courses.forEach((item, i) => {
    const where = "courses[" + i + "]";
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      pushError(i, where, "E_COURSE_NOT_OBJECT", "第 " + (i + 1) + " 条不是对象。");
      return;
    }

    /* name */
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) {
      pushError(i, where + ".name", "E_NAME_EMPTY", "第 " + (i + 1) + " 条课程缺少 name（或为空字符串）。", 'name 必须是非空字符串，例如 "高等数学"。');
    }
    if (looksMultiCourse(name)) {
      pushWarning(i, where + ".name", "W_MULTI_COURSE", '第 ' + (i + 1) + ' 条的课程名 "「' + name + '」" 里像是有多门课粘在一起，建议拆成多条。');
    }

    /* weekday */
    const wd = normalizeWeekday(item.weekday);
    if (!wd.day) {
      if (item.weekday === undefined || item.weekday === null) {
        pushError(i, where + ".weekday", "E_WEEKDAY_MISSING", "第 " + (i + 1) + " 条缺少 weekday。", "weekday 用 1-7 的整数表示周一到周日，例如 1 = 周一。");
      } else if (typeof item.weekday !== "number" && typeof item.weekday !== "string") {
        pushError(i, where + ".weekday", "E_WEEKDAY_TYPE", "第 " + (i + 1) + " 条的 weekday 类型是 " + typeof item.weekday + "。", "应为 1-7 的整数。");
      } else {
        pushError(i, where + ".weekday", "E_WEEKDAY_RANGE", "第 " + (i + 1) + " 条的 weekday = " + JSON.stringify(item.weekday) + "，超出 1-7。", "1 = 周一，7 = 周日。");
      }
    } else if (wd.coerced) {
      pushWarning(i, where + ".weekday", "W_WEEKDAY_COERCED", '第 ' + (i + 1) + ' 条 weekday 写成了 "' + item.weekday + '"，已自动换算成 ' + wd.day + "。");
    }

    /* weeks */
    let weeksList = [];
    if (typeof item.weeks !== "string") {
      if (item.weeks == null) pushError(i, where + ".weeks", "E_WEEKS_MISSING", "第 " + (i + 1) + " 条缺少 weeks。", 'weeks 是字符串，例如 "1-16"、"1-16单"、"1-8,10-16"。');
      else pushError(i, where + ".weeks", "E_WEEKS_TYPE", "第 " + (i + 1) + " 条的 weeks 是 " + typeof item.weeks + "，需要字符串。", '如果是数组，请改成字符串，例如 "1-16"。');
    } else {
      weeksList = parseWeeksSpec(item.weeks, totalWeeks);
      if (!weeksList.length) {
        pushError(i, where + ".weeks", "E_WEEKS_UNPARSABLE", '第 ' + (i + 1) + ' 条的 weeks = "' + item.weeks + '" 解析不出来。', '支持写法："1-16"、"1-16单"、"1,3,5"、"1-8,10-16"。');
      } else {
        const requested = parseWeeksSpec(item.weeks, 999);
        if (requested.some((w) => w > totalWeeks)) {
          pushWarning(i, where + ".weeks", "W_WEEKS_CLIPPED", "第 " + (i + 1) + " 条的周次超出学期总周数（" + totalWeeks + " 周），已裁掉多余部分。");
        }
      }
    }

    /* periods */
    let periods = null;
    if (typeof item.periods !== "string") {
      if (item.periods == null) pushError(i, where + ".periods", "E_PERIODS_MISSING", "第 " + (i + 1) + " 条缺少 periods。", 'periods 是字符串，例如 "1-2"、"3"。');
      else pushError(i, where + ".periods", "E_PERIODS_TYPE", "第 " + (i + 1) + " 条的 periods 是 " + typeof item.periods + "，需要字符串。", '例如 "1-2" 表示第 1 到 2 节。');
    } else {
      periods = parsePeriodsSpec(item.periods, maxPeriod);
      if (!periods) {
        pushError(i, where + ".periods", "E_PERIODS_UNPARSABLE", '第 ' + (i + 1) + ' 条的 periods = "' + item.periods + '" 解析不出来。', '支持写法："1-2"、"第1-2节"、"1,2"、"3"。');
      }
    }

    /* teacher / location 允许 null */
    const { teacher, starred } = cleanTeacher(item.teacher);
    if (starred) pushWarning(i, where + ".teacher", "W_TRIM_STARRED", "第 " + (i + 1) + " 条的教师名前的 * 已清理。");
    if (!teacher) pushWarning(i, where + ".teacher", "W_TEACHER_EMPTY", "第 " + (i + 1) + " 条没有教师名。");

    let location = null;
    if (item.location != null) {
      const loc = String(item.location).trim();
      if (loc) location = loc;
    }
    if (!location) pushWarning(i, where + ".location", "W_LOCATION_EMPTY", "第 " + (i + 1) + " 条没有上课地点。");

    if (errors.some((e) => e.index === i)) return; // 该条有硬错误，先不进入预览

    const course = {
      index: i,
      name,
      teacher,
      weekday: wd.day,
      periods: periods.start === periods.end ? String(periods.start) : periods.start + "-" + periods.end,
      weeks: formatWeeks(weeksList),
      location,
      raw: item,
      warnings: warnings.filter((w) => w.index === i).map((w) => w.message),
    };

    /* 去重：name + weekday + weeks + periods + location */
    const key = [course.name, course.weekday, course.weeks, course.periods, course.location || ""].join("|");
    if (seen.has(key)) {
      const first = seen.get(key);
      pushWarning(i, where, "W_DUPLICATE", "第 " + (i + 1) + " 条与第 " + (first.index + 1) + " 条完全重复，已合并。");
      return;
    }
    seen.set(key, course);
    courses.push(course);
  });

  // 同一条里既报错又已跳过的情况要给个总览
  const badIndexes = new Set(errors.map((e) => e.index).filter((i) => i != null));
  if (badIndexes.size && courses.length) {
    pushWarning(null, "$.courses", "W_PARTIAL", "有 " + badIndexes.size + " 条记录有错误被跳过，其余 " + courses.length + " 条可以导入。");
  }

  courses.sort((a, b) => a.weekday - b.weekday || periodStart(a) - periodStart(b) || a.name.localeCompare(b.name, "zh"));

  return {
    ok: errors.length === 0 && courses.length > 0,
    data: errors.length === 0 ? { schemaVersion: SCHEMA_VERSION, meta: root.meta && typeof root.meta === "object" ? root.meta : {}, courses } : { schemaVersion: SCHEMA_VERSION, meta: {}, courses },
    errors,
    warnings,
  };
}

function periodStart(course) {
  const m = /^(\d+)/.exec(course.periods || "");
  return m ? +m[1] : 0;
}

export const WEEKDAY_LABEL = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 预览表用它把课程行反向拼回 JSON 再校验（用户改了单元格之后） */
export function coursesToJson(courses) {
  return {
    schemaVersion: SCHEMA_VERSION,
    courses: (courses || []).map((c) => ({
      name: c.name,
      teacher: c.teacher == null ? null : c.teacher,
      weekday: c.weekday,
      weeks: c.weeks,
      periods: c.periods,
      location: c.location == null ? null : c.location,
      raw: c.raw,
    })),
  };
}
