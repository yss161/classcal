import { importJw } from "../src/lib/jw/index.ts";
import { detectSystem } from "../src/lib/jw/detect.ts";
import { extractKbListJson } from "../src/lib/jw/zf.ts";
import { defaultTerm } from "../src/lib/model.ts";

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
const days = (c: any) => c.weeks.map((w: number) => w);

/* ------------------------------------------------------------------ */
/* 样本 A：正方老版 xskbcx.aspx 风格（<font> + <br> + "1-16周"）        */
/* ------------------------------------------------------------------ */
const sampleZF = `<html><head><title>学生个人课表</title>
<script type="text/javascript" src="/jwglxt/scripts/jquery.js"></script>
</head><body>
<div class="page_title">正方教务管理系统 · 学生个人课表</div>
<table id="Table1" class="blacktab">
<tr><td colspan="9">2026-2027学年第一学期 学生课表</td></tr>
<tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr>
<tr><td>第1-2节</td>
<td><font color=black>高等数学<br>1-16周<br>教1-101<br>张老师</font></td>
<td></td><td></td>
<td><font color=black>大学物理<br>2-17周<br>理科楼305<br>李老师</font></td>
<td></td><td></td><td></td></tr>
<tr><td>第3-4节</td>
<td></td>
<td><font color=black>大学英语<br>1-16周(单)<br>外语楼302</font></td>
<td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>第5-6节</td>
<td></td><td></td><td></td>
<td></td>
<td><font color=black>体育<br>1-16周<br>田径场</font></td>
<td></td><td></td></tr>
</table>
</body></html>`;

console.log("\n[A] 正方老版 HTML");
eq("识别为正方", detectSystem(sampleZF).id, "zf");
const a = importJw(sampleZF, term);
ok("解析成功", a.ok, JSON.stringify(a.warnings));
eq("mode=html", a.mode, "html");
eq("课程数 4", a.courses.length, 4);
const math = a.courses.find((c) => c.name === "高等数学");
eq("高等数学 位置", math ? [math.day, math.start, math.end] : null, [1, 1, 2]);
eq("高等数学 周次", math ? math.weeks.length : null, 16);
eq("高等数学 教室", math?.loc, "教1-101");
eq("高等数学 教师", math?.teacher, "张老师");
const eng = a.courses.find((c) => c.name === "大学英语");
eq("单周解析", eng ? days(eng) : null, [1, 3, 5, 7, 9, 11, 13, 15]);
eq("英语节次（样本里它在星期二那一列）", eng ? [eng.day, eng.start, eng.end] : null, [2, 3, 4]);
const phy = a.courses.find((c) => c.name === "大学物理");
eq("物理周次起点", phy ? phy.weeks[0] : null, 2);
eq("物理教师", phy?.teacher, "李老师");
eq("体育位置", a.courses.find((c) => c.name === "体育")?.day, 5);

/* ------------------------------------------------------------------ */
/* 样本 B：强智科技风格（rowspan + 一格多课 + 教师/地点前缀）           */
/* ------------------------------------------------------------------ */
const sampleQZ = `<html><body>
<div>强智科技 教学一体化服务平台</div>
<table id="kbtable" class="Nsb_r_list">
<tr><td colspan="8">2026-2027-1 课表</td></tr>
<tr><th>时间</th><th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th></tr>
<tr><td rowspan="2">上午</td><td>1-2节</td>
  <td><div>线性代数<br>1-8,10-16周<br>教2-201<br>教师：王老师</div></td>
  <td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>3-4节</td>
  <td></td>
  <td><div>操作系统<br>1-16周(双)<br>计算机楼401<br>教师：赵老师</div><div>编译原理<br>1-8周<br>计算机楼401<br>教师：钱老师</div></td>
  <td></td><td></td><td></td><td></td></tr>
<tr><td>下午</td><td>5-6节</td><td></td><td></td><td></td>
  <td><div>数值分析<br>1-16周<br>地点：数学楼208</div></td><td></td><td></td></tr>
</table></body></html>`;

console.log("\n[B] 强智 HTML（rowspan / 一格两门课）");
eq("识别为强智", detectSystem(sampleQZ).id, "qz");
const b = importJw(sampleQZ, term);
ok("解析成功", b.ok, JSON.stringify(b.warnings));
eq("课程数 4（一格两门课被拆开）", b.courses.length, 4);
const la = b.courses.find((c) => c.name === "线性代数");
eq("断档周次", la ? la.weeks.length : null, 15);
eq("教师带前缀被剥掉", la?.teacher, "王老师");
const os = b.courses.find((c) => c.name === "操作系统");
eq("双周", os ? days(os) : null, [2, 4, 6, 8, 10, 12, 14, 16]);
eq("操作系统位置", os ? [os.day, os.start, os.end] : null, [2, 3, 4]);
eq("编译原理被拆分出来", b.courses.some((c) => c.name === "编译原理"), true);
const num = b.courses.find((c) => c.name === "数值分析");
eq("地点前缀被剥掉", num?.loc, "数学楼208");

/* ------------------------------------------------------------------ */
/* 样本 C：青果 / 树维风格（紧凑单元格 + 无前缀的教室/教师）            */
/* ------------------------------------------------------------------ */
const sampleKGS = `<html><body><div>青果软件 KINGOSOFT 教务系统</div>
<table class="Nsb_r_list">
<tr><td>节次</td><td>一</td><td>二</td><td>三</td><td>四</td><td>五</td></tr>
<tr><td>1-2</td>
<td>数据结构<br>1-16周<br>信息楼A203<br>孙老师</td>
<td></td><td></td><td></td><td></td></tr>
<tr><td>3-4</td>
<td></td><td></td><td>离散数学<br>1-12周<br>信息楼A305</td><td></td><td></td></tr>
</table></body></html>`;

console.log("\n[C] 青果风格（单字星期表头 + 无 节 字行头）");
eq("识别为青果", detectSystem(sampleKGS).id, "kingosoft");
const c = importJw(sampleKGS, term);
ok("解析成功", c.ok, JSON.stringify(c.warnings));
eq("课程数 2", c.courses.length, 2);
eq("数据结构位置", c.courses.find((x) => x.name === "数据结构")?.day, 1);
eq("离散数学周次", c.courses.find((x) => x.name === "离散数学")?.weeks.length, 12);

/* ------------------------------------------------------------------ */
/* 样本 D：正方新版 kbList JSON                                        */
/* ------------------------------------------------------------------ */
const sampleJson = JSON.stringify({
  currentTime: "2026-11-07",
  kbList: [
    { kcmc: "高等数学", xqj: "1", jc: "1-2节", zcd: "1-16周", cdmc: "教1-101", xm: "张老师" },
    { kcmc: "大学英语", xqj: "3", jc: "3-4节", zcd: "1-16周(单)", cdmc: "外语楼302", xm: "王老师" },
    { kcmc: "程序设计", xqj: "4", jc: "0506", zcd: "1-12周", cdmc: "机房A", xm: "陈老师" },
  ],
});

console.log("\n[D] 正方新版 kbList JSON");
const d = importJw(sampleJson, term);
ok("解析成功", d.ok, JSON.stringify(d.warnings));
eq("mode=json", d.mode, "json");
eq("课程数 3", d.courses.length, 3);
const jc = d.courses.find((x) => x.name === "程序设计");
eq("四位节次写法 0506 → 第5-6节", jc ? [jc.start, jc.end] : null, [5, 6]);
eq("JSON 单周", d.courses.find((x) => x.name === "大学英语")?.weeks.length, 8);

/* ------------------------------------------------------------------ */
/* 样本 E：HTML 里内嵌 kbList（课表由 JS 渲染时常见）                   */
/* ------------------------------------------------------------------ */
const embedded = `<html><body><div id="app"></div>
<script>
var kbList = [{"kcmc":"线性代数","xqj":"2","jc":"1-2节","zcd":"1-8周","cdmc":"教2-201","xm":"李老师"}];
</script></body></html>`;
console.log("\n[E] HTML 内嵌 kbList");
eq("能抠出 JSON", Array.isArray(extractKbListJson(embedded)), true);
const e = importJw(embedded, term);
ok("解析成功", e.ok, JSON.stringify(e.warnings));
eq("mode=kbList", e.mode, "kbList");
eq("课程数 1", e.courses.length, 1);

/* ------------------------------------------------------------------ */
/* 样本 F：退化 —— 粘贴的是纯文本 / 空内容 / 乱七八糟的东西            */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* 样本 G：变体布局 —— 列表式（无星期列表头）与「格内自带节次」        */
/* ------------------------------------------------------------------ */
console.log("\n[G] 变体布局");
const listStyle = `<html><body><table>
<tr><td>高等数学{第1-16周} 周一第1,2节 教1-101 张老师</td></tr>
<tr><td>大学英语{第1-16周(单)} 周三第3,4节 外语楼302</td></tr>
</table></body></html>`;
const g1 = importJw(listStyle, term);
ok("列表式也能解析", g1.ok, JSON.stringify(g1.warnings));
eq("列表式 2 门课", g1.courses.length, 2);
eq("列表式星期正确", g1.courses.map((c) => c.day).sort(), [1, 3]);

const inlinePeriod = `<html><body><table>
<tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td></tr>
<tr><td>上午</td><td rowspan="2">高等数学<br>周一第1,2节<br>第1-16周<br>教1-101</td><td></td><td></td></tr>
<tr><td>2</td><td>大学英语<br>1-16周<br>外语楼</td><td></td></tr>
</table></body></html>`;
const g2 = importJw(inlinePeriod, term);
ok("格内自带节次的表格能解析", g2.ok, JSON.stringify(g2.warnings));
const gm = g2.courses.find((c) => c.name === "高等数学");
eq("格内节次生效", gm ? [gm.day, gm.start, gm.end] : null, [1, 1, 2]);

console.log("\n[F] 兜底与容错");
const f1 = importJw("高等数学 周一 1-2节 1-16周 教1-101 张老师", term);
eq("纯文本走 mode=text", [f1.ok, f1.mode, f1.courses.length], [true, "text", 1]);
const f2 = importJw("<html><body><p>没有表格</p></body></html>", term);
eq("无表格时给出提示", [f2.ok, f2.warnings.length > 0], [false, true]);
const f3 = importJw("", term);
eq("空内容", [f3.ok, f3.courses.length], [false, 0]);
const f4 = importJw('{"foo":"bar"}', term);
eq("无关 JSON", [f4.ok, f4.courses.length], [false, 0]);
const f5 = importJw("<table><tr><th>姓名</th><th>成绩</th></tr><tr><td>张三</td><td>90</td></tr></table>", term);
eq("无关表格", [f5.ok, f5.courses.length], [false, 0]);

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
if (fail) process.exit(1);
