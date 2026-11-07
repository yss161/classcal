import { readXlsx, unzip, fromBase64 } from "../src/lib/xlsx.ts";
import { parseWorkbook, parseXlsxBase64 } from "../src/lib/parse-xlsx.ts";
import { defaultTerm } from "../src/lib/model.ts";
import { toBase64, makeXlsxSample, buildZip } from "./helpers.ts";

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

const term = { ...defaultTerm(), name: "2026 秋", start: "2026-09-07", weeks: 18 };

console.log("\n[1] ZIP 解压");
const xlsxBytes = await makeXlsxSample({ grid: true, list: true });
ok("文件像 xlsx（PK 开头）", xlsxBytes[0] === 0x50 && xlsxBytes[1] === 0x4b);
const entries = await unzip(xlsxBytes);
ok("解出 5 个条目", entries.size === 5, "got " + entries.size + " -> " + [...entries.keys()].join(","));
ok("sharedStrings 可解压", new TextDecoder().decode(entries.get("xl/sharedStrings.xml") || new Uint8Array()).includes("高等数学"));

console.log("\n[2] 读工作簿");
const wb = await readXlsx(xlsxBytes);
eq("两张工作表", wb.sheets.map((s) => s.name), ["课表", "课程列表"]);
eq("课表行列数", [wb.sheets[0].rows.length, wb.sheets[0].rows[0].length], [4, 4]);
eq("合并区域", wb.sheets[0].merges, [{ r1: 2, c1: 1, r2: 3, c2: 1 }]);
eq("共享字符串落位", wb.sheets[0].rows[1][1], "星期一");
eq("多行单元格保留换行", wb.sheets[0].rows[2][1].split("\n").length, 4);

console.log("\n[3] 解析课程（课表式优先）");
const parsed = parseWorkbook(wb, term);
ok("解析出课程", parsed.courses.length === 3, JSON.stringify(parsed.courses.map((c) => c.name)));
eq("选了课表那张", [parsed.sheet, parsed.mode], ["课表", "grid"]);
const math = parsed.courses.find((c) => c.name === "高等数学");
eq("合并单元格跨两行 → 第1-4节", math ? [math.day, math.start, math.end] : null, [1, 1, 4]);
eq("高等数学周次", math ? math.weeks.length : 0, 16);
eq("高等数学教室/教师", math ? [math.loc, math.teacher] : null, ["教1-101", "张老师"]);
const eng = parsed.courses.find((c) => c.name === "大学英语");
eq("单周", eng ? eng.weeks : null, [1, 3, 5, 7, 9, 11, 13, 15]);
eq("英语位置", eng ? [eng.day, eng.start, eng.end] : null, [2, 1, 2]);
const prog = parsed.courses.find((c) => c.name === "程序设计");
eq("断档周次 15 周", prog ? prog.weeks.length : 0, 15);
eq("程序设计位置/教室", prog ? [prog.day, prog.start, prog.end, prog.loc] : null, [3, 3, 4, "机房A"]);

console.log("\n[4] 只有列表式的工作簿");
const wbList = await readXlsx(await makeXlsxSample({ list: true }));
const parsedList = parseWorkbook(wbList, term);
eq("列表式解析出 2 门", [parsedList.courses.length, parsedList.mode], [2, "list"]);
eq("列表式星期", parsedList.courses.map((c) => c.day), [2, 5]);
eq("列表式周次", parsedList.courses.find((c) => c.name === "线性代数")?.weeks.length, 8);

console.log("\n[5] base64 通路（前端上传用）");
const b64 = toBase64(xlsxBytes);
ok("base64 往返长度一致", fromBase64(b64).length === xlsxBytes.length);
const viaB64 = await parseXlsxBase64(b64, term);
eq("base64 解析课程数", viaB64.courses.length, 3);
ok("data URL 前缀也能处理", fromBase64("data:application/vnd.ms-excel;base64," + b64).length === xlsxBytes.length);

console.log("\n[6] 错误处理");
let errMsg = "";
try { await readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(200).fill(0)])); }
catch (e: any) { errMsg = e.message; }
ok("老版 .xls 给出明确提示", errMsg.includes("另存为 .xlsx"), errMsg);
let errMsg2 = "";
try { await readXlsx(new TextEncoder().encode("这不是 zip".repeat(30))); } catch (e: any) { errMsg2 = e.message; }
ok("非 zip 报错", errMsg2.includes("不是有效的 xlsx"), errMsg2);
const empty = parseWorkbook({ sheets: [{ name: "S", rows: [["随便", "写点", "东西"]], merges: [] }] }, term);
eq("认不出时 ok=false", [empty.courses.length, empty.warnings.length > 0], [0, true]);

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
if (fail) process.exit(1);
