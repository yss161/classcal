/**
 * 「JSON 导入」面板控制器
 *
 * 只做界面与交互；校验、去重、清洗全在 lib/course-table-schema.js，
 * ICS 生成全在 lib/ics-export.js。
 */

import { validateCourseTable, coursesToJson, WEEKDAY_LABEL } from "../lib/course-table-schema.js";
import { coursesToIcs } from "../lib/ics-export.js";
import { SAMPLE_JSON } from "../lib/sample-course-table.js";

export function mountJsonImport(options = {}) {
  const getTerm = typeof options.getTerm === "function" ? options.getTerm : () => ({});
  const toast = typeof options.toast === "function" ? options.toast : () => {};

  const el = (id) => document.getElementById(id);
  const input = el("jsonInput");
  if (!input) return; // 页面上没有这个面板就不挂载

  const fileInput = el("jsonFile");
  const statusBox = el("jsonStatus");
  const errorBox = el("jsonErrors");
  const warnBox = el("jsonWarnings");
  const previewCard = el("jsonPreviewCard");
  const tbody = el("jsonTableBody");
  const confirmBox = el("jsonConfirm");
  const genBtn = el("btnGenerateIcs");
  const genInfo = el("jsonGenInfo");

  let rows = [];            // 当前预览的课程（规范化后的）
  let lastResult = null;
  let timer = null;

  /* ---------------- 渲染 ---------------- */

  function setStatus(kind, text) {
    if (!statusBox) return;
    statusBox.className = "status" + (kind ? " " + kind : "");
    statusBox.textContent = text;
  }

  function renderIssues(box, list, kind) {
    if (!box) return;
    if (!list || !list.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    const items = list.slice(0, 40).map((item) => {
      const where = item.index == null ? "整体" : "第 " + (item.index + 1) + " 条";
      const hint = item.hint ? ' <span class="issue-hint">→ ' + escapeHtml(item.hint) + "</span>" : "";
      const target = item.index == null ? "" : ' data-goto="' + item.index + '"';
      return '<li class="issue ' + kind + '"' + target + "><b>" + where + "</b> " + escapeHtml(item.message) + hint + "</li>";
    });
    box.innerHTML = "<ul>" + items.join("") + "</ul>" + (list.length > 40 ? "<p>…还有 " + (list.length - 40) + " 条</p>" : "");
  }

  function renderPreview() {
    if (!tbody) return;
    tbody.innerHTML = "";
    rows.forEach((course, i) => {
      const tr = document.createElement("tr");
      tr.dataset.index = String(i);
      if (course.warnings && course.warnings.length) tr.className = "has-warning";
      tr.title = course.warnings && course.warnings.length ? course.warnings.join("；") : "";

      tr.appendChild(td(inputEl("text", "name", course.name, i), "w-name"));
      tr.appendChild(td(inputEl("text", "teacher", course.teacher || "", i), "w-small"));
      tr.appendChild(td(selectEl("weekday", course.weekday, i), "w-day"));
      tr.appendChild(td(inputEl("text", "weeks", course.weeks, i), "w-small"));
      tr.appendChild(td(inputEl("text", "periods", course.periods, i), "w-small"));
      tr.appendChild(td(inputEl("text", "location", course.location || "", i), "w-loc"));

      const del = document.createElement("td");
      del.innerHTML = '<button class="ghost danger" data-del="' + i + '">删除</button>';
      tr.appendChild(del);
      tbody.appendChild(tr);
    });

    if (previewCard) previewCard.hidden = rows.length === 0;
    const warnCount = rows.reduce((n, c) => n + (c.warnings ? c.warnings.length : 0), 0);
    const info = el("jsonPreviewInfo");
    if (info) info.textContent = rows.length + " 门课" + (warnCount ? " · " + warnCount + " 条提示（已高亮）" : "");
  }

  function td(child, cls) {
    const cell = document.createElement("td");
    if (cls) cell.className = cls;
    cell.appendChild(child);
    return cell;
  }

  function inputEl(type, field, value, index) {
    const node = document.createElement("input");
    node.type = type;
    node.value = value == null ? "" : value;
    node.dataset.field = field;
    node.dataset.index = String(index);
    return node;
  }

  function selectEl(field, value, index) {
    const node = document.createElement("select");
    node.dataset.field = field;
    node.dataset.index = String(index);
    for (let d = 1; d <= 7; d++) {
      const opt = document.createElement("option");
      opt.value = String(d);
      opt.textContent = WEEKDAY_LABEL[d];
      if (d === value) opt.selected = true;
      node.appendChild(opt);
    }
    return node;
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function updateGenerateState() {
    const ok = Boolean(lastResult && lastResult.ok && rows.length);
    if (confirmBox) {
      confirmBox.disabled = !ok;
      if (!ok) confirmBox.checked = false;
    }
    if (genBtn) genBtn.disabled = !(ok && confirmBox && confirmBox.checked);
    if (genInfo) {
      genInfo.textContent = ok
        ? "确认无误后可以下载 .ics（共 " + rows.length + " 门课）"
        : "先让校验通过、并勾选「确认无误」";
    }
  }

  /* ---------------- 校验管道 ---------------- */

  function run(rawInput) {
    const term = getTerm() || {};
    const result = validateCourseTable(rawInput, {
      totalWeeks: Number(term.weeks) || 20,
      maxPeriod: (term.periods && term.periods.length) || 20,
    });
    lastResult = result;

    if (!result.ok) {
      rows = result.data && result.data.courses ? result.data.courses : [];
      renderPreview();
      setStatus("bad", "校验未通过：" + result.errors.length + " 个问题需要先修掉");
    } else {
      rows = result.data.courses;
      renderPreview();
      const w = result.warnings.length;
      setStatus("good", "校验通过：" + rows.length + " 门课" + (w ? "，另有 " + w + " 条提示" : "，没有警告"));
    }
    renderIssues(errorBox, result.errors, "error");
    renderIssues(warnBox, result.warnings, "warn");
    updateGenerateState();
    return result;
  }

  /** 预览表被改动后：把当前行拼回 JSON 再走一遍同一个校验管道 */
  function revalidate() {
    const result = validateCourseTable(coursesToJson(rows), {
      totalWeeks: Number((getTerm() || {}).weeks) || 20,
      maxPeriod: ((getTerm() || {}).periods || []).length || 20,
    });
    lastResult = result;
    rows = result.data && result.data.courses ? result.data.courses : rows;
    renderPreview();
    renderIssues(errorBox, result.errors, "error");
    renderIssues(warnBox, result.warnings, "warn");
    setStatus(result.ok ? "good" : "bad", result.ok ? "修改后校验通过：" + rows.length + " 门课" : "修改后仍有 " + result.errors.length + " 个问题");
    updateGenerateState();
  }

  /* ---------------- 事件 ---------------- */

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = input.value.trim();
      if (!text) {
        lastResult = null;
        rows = [];
        renderPreview();
        renderIssues(errorBox, [], "error");
        renderIssues(warnBox, [], "warn");
        setStatus("", "等待粘贴 JSON…");
        updateGenerateState();
        return;
      }
      run(text);
    }, 220);
  });

  // 粘贴后立刻跑一次（不等防抖），体验更顺
  input.addEventListener("paste", () => {
    setTimeout(() => {
      clearTimeout(timer);
      const text = input.value.trim();
      if (text) run(text);
    }, 0);
  });

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const text = await file.text();
      input.value = text;
      run(text);
    });
  }

  const clipBtn = el("btnJsonClipboard");
  if (clipBtn) {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      clipBtn.hidden = true; // 不支持就静默隐藏
    } else {
      clipBtn.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (!text || !text.trim()) { toast("剪贴板是空的"); return; }
          input.value = text;
          run(text);
        } catch {
          toast("读取剪贴板被浏览器拒绝了，直接 Ctrl+V 粘贴即可");
        }
      });
    }
  }

  const sampleBtn = el("btnJsonSample");
  if (sampleBtn) {
    sampleBtn.addEventListener("click", () => {
      input.value = SAMPLE_JSON;
      run(SAMPLE_JSON);
      toast("已填入 20 条示例课表");
    });
  }

  const clearBtn = el("btnJsonClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      lastResult = null;
      rows = [];
      renderPreview();
      renderIssues(errorBox, [], "error");
      renderIssues(warnBox, [], "warn");
      setStatus("", "等待粘贴 JSON…");
      updateGenerateState();
    });
  }

  if (tbody) {
    tbody.addEventListener("change", (e) => {
      const field = e.target.dataset && e.target.dataset.field;
      if (!field) return;
      const index = Number(e.target.dataset.index);
      const course = rows[index];
      if (!course) return;
      const value = e.target.value;
      if (field === "weekday") course.weekday = Number(value);
      else if (field === "teacher") course.teacher = value.trim() || null;
      else if (field === "location") course.location = value.trim() || null;
      else course[field] = value.trim();
      revalidate();
    });
    // 输入时只改模型，不重绘（避免光标跳走）；失焦/回车才重新校验
    tbody.addEventListener("input", (e) => {
      const field = e.target.dataset && e.target.dataset.field;
      if (!field || field === "weekday") return;
      const index = Number(e.target.dataset.index);
      const course = rows[index];
      if (!course) return;
      const value = e.target.value;
      if (field === "teacher") course.teacher = value.trim() || null;
      else if (field === "location") course.location = value.trim() || null;
      else course[field] = value.trim();
      lastResult = null;
      updateGenerateState();
    });
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del]");
      if (!btn) return;
      rows.splice(Number(btn.dataset.del), 1);
      revalidate();
    });
  }

  // 点错误项 → 高亮对应行
  [errorBox, warnBox].forEach((box) => {
    if (!box) return;
    box.addEventListener("click", (e) => {
      const li = e.target.closest("[data-goto]");
      if (!li) return;
      const row = tbody && tbody.querySelector('tr[data-index="' + li.dataset.goto + '"]');
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.add("flash");
        setTimeout(() => row.classList.remove("flash"), 1200);
      }
    });
  });

  if (confirmBox) confirmBox.addEventListener("change", updateGenerateState);

  if (genBtn) {
    genBtn.addEventListener("click", () => {
      if (!lastResult || !lastResult.ok || !rows.length) { toast("先让校验通过"); return; }
      const term = getTerm() || {};
      if (!term.start) { toast("先在「学期设置」里选开学第一周的周一"); return; }
      const built = coursesToIcs(rows, term);
      if (!built.events.length) {
        toast(built.issues[0] || "没有可生成的事件");
        return;
      }
      const blob = new Blob([built.text], { type: "text/calendar;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (term.name || "课表") + ".ics";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      if (genInfo) {
        genInfo.textContent = "已下载：" + built.events.length + " 个日程" + (built.issues.length ? "（有 " + built.issues.length + " 条被跳过）" : "") + " · 在 iPhone 上点开这个文件即可「全部添加」";
      }
      toast("已生成 .ics，共 " + built.events.length + " 个日程");
    });
  }

  updateGenerateState();
  if (statusBox) setStatus("", "等待粘贴 JSON…");

  return { run, revalidate, getRows: () => rows };
}
