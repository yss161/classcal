/* 课表 → iPhone 日历：前端逻辑（无框架、无构建） */
const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const STORAGE_KEY = "classcal.v1";

const DEFAULT_PERIODS = [
  ["08:00", "08:45"], ["08:55", "09:40"], ["10:00", "10:45"], ["10:55", "11:40"],
  ["14:00", "14:45"], ["14:55", "15:40"], ["16:00", "16:45"], ["16:55", "17:40"],
  ["19:00", "19:45"], ["19:55", "20:40"], ["20:50", "21:35"], ["21:45", "22:30"],
];

const state = {
  term: { name: "我的课表", start: "", weeks: 18, alarm: 10, periods: DEFAULT_PERIODS.map((p) => ({ s: p[0], e: p[1] })) },
  courses: [],
};
let lastLinks = null;
let autoTimer = null;
/** 固定链接模式：{ id, key }，存在本地，只有本浏览器能更新它 */
let kv = null;
const KV_STORE = "classcal.kv";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- 周次工具（与服务端规则一致） ---------------- */
function parseWeeks(spec, total) {
  const out = new Set();
  const cap = total > 0 ? total : 30;
  const raw = String(spec || "").replace(/[（(]/g, " ").replace(/[）)]/g, " ").replace(/，/g, ",").replace(/[~～至到]/g, "-").trim();
  if (!raw) return [];
  for (const chunkRaw of raw.split(/[,、\s]+/)) {
    let chunk = chunkRaw.trim();
    if (!chunk) continue;
    let parity = 0;
    if (/(单|odd|o)$/i.test(chunk)) { parity = 1; chunk = chunk.replace(/(单|odd|o)$/i, ""); }
    else if (/(双|even|e)$/i.test(chunk)) { parity = 2; chunk = chunk.replace(/(双|even|e)$/i, ""); }
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(chunk);
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

function weeksToSpec(weeks) {
  const arr = [...new Set(weeks.filter((w) => w > 0))].sort((a, b) => a - b);
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
    if (j - i >= 2) parts.push(arr[i] + "-" + arr[j]);
    else for (let k = i; k <= j; k++) parts.push(String(arr[k]));
    i = j + 1;
  }
  return parts.join(",");
}

/* ---------------- 状态持久化 ---------------- */
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data && data.term) {
      state.term = Object.assign(state.term, data.term);
      state.courses = Array.isArray(data.courses) ? data.courses : [];
      return true;
    }
  } catch (e) {}
  return false;
}

function loadKv() {
  try {
    const raw = localStorage.getItem(KV_STORE);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (v && v.id && v.key) kv = v;
  } catch (e) {}
}
function saveKv() {
  try {
    if (kv) localStorage.setItem(KV_STORE, JSON.stringify(kv));
    else localStorage.removeItem(KV_STORE);
  } catch (e) {}
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try { return await res.json(); } catch (e) { return { ok: false, error: "服务器返回异常（" + res.status + "）" }; }
}

/* ---------------- 学期设置 ---------------- */
function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return "";
  const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (wd - 1));
  return d.toISOString().slice(0, 10);
}

function nextMonday() {
  const d = new Date();
  const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setDate(d.getDate() + (8 - wd) % 7);
  return d.toISOString().slice(0, 10);
}

function renderTerm() {
  $("#termName").value = state.term.name;
  $("#termStart").value = state.term.start || "";
  $("#termWeeks").value = state.term.weeks;
  $("#termAlarm").value = String(state.term.alarm);
  $("#periodsText").value = state.term.periods.map((p) => p.s + "-" + p.e).join("\n");
}

function bindTerm() {
  $("#termName").addEventListener("input", (e) => { state.term.name = e.target.value; onChange(); });
  $("#termStart").addEventListener("change", (e) => {
    const v = e.target.value;
    state.term.start = v ? mondayOf(v) : "";
    if (v && state.term.start !== v) toast("已自动对齐到当周周一：" + state.term.start);
    e.target.value = state.term.start;
    onChange();
  });
  $("#termWeeks").addEventListener("input", (e) => { state.term.weeks = Math.max(1, Math.min(60, +e.target.value || 18)); onChange(); });
  $("#termAlarm").addEventListener("change", (e) => { state.term.alarm = +e.target.value || 0; onChange(); });
  $("#periodsText").addEventListener("change", (e) => {
    const periods = [];
    for (const line of e.target.value.split("\n")) {
      const m = /(\d{1,2}):(\d{2})\s*[-~至到]\s*(\d{1,2}):(\d{2})/.exec(line);
      if (m) periods.push({ s: pad2(m[1]) + ":" + m[2], e: pad2(m[3]) + ":" + m[4] });
    }
    if (!periods.length) { toast("没识别到节次时间，格式应为 08:00-08:45"); return; }
    state.term.periods = periods;
    onChange();
    renderCourses();
  });
}

const pad2 = (v) => String(v).padStart(2, "0");

/* ---------------- 课表渲染 ---------------- */
function renderCourses() {
  const tbody = $("#courseTable tbody");
  tbody.innerHTML = "";
  const periodCount = state.term.periods.length;

  state.courses.forEach((c, i) => {
    const tr = document.createElement("tr");
    tr.dataset.i = String(i);

    const tdName = document.createElement("td");
    tdName.className = "w-name";
    tdName.innerHTML = '<input type="text" data-f="name" value="' + escAttr(c.name) + '" placeholder="课程名" />';

    const tdDay = document.createElement("td");
    tdDay.className = "w-day";
    tdDay.innerHTML = '<select data-f="day">' + DAY_NAMES.map((n, k) => '<option value="' + (k + 1) + '"' + (c.day === k + 1 ? " selected" : "") + ">" + n + "</option>").join("") + "</select>";

    const tdPeriod = document.createElement("td");
    tdPeriod.className = "w-period";
    const options = (sel) => Array.from({ length: periodCount }, (_, k) => '<option value="' + (k + 1) + '"' + (sel === k + 1 ? " selected" : "") + ">" + (k + 1) + "</option>").join("");
    tdPeriod.innerHTML = '<select data-f="start">' + options(c.start) + "</select> – " + '<select data-f="end">' + options(c.end) + "</select>";

    const tdWeeks = document.createElement("td");
    tdWeeks.className = "w-weeks";
    tdWeeks.innerHTML = '<input type="text" data-f="weeks" value="' + escAttr(weeksToSpec(c.weeks)) + '" placeholder="1-16" />';

    const tdLoc = document.createElement("td");
    tdLoc.innerHTML = '<input type="text" data-f="loc" value="' + escAttr(c.loc || "") + '" placeholder="教室" />';

    const tdTeacher = document.createElement("td");
    tdTeacher.innerHTML = '<input type="text" data-f="teacher" value="' + escAttr(c.teacher || "") + '" placeholder="教师" />';

    const tdDel = document.createElement("td");
    tdDel.innerHTML = '<button class="ghost danger" data-del="' + i + '">删除</button>';

    tr.append(tdName, tdDay, tdPeriod, tdWeeks, tdLoc, tdTeacher, tdDel);
    tbody.appendChild(tr);
  });

  $("#courseCount").textContent = String(state.courses.length);
  $("#weeklyHours").textContent = String(state.courses.reduce((n, c) => n + (c.end - c.start + 1), 0));
}

function escAttr(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function bindTable() {
  $("#courseTable").addEventListener("input", onTableEdit);
  $("#courseTable").addEventListener("change", onTableEdit);
  $("#courseTable").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    state.courses.splice(+btn.dataset.del, 1);
    renderCourses();
    onChange();
  });
}

function onTableEdit(e) {
  const field = e.target.dataset.f;
  if (!field) return;
  const tr = e.target.closest("tr");
  if (!tr) return;
  const course = state.courses[+tr.dataset.i];
  if (!course) return;
  const v = e.target.value;
  if (field === "name") course.name = v;
  else if (field === "day") course.day = +v;
  else if (field === "start") course.start = +v;
  else if (field === "end") course.end = +v;
  else if (field === "weeks") course.weeks = parseWeeks(v, state.term.weeks);
  else if (field === "loc") course.loc = v || undefined;
  else if (field === "teacher") course.teacher = v || undefined;
  if (course.end < course.start) course.end = course.start;
  $("#weeklyHours").textContent = String(state.courses.reduce((n, c) => n + (c.end - c.start + 1), 0));
  onChange();
}

function addEmptyCourse() {
  state.courses.push({ name: "", day: 1, start: 1, end: 2, weeks: parseWeeks("1-" + state.term.weeks, state.term.weeks) });
  renderCourses();
  const rows = $$("#courseTable tbody tr");
  const last = rows[rows.length - 1];
  if (last) last.querySelector('input[data-f="name"]').focus();
  onChange();
}

/* ---------------- 导入 ---------------- */
function showWarnings(list) {
  const box = $("#warnings");
  if (!list || !list.length) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = "<b>有 " + list.length + " 条提示：</b><ul>" + list.slice(0, 12).map((w) => "<li>" + escAttr(w) + "</li>").join("") + "</ul>" + (list.length > 12 ? "<p>…还有其他 " + (list.length - 12) + " 条</p>" : "");
}

async function callParse(kind, text) {
  if (!text || !text.trim()) { toast("先粘贴/选择内容"); return; }
  const isJw = kind === "jw";
  const res = await fetch(isJw ? "/api/jw/import" : "/api/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(isJw ? { text, term: state.term } : { kind, text, term: state.term }),
  });
  const data = await res.json();
  if (isJw) {
    const meta = document.getElementById("jwMeta");
    if (meta) {
      const sys = data.system ? data.system.name : "未知系统";
      const st = data.stats ? "（表格 " + data.stats.tables + " 个 / 星期列 " + data.stats.weekdayCols + " / 节次行 " + data.stats.periodRows + "）" : "";
      meta.textContent = "识别为：" + sys + " · 解析方式：" + (data.mode || "-") + st;
    }
  }
  if (!data.ok) { toast(data.error || "解析失败"); showWarnings(data.warnings || []); return; }
  if (data.term && data.term.start) {
    state.term.start = data.term.start;
    $("#termStart").value = data.term.start;
  }
  const append = $("#appendMode").checked;
  const incoming = data.courses || [];
  state.courses = append ? mergeCourseLists(state.courses, incoming) : incoming;
  renderCourses();
  showWarnings(data.warnings || []);
  toast(incoming.length ? "导入 " + incoming.length + " 门课" : "没有解析出课程，看看下面的提示");
  onChange();
}

function mergeCourseLists(a, b) {
  const out = a.slice();
  for (const c of b) {
    const hit = out.find((x) => x.name === c.name && x.day === c.day && x.start === c.start && x.end === c.end);
    if (hit) hit.weeks = [...new Set([...hit.weeks, ...c.weeks])].sort((x, y) => x - y);
    else out.push(c);
  }
  return out;
}

function buildBookmarklet() {
  const origin = location.origin;
  const code =
    "(async()=>{try{" +
    "const h=document.documentElement.outerHTML;" +
    "const r=await fetch('" + origin + "/api/jw/import',{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({text:h})});" +
    "const d=await r.json();" +
    "if(!d.ok||!d.shareUrl){alert('没解析出课程：'+((d.warnings&&d.warnings[0])||d.error||'未知原因')+'。可以改用「复制页面源码」方式粘贴到工具里。');return;}" +
    "window.open(d.shareUrl,'_blank')||(location.href=d.shareUrl);" +
    "}catch(e){alert('请求失败：'+e+'。可以改用「复制页面源码」方式。');}})()";
  return "javascript:" + code;
}

function bindJw() {
  const bm = document.getElementById("bmLink");
  if (bm) bm.setAttribute("href", buildBookmarklet());
  const copyBtn = document.getElementById("btnCopyBm");
  if (copyBtn) copyBtn.addEventListener("click", () => copy(buildBookmarklet()));
  const parseBtn = document.getElementById("btnParseJw");
  if (parseBtn) parseBtn.addEventListener("click", () => callParse("jw", document.getElementById("jwInput").value));
  const file = document.getElementById("jwFile");
  if (file) file.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    document.getElementById("jwInput").value = text.slice(0, 400000);
    callParse("jw", text);
  });
}

function bindImport() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = document.getElementById(tab.dataset.panel);
      if (panel) panel.classList.add("active");
    });
  });

  $("#btnParseText").addEventListener("click", () => callParse("text", $("#textInput").value));
  $("#btnParseCsv").addEventListener("click", () => callParse("csv", $("#csvInput").value));
  $("#btnParseIcs").addEventListener("click", () => callParse("ics", $("#icsInput").value));

  $("#csvFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    $("#csvInput").value = text;
    callParse("csv", text);
  });

  $("#icsFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    $("#icsInput").value = text.slice(0, 200000);
    callParse("ics", text);
  });
}

/* ---------------- 生成订阅 ---------------- */
async function generate(quiet) {
  const courses = state.courses.filter((c) => c.name && c.weeks && c.weeks.length);
  if (!courses.length) { if (!quiet) toast("先导入或填写至少一门课"); return; }
  if (!state.term.start) { if (!quiet) toast("先选开学第一周的周一"); return; }

  const payload = { timetable: { term: state.term, courses } };
  let data = null;

  // 1) 已有固定链接 -> 原地更新（链接不变，iPhone 会自己刷新）
  if (kv && kv.id && kv.key) {
    data = await postJson("/api/save", Object.assign({ id: kv.id, key: kv.key }, payload));
    if (!data.ok) { kv = null; saveKv(); data = null; }
  }
  // 2) 服务端支持 KV -> 新建固定链接
  if (!data) {
    const saved = await postJson("/api/save", payload);
    if (saved.ok) { kv = { id: saved.id, key: saved.key }; saveKv(); data = saved; }
    // 3) 退化：数据内嵌在链接里（无需任何服务端存储）
    else data = await postJson("/api/encode", payload);
  }

  if (!data || !data.ok) { toast((data && data.error) || "生成失败"); return; }

  lastLinks = data;
  $("#result").hidden = false;
  $("#outIcs").value = data.icsUrl;
  $("#outShare").value = data.shareUrl;
  $("#btnSubscribe").href = data.webcalUrl;

  const isKv = data.mode === "kv";
  const badge = $("#modeBadge");
  badge.hidden = false;
  badge.textContent = isKv ? "固定链接" : "链接内嵌";
  badge.className = "badge" + (isKv ? "" : " inline");
  $("#genInfo").textContent = data.courses + " 门课 · " + data.events + " 个日程";
  $("#modeExplain").innerHTML = isKv
    ? "当前是<b>固定链接</b>模式：改课表后订阅地址不变，iPhone 会在几小时内自动同步，不需要重新添加订阅。"
    : "当前是<b>链接内嵌</b>模式（服务器没绑定 KV 存储）：课表内容就在链接里，改完课表会得到一个新链接，需要删掉旧的订阅再加新的。想要固定链接，见 README 的「绑定 KV」一节。";
  $("#btnUnlink").hidden = !isKv;
  if (!quiet) toast(isKv ? "固定链接已更新" : "订阅链接已生成");
}

function bindGenerate() {
  $("#btnGenerate").addEventListener("click", () => generate(false));
  $("#btnCopyIcs").addEventListener("click", () => copy($("#outIcs").value));
  $("#btnCopyShare").addEventListener("click", () => copy($("#outShare").value));

  $("#btnDownload").addEventListener("click", async () => {
    if (!lastLinks) return;
    const res = await fetch(lastLinks.icsUrl);
    const text = await res.text();
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (state.term.name || "课表") + ".ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast("已下载，点开文件即可加入日历");
  });

  $("#btnPreview").addEventListener("click", async () => {
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timetable: { term: state.term, courses: state.courses.filter((c) => c.name && c.weeks.length) } }),
    });
    const text = await res.text();
    const box = $("#previewBox");
    box.hidden = false;
    box.textContent = text;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function bindUnlink() {
  $("#btnUnlink").addEventListener("click", () => {
    kv = null;
    saveKv();
    toast("已解除固定链接，改用链接内嵌模式");
    generate(false);
  });
}

async function copy(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch (e) {
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
    toast("已复制");
  }
}

/* ---------------- 其他交互 ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function onChange() {
  save();
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (state.courses.some((c) => c.name && c.weeks && c.weeks.length) && state.term.start) generate(true);
  }, 900);
}

const DEMO = [
  { name: "高等数学", day: 1, start: 1, end: 2, weeks: parseWeeks("1-16", 18), loc: "教1-101", teacher: "张老师" },
  { name: "大学英语", day: 3, start: 3, end: 4, weeks: parseWeeks("1-16单", 18), loc: "外语楼302", teacher: "王老师" },
  { name: "线性代数", day: 2, start: 5, end: 6, weeks: parseWeeks("1-8,10-16", 18), loc: "教2-201" },
  { name: "大学物理", day: 4, start: 1, end: 2, weeks: parseWeeks("2-17", 18), loc: "理科楼 305" },
  { name: "程序设计", day: 4, start: 7, end: 8, weeks: parseWeeks("1-12", 18), loc: "机房A" },
  { name: "体育", day: 5, start: 5, end: 6, weeks: parseWeeks("1-16", 18), loc: "田径场" },
];

function bindMisc() {
  $("#btnAddRow").addEventListener("click", addEmptyCourse);
  $("#btnAddRow2").addEventListener("click", addEmptyCourse);
  $("#btnDemo").addEventListener("click", () => {
    state.courses = DEMO.map((c) => ({ ...c }));
    renderCourses();
    onChange();
    toast("已填入示例课表");
  });
  $("#btnClear").addEventListener("click", () => {
    if (!confirm("清空所有课程？")) return;
    state.courses = [];
    renderCourses();
    showWarnings([]);
    $("#result").hidden = true;
    onChange();
  });
}

async function loadFromQuery() {
  const token = new URLSearchParams(location.search).get("d");
  if (!token) return false;
  try {
    const res = await fetch("/api/decode?d=" + encodeURIComponent(token));
    const data = await res.json();
    if (!data.ok) { toast("分享链接无效"); return false; }
    state.term = data.timetable.term;
    state.courses = data.timetable.courses;
    return true;
  } catch (e) {
    return false;
  }
}

async function init() {
  const fromQuery = await loadFromQuery();
  if (!fromQuery) load();
  loadKv();
  if (!state.term.start) state.term.start = nextMonday();
  renderTerm();
  renderCourses();
  bindTerm();
  bindTable();
  bindImport();
  bindJw();
  bindGenerate();
  bindUnlink();
  bindMisc();
  if (state.courses.length) generate(true);
}

init();
