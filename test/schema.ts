import {
  validateCourseTable,
  parseJsonLoose,
  parseWeeksSpec,
  formatWeeks,
  coursesToJson,
  SCHEMA_VERSION,
} from "../public/lib/course-table-schema.js";
import { coursesToIcs, buildEvents, buildIcsText, foldLine } from "../public/lib/ics-export.js";
import { SAMPLE_COURSE_TABLE, SAMPLE_JSON } from "../public/lib/sample-course-table.js";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const v = JSON.stringify(want);
  if (g === v) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + "\n     got  " + g + "\n     want " + v); }
}
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + " " + extra); }
}
const codes = (list: any[]) => list.map((x) => x.code);

const term = {
  name: "2026 秋",
  start: "2026-09-07",   // 第 1 周周一
  weeks: 18,
  periods: [
    { s: "08:00", e: "08:45" }, { s: "08:55", e: "09:40" },
    { s: "10:00", e: "10:45" }, { s: "10:55", e: "11:40" },
    { s: "14:00", e: "14:45" }, { s: "14:55", e: "15:40" },
    { s: "16:00", e: "16:45" }, { s: "16:55", e: "17:40" },
  ],
  alarm: 10,
};

/* ------------------------------------------------------------------ */
console.log("\n[1] 示例 JSON（20 条）");
const sample = validateCourseTable(SAMPLE_JSON, { totalWeeks: 18, maxPeriod: 8 });
ok("校验通过（ok=true）", sample.ok, JSON.stringify(sample.errors.slice(0, 3)));
eq("解析出 20 门课", sample.data!.courses.length, 20);
eq("没有 errors", sample.errors.length, 0);
eq("没有 warnings（示例是干净的）", sample.warnings.length, 0);
eq("周次/节次被规范化", [sample.data!.courses[0].weeks, sample.data!.courses[0].periods], ["1-16", "1-2"]);
eq("单周规范化（1-16 单周 = 1,3,…,15）", sample.data!.courses.find((c) => c.name === "概率论与数理统计")!.weeks, "1-15单");
eq("断档周次规范化", sample.data!.courses.find((c) => c.name === "线性代数")!.weeks, "1-8,10-16");
ok("按星期+节次排序", sample.data!.courses[0].weekday === 1);
ok("保留 raw 供核对", JSON.stringify(sample.data!.courses[0].raw) === JSON.stringify(SAMPLE_COURSE_TABLE.courses[0]));

/* ------------------------------------------------------------------ */
console.log("\n[2] 输入清洗（围栏 / 前后文字 / 小毛病）");
const fenced = "好的，结果如下：\n\n```json\n" + JSON.stringify({ schemaVersion: "course-table-v1", courses: [{ name: "高等数学", teacher: null, weekday: 1, weeks: "1-16", periods: "1-2", location: null }] }) + "\n```\n\n以上。";
const fencedRes = validateCourseTable(fenced, { totalWeeks: 18 });
ok("代码块围栏自动剥离", fencedRes.ok, JSON.stringify(fencedRes.errors));
eq("剥离后课程数", fencedRes.data!.courses.length, 1);
ok("剥围栏有 notes", parseJsonLoose(fenced).notes!.length > 0);

const messy = '{"schemaVersion":"course-table-v1","courses":[{"name":"线性代数","weekday":2,"weeks":"1-4","periods":"3-4","teacher":"","location":"A1"},],}';
const messyRes = validateCourseTable(messy, { totalWeeks: 18 });
ok("尾逗号 + 空字符串教师能容错", messyRes.ok, JSON.stringify(messyRes.errors));

const smart = '{\u201cschemaVersion\u201d:\u201ccourse-table-v1\u201d,\u201ccourses\u201d:[{\u201cname\u201d:\u201c体育\u201d,\u201cweekday\u201d:5,\u201cweeks\u201d:\u201c1-8\u201d,\u201cperiods\u201d:\u201c7-8\u201d}]}';
ok("中文引号能修复", validateCourseTable(smart, { totalWeeks: 18 }).ok);

/* ------------------------------------------------------------------ */
console.log("\n[3] 错误定位（具体到某条某字段）");
const noWeekday = {
  schemaVersion: "course-table-v1",
  courses: [
    { name: "高等数学", weekday: 1, weeks: "1-16", periods: "1-2", location: "教1-101", teacher: "张伟" },
    { name: "大学英语", weeks: "1-16", periods: "3-4", location: "外语楼302", teacher: "李娜" },
  ],
};
const nw = validateCourseTable(noWeekday, { totalWeeks: 18 });
ok("缺 weekday → ok=false", !nw.ok);
eq("错误码", codes(nw.errors), ["E_WEEKDAY_MISSING"]);
eq("错误定位到第 2 条", [nw.errors[0].index, nw.errors[0].path], [1, "courses[1].weekday"]);
ok("错误信息可操作（提到 1-7）", nw.errors[0].message.includes("weekday") && (nw.errors[0].hint || "").includes("1-7"));
ok("其余记录仍可预览", nw.data!.courses.length === 1);

const badCases: [string, any, string][] = [
  ["版本号不对", { schemaVersion: "v2", courses: [{ name: "x", weekday: 1, weeks: "1-2", periods: "1-2" }] }, "E_SCHEMA_VERSION"],
  ["courses 不是数组", { schemaVersion: "course-table-v1", courses: {} }, "E_COURSES_MISSING"],
  ["courses 为空", { schemaVersion: "course-table-v1", courses: [] }, "E_COURSES_EMPTY"],
  ["顶层是数组", [], "E_ROOT_NOT_OBJECT"],
  ["课程不是对象", { schemaVersion: "course-table-v1", courses: [123] }, "E_COURSE_NOT_OBJECT"],
  ["name 为空", { schemaVersion: "course-table-v1", courses: [{ name: "  ", weekday: 1, weeks: "1-2", periods: "1-2" }] }, "E_NAME_EMPTY"],
  ["weekday 越界", { schemaVersion: "course-table-v1", courses: [{ name: "x", weekday: 9, weeks: "1-2", periods: "1-2" }] }, "E_WEEKDAY_RANGE"],
  ["weekday 类型错", { schemaVersion: "course-table-v1", courses: [{ name: "x", weekday: {}, weeks: "1-2", periods: "1-2" }] }, "E_WEEKDAY_TYPE"],
  ["weeks 是数组", { schemaVersion: "course-table-v1", courses: [{ name: "x", weekday: 1, weeks: [1, 2], periods: "1-2" }] }, "E_WEEKS_TYPE"],
  ["weeks 解析不了", { schemaVersion: "course-table-v1", courses: [{ name: "x", weekday: 1, weeks: "秋天", periods: "1-2" }] }, "E_WEEKS_UNPARSABLE"],
  ["periods 是数字", { schemaVersion: "course-table-v1", courses: [{ name: "x", weekday: 1, weeks: "1-2", periods: 12 }] }, "E_PERIODS_TYPE"],
  ["periods 解析不了", { schemaVersion: "course-table-v1", courses: [{ name: "x", weekday: 1, weeks: "1-2", periods: "上午" }] }, "E_PERIODS_UNPARSABLE"],
];
for (const [label, payload, wantCode] of badCases) {
  const res = validateCourseTable(payload, { totalWeeks: 18 });
  ok(label + " → " + wantCode, !res.ok && codes(res.errors).includes(wantCode), JSON.stringify(codes(res.errors)));
}
const empty = validateCourseTable("   ", {});
eq("空内容 → E_EMPTY", codes(empty.errors), ["E_EMPTY"]);
const broken = validateCourseTable('{"schemaVersion":"course-table-v1","courses":[{"name":"x",}]', {});
eq("坏 JSON → E_JSON_PARSE", codes(broken.errors), ["E_JSON_PARSE"]);
ok("坏 JSON 给出位置提示", broken.errors[0].message.includes("行"), broken.errors[0].message);

/* ------------------------------------------------------------------ */
console.log("\n[4] 清洗 / 去重 / 警告");
const dirty = {
  schemaVersion: "course-table-v1",
  courses: [
    { name: "高等数学", teacher: "*王老师", weekday: "周一", weeks: "1-16周(单)", periods: "第1-2节", location: "教1-101" },
    { name: "大学英语", teacher: null, weekday: 2, weeks: "1-16", periods: "3-4", location: null },
    { name: "高等数学", teacher: "*王老师", weekday: "周一", weeks: "1-16周(单)", periods: "第1-2节", location: "教1-101" },
    { name: "高数/线代", teacher: "张伟", weekday: 3, weeks: "1-30", periods: "1-2", location: "A101" },
  ],
};
const d = validateCourseTable(dirty, { totalWeeks: 18 });
ok("有警告不算错", d.ok, JSON.stringify(d.errors));
eq("去重后 3 门", d.data!.courses.length, 3);
eq("教师前导 * 被清掉", d.data!.courses.find((c) => c.name === "高等数学")!.teacher, "王老师");
ok("教师 * 清理有警告", codes(d.warnings).includes("W_TRIM_STARRED"));
ok("null 教师/地点是允许的（只警告）", codes(d.warnings).includes("W_TEACHER_EMPTY") && codes(d.warnings).includes("W_LOCATION_EMPTY"));
ok("重复项被合并并提示", codes(d.warnings).includes("W_DUPLICATE"));
ok("「周一」被换算成 1", d.data!.courses.find((c) => c.name === "高等数学")!.weekday === 1 && codes(d.warnings).includes("W_WEEKDAY_COERCED"));
eq("单周规范化", d.data!.courses.find((c) => c.name === "高等数学")!.weeks, "1-15单");
ok("超总周数被裁剪并提示", codes(d.warnings).includes("W_WEEKS_CLIPPED"));
ok("疑似多课粘连有警告", codes(d.warnings).includes("W_MULTI_COURSE"));

/* ------------------------------------------------------------------ */
console.log("\n[5] 周次 / 节次工具");
eq("parseWeeksSpec 单周", parseWeeksSpec("1-16单", 18).length, 8);
eq("parseWeeksSpec 断档", parseWeeksSpec("1-8,10-16", 18).length, 15);
eq("parseWeeksSpec 中文", parseWeeksSpec("（1-4，6）", 18), [1, 2, 3, 4, 6]);
eq("formatWeeks 连续", formatWeeks([1, 2, 3, 4, 5]), "1-5");
eq("formatWeeks 单周", formatWeeks([1, 3, 5, 7]), "1-7单");
eq("formatWeeks 断档", formatWeeks([1, 2, 3, 9, 10, 15]), "1-3,9-10,15");

/* ------------------------------------------------------------------ */
console.log("\n[6] 预览编辑后重新校验（同一管道）");
const editable = JSON.parse(JSON.stringify(sample.data!.courses));
editable[0].name = "高等数学（上）";
editable[0].location = "教9-999";
const revalidated = validateCourseTable(coursesToJson(editable), { totalWeeks: 18, maxPeriod: 8 });
ok("编辑后仍通过", revalidated.ok);
eq("编辑生效", [revalidated.data!.courses.find((c: any) => c.name === "高等数学（上）")!.location], ["教9-999"]);
const brokenEdit = JSON.parse(JSON.stringify(editable));
brokenEdit[1].weekday = 0;
const reBad = validateCourseTable(coursesToJson(brokenEdit), { totalWeeks: 18, maxPeriod: 8 });
ok("编辑成非法值会被拦住", !reBad.ok && codes(reBad.errors).includes("E_WEEKDAY_RANGE"));

/* ------------------------------------------------------------------ */
console.log("\n[7] 生成 .ics（逐周展开）");
const built = coursesToIcs(sample.data!.courses, term);
const expectedEvents = sample.data!.courses.reduce((n, c) => n + parseWeeksSpec(c.weeks, 18).length, 0);
eq("事件数 = 各课周次之和", built.events.length, expectedEvents);
eq("没有被跳过的事件", built.issues.length, 0);
eq("UID 唯一", new Set(built.events.map((e) => e.uid)).size, built.events.length);
ok("UID 形如 c0-xxxxxxxx@classcal", /^c\d+-[0-9a-f]{8}@classcal$/.test(built.events[0].uid), built.events[0].uid);
ok("CRLF 换行", built.text.includes("\r\n") && !/[^\r]\n/.test(built.text));
ok("时区 Asia/Shanghai + VTIMEZONE", built.text.includes("TZID:Asia/Shanghai") && built.text.includes("BEGIN:VTIMEZONE"));
ok("每行 ≤ 75 字节", built.text.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
ok("没有 RRULE（逐周版本）", !built.text.includes("RRULE"));

// 第一门课：第 1 周 周一 08:00-09:40
const first = built.events.find((e) => e.summary === "高等数学A" && e.week === 1)!;
ok("第 1 周周一日期正确", first.date === "20260907", first.date);
ok("节次时间正确", first.dtStart.endsWith("T080000") && first.dtEnd.endsWith("T094000"), first.dtStart + " → " + first.dtEnd);
const week2 = built.events.find((e) => e.summary === "高等数学A" && e.week === 2)!;
ok("第 2 周是 +7 天", week2.date === "20260914", week2.date);

// 单周课只在奇数周出现
const odd = built.events.filter((e) => e.summary === "概率论与数理统计").map((e) => e.week);
ok("单周课只落在奇数周", odd.every((w) => w % 2 === 1) && odd.length === 8, JSON.stringify(odd));

// UID 不依赖 raw
const clone = JSON.parse(JSON.stringify(sample.data!.courses));
clone[0].raw = { 乱七八糟: "改了 raw" };
const uidA = buildEvents(sample.data!.courses, term).events[0].uid;
const uidB = buildEvents(clone, term).events[0].uid;
eq("UID 不依赖 raw", uidB, uidA);

// 转义与折行
const longName = "超长的课程名称".repeat(12);
const esc = buildIcsText([{ uid: "x1", dtStart: "20260907T080000", dtEnd: "20260907T094000", summary: longName, location: "教1-101;A", description: "教师：张三,李四" }], { calendarName: "测试,课表" });
ok("长行被折行且 ≤75 字节", esc.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
ok("逗号/分号被转义", esc.includes("SUMMARY:") && esc.includes("\\,") && esc.includes("\\;"));
eq("折行可无损还原", foldLine("SUMMARY:" + longName).replace(/\r\n /g, ""), "SUMMARY:" + longName);

/* ------------------------------------------------------------------ */
console.log("\n[8] 没有可生成内容时的提示");
const emptyTerm = { ...term, start: "" };
const bad = coursesToIcs(sample.data!.courses, emptyTerm as any);
ok("没填开学日期 → 明确提示", bad.events.length === 0 && bad.issues[0].includes("开学第一周的周一"));
const outOfRange = coursesToIcs([{ name: "越界课", teacher: null, weekday: 1, periods: "9-10", weeks: "1-2", location: null }], term);
ok("节次超出作息表 → 跳过并提示", outOfRange.issues[0].includes("超出作息时间表"));
ok("schemaVersion 常量导出正确", SCHEMA_VERSION === "course-table-v1");

/* ------------------------------------------------------------------ */
console.log("\n[9] 页面元素与模块接线（防止改 id 忘了改 JS）");
const html = readFileSync("public/index.html", "utf8");
const uiSrc = readFileSync("public/ui/json-import.js", "utf8");
const appSrc = readFileSync("public/app.js", "utf8");
const usedIds = [...uiSrc.matchAll(/(?:el|getElementById)\(\s*"([A-Za-z0-9_-]+)"\s*\)/g)].map((m) => m[1]);
const uniq = [...new Set(usedIds)];
const missing = uniq.filter((id) => !html.includes('id="' + id + '"'));
ok("json-import.js 用到的 " + uniq.length + " 个 id 都在 index.html 里", missing.length === 0, "缺少: " + missing.join(","));
ok("index.html 以 module 方式加载 app.js", /<script type="module" src="\/app\.js"><\/script>/.test(html));
ok("app.js 挂载了 JSON 面板", appSrc.includes("mountJsonImport("));
ok("面板里有 4 个步骤标题", (html.match(/<h3>/g) || []).length >= 4);
ok("生成按钮默认禁用", /id="btnGenerateIcs"[^>]*disabled/.test(html));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
if (fail) process.exit(1);
