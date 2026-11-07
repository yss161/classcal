import { buildIcs, countEvents, escapeText, foldLine } from "../src/lib/ics.ts";
import { decodeToken, deserialize, encodeToken, serialize } from "../src/lib/codec.ts";
import { defaultTerm, normalizeTimetable, parseWeeks, weekRuns, weeksToSpec, type Timetable } from "../src/lib/model.ts";
import { parseText } from "../src/lib/parse-text.ts";
import { parseCsv } from "../src/lib/parse-csv.ts";
import { parseIcs } from "../src/lib/parse-ics.ts";

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

console.log("\n[1] 周次解析与分组");
eq("parseWeeks 1-16 单周", parseWeeks("1-16单", 18), [1,3,5,7,9,11,13,15]);
eq("parseWeeks 1-8,10-16", parseWeeks("1-8,10-16", 18), [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16]);
eq("parseWeeks 中文括号", parseWeeks("（1-4，6）", 18), [1,2,3,4,6]);
eq("parseWeeks 上限截断", parseWeeks("1-30", 16), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
eq("weeksToSpec 连续", weeksToSpec([1,2,3,4,5]), "1-5");
eq("weeksToSpec 单周", weeksToSpec([1,3,5,7]), "1-7单");
eq("weeksToSpec 断档", weeksToSpec([1,2,3,9,10,11,15]), "1-3,9-11,15");
eq("weekRuns 1-8,10-16", weekRuns([1,2,3,4,5,6,7,8,10,11,12,13,14,15,16]).length, 2);
eq("weekRuns 单周", weekRuns([1,3,5,7]), [{ start: 1, step: 2, count: 4 }]);

console.log("\n[2] 样例课表补齐并生成 ICS");
const term = { ...defaultTerm(), name: "2026 秋", start: "2026-09-07", weeks: 18, alarm: 10 };
const tt: Timetable = {
  term,
  courses: [
    { name: "高等数学", day: 1, start: 1, end: 2, weeks: [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16], loc: "教1-101", teacher: "张老师" },
    { name: "大学英语, 听说", day: 3, start: 3, end: 4, weeks: parseWeeks("1-16单", 18), loc: "外语楼 A302" },
    { name: "体育", day: 5, start: 5, end: 6, weeks: [1], loc: "田径场" },
  ],
};
const ics = buildIcs(tt, new Date(Date.UTC(2026, 10, 7, 10, 0, 0)));
ok("ICS 以 BEGIN:VCALENDAR 开头", ics.startsWith("BEGIN:VCALENDAR\r\n"));
ok("ICS 以 END:VCALENDAR 结尾", ics.trimEnd().endsWith("END:VCALENDAR"));
ok("有 VTIMEZONE Asia/Shanghai", ics.includes("TZID:Asia/Shanghai"));
ok("事件数 4（1+2+1）", countEvents(tt) === 4, "got " + countEvents(tt));
ok("RRULE 连续段 COUNT=8", ics.includes("RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=8"));
ok("RRULE 断档第二段", ics.includes("DTSTART;TZID=Asia/Shanghai:20261109T080000"));
ok("RRULE 单周 INTERVAL=2", ics.includes("RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=8"));
ok("单次课程没有 RRULE", !ics.includes("COUNT=1"));
ok("逗号被转义", ics.includes("SUMMARY:大学英语\\, 听说"));
ok("VALARM 存在", ics.includes("TRIGGER:-PT10M"));
ok("行宽 ≤ 75 字节", ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
ok("CRLF 换行", ics.includes("\r\n") && !/[^\r]\n/.test(ics));

console.log("\n[3] 折行与转义边界");
const longLine = "SUMMARY:" + "很长的中文课程名称".repeat(20);
const folded = foldLine(longLine);
ok("折行后每行 ≤75 字节", folded.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
ok("折行后可无损还原", folded.replace(/\r\n /g, "") === longLine);
eq("escapeText 分号逗号", escapeText("a;b,c"), "a\\;b\\,c");

console.log("\n[4] token 编解码往返");
const text1 = serialize(tt);
const back = deserialize(text1);
eq("课程数一致", back.courses.length, tt.courses.length);
eq("学期名一致", back.term.name, tt.term.name);
eq("开始日期一致", back.term.start, tt.term.start);
eq("周次一致", back.courses[0].weeks, tt.courses[0].weeks);
eq("教室一致", back.courses[0].loc, "教1-101");
eq("重生成的 ICS 相同（除时间戳外）", buildIcs(back, new Date(Date.UTC(2026,10,7,10,0,0))) === ics, true);

const token = await encodeToken(tt);
console.log("  token 长度 =", token.length, "字符");
ok("token 只含 url 安全字符", /^[A-Za-z0-9_-]+$/.test(token));
const decoded = await decodeToken(token);
eq("decode 往返课程数", decoded.courses.length, 3);
ok("token < 1200 字符（iOS 输入可接受）", token.length < 1200);

console.log("\n[5] 文本导入");
const textIn = [
  "高等数学 周一 1-2节 1-16周 教1-101 张老师",
  "大学英语\t周三\t3-4节\t1-16周(单)\t外语楼302",
  "线性代数|周二|5-6|1-8,10-16|教2-201|李老师",
  "体育 周五 5-6节 1-16周 田径场",
].join("\n");
const r5 = parseText(textIn, term);
eq("解析出 4 行", r5.courses.length, 4);
eq("第 1 行课程名", r5.courses[0].name, "高等数学");
eq("第 1 行星期", r5.courses[0].day, 1);
eq("第 1 行节次", [r5.courses[0].start, r5.courses[0].end], [1, 2]);
eq("第 1 行周次", r5.courses[0].weeks, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
eq("第 1 行教室", r5.courses[0].loc, "教1-101");
eq("第 1 行教师", r5.courses[0].teacher, "张老师");
eq("单周解析", r5.courses.find((c) => c.name === "大学英语")?.weeks, [1,3,5,7,9,11,13,15]);
eq("断档周次解析", r5.courses.find((c) => c.name === "线性代数")?.weeks.length, 15);
eq("无教师时为空", r5.courses.find((c) => c.name === "体育")?.teacher, undefined);

console.log("\n[6] CSV 导入");
const csvIn = [
  "课程名称,星期,节次,周次,教室,教师",
  "高等数学,周一,1-2,1-16,教1-101,张老师",
  "大学英语,3,3-4,1-16单,外语楼302,王老师",
].join("\n");
const r6 = parseCsv(csvIn, term);
eq("CSV 行数", r6.courses.length, 2);
eq("CSV 课程名", r6.courses[0].name, "高等数学");
eq("CSV 星期", r6.courses[1].day, 3);
eq("CSV 单周", r6.courses[1].weeks.length, 8);

console.log("\n[7] ICS 反向导入");
const r7 = parseIcs(ics, term);
eq("反向解析课程数", r7.courses.length, 3, "got " + JSON.stringify(r7.courses.map((c:any)=>c.name)));
const math = r7.courses.find((c) => c.name === "高等数学");
eq("反向 week/day/period", math ? [math.day, math.start, math.end, math.weeks.length] : null, [1, 1, 2, 15]);
eq("反向教室", math?.loc, "教1-101");
eq("反向教师（从 DESCRIPTION）", math?.teacher, "张老师");

console.log("\n[8] 规范化与容错");
const weird = normalizeTimetable({
  term: { name: "", start: "2026-09-09", weeks: 99, periods: [{ s: "8:00", e: "8:45" }], alarm: -5 },
  courses: [
    { name: "  ", day: 1, start: 2, end: 1, weeks: [1] },
    { name: "A", day: 99, start: 5, end: 1, weeks: [1, 2, 99] },
    { name: "B", day: 2, start: 1, end: 1, weeks: [] },
  ],
});
eq("空课程被丢弃", weird.courses.length, 1);
eq("星期被夹紧", weird.courses[0].day, 7);
eq("节次被夹紧（只有 1 节课时间表）", [weird.courses[0].start, weird.courses[0].end], [1, 1]);
const swapped = normalizeTimetable({ term: { ...defaultTerm(), start: "2026-09-07" }, courses: [{ name: "C", day: 1, start: 5, end: 2, weeks: [1] }] });
eq("起止节次倒序自动交换", [swapped.courses[0].start, swapped.courses[0].end], [2, 5]);
eq("周次越界被过滤（weeks 被夹到 60，99 保留？）", weird.courses[0].weeks, [1, 2]);
eq("日期对齐到周一", weird.term.start, "2026-09-07");
eq("总周数被夹紧", weird.term.weeks, 60);
eq("提醒分钟不为负", weird.term.alarm, 0);
eq("时区补默认值", weird.term.tz, "Asia/Shanghai");

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
if (fail) process.exit(1);
