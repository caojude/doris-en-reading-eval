"use strict";

const API = (window.CONFIG && window.CONFIG.API) || "";
const $ = (id) => document.getElementById(id);
let lastReport = null;    // report 接口原始返回
let currentView = null;   // 当前展示的统计对象（多班级时是其中一个班）
let classList = [];       // [{id,name,count,names,created}]
let selectedClassId = ""; // 班级管理里正在编辑的班级
let lastHistoryItems = [];// 历次作业列表缓存
let editingCode = "";     // 正在编辑再发布的作业码（空 = 新发布）

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function setMsg(el, text, ok) {
  el.textContent = text || "";
  el.classList.toggle("ok", !!ok);
}

async function call(action, payload) {
  if (!API || API.indexOf("请替换") >= 0) throw new Error("系统还没配置好（config.js 里的函数地址未填）");
  const resp = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ action, password: sessionStorage.getItem("pw") || "" }, payload || {})),
  });
  return await resp.json();
}

// ---------------- 登录门禁 ----------------
async function tryLogin(pw) {
  try {
    const resp = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_roster", password: pw }),
    });
    const r = await resp.json();
    if (!r.ok) {
      setMsg($("gate-msg"), r.error && r.error.indexOf("管理密码不正确") >= 0 ? "密码不正确，请重新输入" : "登录失败：" + (r.error || "网络错误"));
      return false;
    }
    sessionStorage.setItem("pw", pw);
    $("login-gate").classList.add("hidden");
    showTab("tab-publish");
    return true;
  } catch (e) {
    setMsg($("gate-msg"), "登录失败：" + e.message);
    return false;
  }
}

// ---------------- 页签 ----------------
function showTab(name) {
  ["tab-publish", "tab-class", "tab-report", "tab-feedback"].forEach((t) =>
    $(t).classList.toggle("hidden", t !== name));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "tab-publish") { loadPublishClasses(); loadHistory(); }
  if (name === "tab-class") loadClasses();
  if (name === "tab-feedback") loadFeedbackAssignments();
  if (name === "tab-report") loadAssignments();
}

// ---------------- 发布作业 ----------------
function genCode() { $("pub-code").value = String(Math.floor(1000 + Math.random() * 9000)); }

async function loadPublishClasses() {
  const box = $("pub-classes");
  try {
    const r = await call("class_list", {});
    if (!r.ok) { box.innerHTML = '<span class="muted">' + escapeHtml(r.error) + "</span>"; return; }
    classList = r.classes || [];
    box.innerHTML = classList.map((c) =>
      `<label><input type="checkbox" value="${escapeHtml(c.id)}"> ${escapeHtml(c.name)}（${c.count} 人）</label>`
    ).join("") || '<span class="muted">还没有班级，先去"班级管理"创建</span>';
  } catch (e) {
    box.innerHTML = '<span class="muted">加载失败：' + escapeHtml(e.message) + "</span>";
  }
}

async function publish() {
  const code = $("pub-code").value.trim();
  const title = $("pub-title").value.trim();
  const text = $("pub-text").value;
  if (!code) { setMsg($("pub-msg"), "请填写作业码"); return; }
  if (!text.trim()) { setMsg($("pub-msg"), "请粘贴课文内容"); return; }
  const classIds = Array.from(document.querySelectorAll("#pub-classes input:checked")).map((x) => x.value);
  if (!classIds.length) { setMsg($("pub-msg"), "请先到“班级管理”建好班级和名单，再回来勾选至少一个班级"); return; }
  try {
    const r = await call(editingCode ? "update_assignment" : "publish", { code, title, text, class_ids: classIds });
    if (!r.ok) { setMsg($("pub-msg"), "更新失败：" + r.error); return; }
    $("pub-msg").classList.add("ok");
    if (editingCode) {
      const note = r.cleared ? " 提示：课文句子有改动，该作业之前的成绩已清空。" : "";
      cancelEdit();
      $("pub-msg").classList.add("ok");
      $("pub-msg").innerHTML = "更新成功！共 " + r.sentences.length + " 句。" + note;
    } else {
      const url = location.href.replace(/teacher\.html.*$/, "") + "index.html?code=" + encodeURIComponent(code);
      $("pub-msg").innerHTML = "发布成功！共 " + r.sentences.length + " 句。<br>学生链接（复制发到家长群）：" +
        `<input readonly value="${escapeHtml(url)}" onclick="this.select()" style="width:100%;margin-top:6px">`;
    }
    loadHistory();
  } catch (e) {
    setMsg($("pub-msg"), "发布失败：" + e.message);
  }
}

async function editAssignment(code) {
  const it = lastHistoryItems.find((x) => x.code === code);
  if (!it) return;
  await loadPublishClasses();
  $("pub-code").value = it.code;
  $("pub-title").value = it.title || "";
  $("pub-text").value = it.text || "";
  $("pub-code").disabled = true;
  document.querySelectorAll("#pub-classes input").forEach((cb) => {
    cb.checked = (it.classes || []).some((c) => c.id === cb.value);
  });
  editingCode = code;
  $("btn-publish").textContent = "更新并发布";
  $("btn-cancel-edit").classList.remove("hidden");
  setMsg($("pub-msg"), "正在编辑作业 " + code + "：改完标题 / 课文 / 班级后点“更新并发布”。课文句子有变化时，之前的成绩会清空。");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelEdit() {
  editingCode = "";
  $("pub-code").value = "";
  $("pub-title").value = "";
  $("pub-text").value = "";
  $("pub-code").disabled = false;
  document.querySelectorAll("#pub-classes input").forEach((cb) => { cb.checked = false; });
  $("btn-publish").textContent = "发布作业";
  $("btn-cancel-edit").classList.add("hidden");
  setMsg($("pub-msg"), "");
}

// ---------------- 历次作业（发布页下方） ----------------
async function loadHistory() {
  const box = $("pub-history");
  try {
    const r = await call("list_assignments", {});
    if (!r.ok) { box.innerHTML = '<span class="muted">' + escapeHtml(r.error || "加载失败") + "</span>"; return; }
    const items = r.items || [];
    lastHistoryItems = items;
    if (!items.length) { box.innerHTML = '<span class="muted">还没有发布过作业</span>'; return; }
    box.innerHTML = items.map((it) => {
      const cls = (it.classes || []).map((c) => escapeHtml(c.name)).join("、") || "旧版名单";
      return `<div class="item-row"><span class="meta"><b>${escapeHtml(it.code)}</b> · ${escapeHtml(it.title || "未命名")}（${cls}）` +
        `<br><span class="muted">${escapeHtml(it.created || "")} · ${it.sentences} 句</span></span>` +
        `<button type="button" data-act="view" data-code="${escapeHtml(it.code)}">查看报告</button>` +
        `<button type="button" data-act="edit" data-code="${escapeHtml(it.code)}">编辑</button>` +
        `<button type="button" class="danger" data-act="del" data-code="${escapeHtml(it.code)}">删除</button></div>`;
    }).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const code = b.dataset.code;
      if (b.dataset.act === "view") viewReport(code);
      else if (b.dataset.act === "edit") editAssignment(code);
      else deleteFromHistory(code, b);
    }));
  } catch (e) {
    box.innerHTML = '<span class="muted">加载失败：' + escapeHtml(e.message) + "</span>";
  }
}

async function viewReport(code) {
  showTab("tab-report");
  await loadAssignments();
  const sel = $("report-select");
  if (sel.value !== code) { sel.value = code; await loadReport(); }
}

async function deleteFromHistory(code, btn) {
  if (!confirm("确定删除作业 " + code + " 吗？\n删除后学生端的这个作业链接就作废了，成绩和留言也会一起删除。")) return;
  btn.disabled = true;
  try {
    const r = await call("delete", { code });
    if (!r.ok) { alert("删除失败：" + r.error); return; }
    await loadHistory();
  } catch (e) {
    alert("删除失败：" + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------------- 班级管理 ----------------
async function loadClasses() {
  try {
    const r = await call("class_list", {});
    if (!r.ok) { setMsg($("class-msg"), "加载失败：" + r.error); return; }
    setMsg($("class-msg"), "");
    classList = r.classes || [];
    const box = $("class-list");
    if (!classList.length) {
      box.innerHTML = '<span class="muted">还没有班级，先在上面创建一个吧</span>';
      $("class-edit").classList.add("hidden");
      selectedClassId = "";
      return;
    }
    box.innerHTML = classList.map((c) =>
      `<div class="item-row"><span class="meta"><b>${escapeHtml(c.name)}</b>（${c.count} 人 · 创建于 ${escapeHtml(c.created || "")}）</span>` +
      `<button type="button" data-act="edit" data-id="${escapeHtml(c.id)}">编辑名单</button>` +
      `<button type="button" class="danger" data-act="del" data-id="${escapeHtml(c.id)}">删除班级</button></div>`
    ).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.act === "edit") editClass(b.dataset.id);
      else deleteClass(b.dataset.id);
    }));
    if (selectedClassId && classList.some((c) => c.id === selectedClassId)) editClass(selectedClassId);
  } catch (e) {
    setMsg($("class-msg"), "加载失败：" + e.message);
  }
}

function editClass(id) {
  const c = classList.find((x) => x.id === id);
  if (!c) return;
  selectedClassId = id;
  $("class-edit").classList.remove("hidden");
  $("class-edit-title").textContent = c.name + " 的名单（一行一个名字，保存后学生才能提交）";
  $("class-roster-input").value = (c.names || []).join("\n");
  setMsg($("class-roster-msg"), "");
}

async function createClass() {
  const name = $("class-new-name").value.trim();
  if (!name) { setMsg($("class-msg"), "请输入班级名称"); return; }
  try {
    const r = await call("class_create", { name });
    if (!r.ok) { setMsg($("class-msg"), "创建失败：" + r.error); return; }
    $("class-new-name").value = "";
    setMsg($("class-msg"), "已创建班级 " + name, true);
    await loadClasses();
    editClass(r.class.id);
  } catch (e) {
    setMsg($("class-msg"), "创建失败：" + e.message);
  }
}

async function deleteClass(id) {
  const c = classList.find((x) => x.id === id);
  if (!c) return;
  if (!confirm("确定删除班级 " + c.name + " 吗？\n已发布作业里这个班的名单会随之消失，但学生已交的成绩不会删除。")) return;
  try {
    const r = await call("class_delete", { id });
    if (!r.ok) { setMsg($("class-msg"), "删除失败：" + r.error); return; }
    if (selectedClassId === id) { selectedClassId = ""; $("class-edit").classList.add("hidden"); }
    setMsg($("class-msg"), "已删除班级 " + c.name, true);
    await loadClasses();
    await loadPublishClasses();
  } catch (e) {
    setMsg($("class-msg"), "删除失败：" + e.message);
  }
}

async function saveClassRoster() {
  if (!selectedClassId) return;
  const text = $("class-roster-input").value;
  try {
    const r = await call("class_roster", { id: selectedClassId, names: text });
    if (r.ok) { setMsg($("class-roster-msg"), "已保存 " + r.count + " 名学生", true); await loadClasses(); }
    else setMsg($("class-roster-msg"), "保存失败：" + r.error);
  } catch (e) {
    setMsg($("class-roster-msg"), "保存失败：" + e.message);
  }
}

// ---------------- 留言板 ----------------
async function loadFeedbackAssignments() {
  const sel = $("feedback-select");
  try {
    const r = await call("list_assignments", {});
    sel.innerHTML = "";
    if (!r.ok || !(r.items || []).length) {
      sel.innerHTML = '<option value="">' + escapeHtml(r.ok ? "还没有发布过作业" : r.error || "") + "</option>";
      $("feedback-list").innerHTML = "";
      return;
    }
    const prev = sel.value;
    (r.items || []).forEach((it) => {
      const o = document.createElement("option");
      o.value = it.code;
      o.textContent = it.code + " · " + (it.title || "未命名") + "（" + (it.created || "") + "）";
      sel.appendChild(o);
    });
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
    await loadFeedbackList();
  } catch (e) {
    sel.innerHTML = '<option value="">加载失败：' + escapeHtml(e.message) + "</option>";
  }
}

async function loadFeedbackList() {
  const code = $("feedback-select").value;
  const box = $("feedback-list");
  if (!code) { box.innerHTML = ""; return; }
  try {
    const r = await call("feedback_list", { code });
    if (!r.ok) { setMsg($("feedback-msg"), "加载失败：" + r.error); return; }
    setMsg($("feedback-msg"), "");
    const items = r.items || [];
    if (!items.length) { box.innerHTML = '<span class="muted">还没有学生留言</span>'; return; }
    box.innerHTML = items.map((it) =>
      `<div class="fb-item"><div class="fb-head"><span class="fb-name">${escapeHtml(it.name)}</span>` +
      (it.class_name ? `<span class="muted">${escapeHtml(it.class_name)}</span>` : "") +
      `<span class="fb-time">${escapeHtml(it.time || "")}</span>` +
      `<button type="button" class="danger" data-file="${escapeHtml(it.file || "")}">删除</button></div>` +
      `<div class="fb-text">${escapeHtml(it.message)}</div></div>`
    ).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => deleteFeedback(b.dataset.file)));
  } catch (e) {
    setMsg($("feedback-msg"), "加载失败：" + e.message);
  }
}

async function deleteFeedback(file) {
  const code = $("feedback-select").value;
  if (!file || !confirm("删除这条留言吗？")) return;
  try {
    const r = await call("feedback_delete", { code, file });
    if (!r.ok) { setMsg($("feedback-msg"), "删除失败：" + r.error); return; }
    await loadFeedbackList();
  } catch (e) {
    setMsg($("feedback-msg"), "删除失败：" + e.message);
  }
}

// ---------------- 学情报告 ----------------
async function loadAssignments() {
  const sel = $("report-select");
  try {
    const r = await call("list_assignments", {});
    sel.innerHTML = "";
    if (!r.ok) {
      sel.innerHTML = '<option value="">加载失败：' + escapeHtml(r.error || "") + "</option>";
      return;
    }
    (r.items || []).forEach((it) => {
      const o = document.createElement("option");
      o.value = it.code;
      o.textContent = it.code + " · " + (it.title || "未命名") + "（" + it.created + "，" + it.sentences + " 句）";
      sel.appendChild(o);
    });
    if (r.items && r.items.length) loadReport();
  } catch (e) {
    sel.innerHTML = '<option value="">加载失败：' + escapeHtml(e.message) + "</option>";
  }
}

async function loadReport() {
  const code = $("report-select").value;
  if (!code) return;
  try {
    const r = await call("report", { code });
    if (!r.ok) { setMsg($("report-msg"), "加载失败：" + r.error); return; }
    setMsg($("report-msg"), "");
    renderReport(r);
  } catch (e) {
    setMsg($("report-msg"), "加载失败：" + e.message);
  }
}

function card(label, value) {
  return `<div class="stat-card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
}

function renderReport(r) {
  lastReport = r;
  const groups = r.classes && r.classes.length > 1 ? r.classes : null;
  const tabs = $("class-tabs");
  if (groups) {
    tabs.innerHTML = groups.map((g, i) =>
      `<button type="button" class="${i === 0 ? "active" : ""}" data-ci="${i}">${escapeHtml(g.class_name || "班级 " + (i + 1))}</button>`
    ).join("");
    tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      tabs.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderView(groups[Number(b.dataset.ci)]);
    }));
    renderView(groups[0]);
  } else {
    tabs.innerHTML = "";
    renderView(r);
  }
}

function renderView(v) {
  currentView = v;
  $("report-class-name").textContent = v.class_name ? "当前班级：" + v.class_name : "";
  const roster = v.roster || [];
  const avgAll = v.students.length
    ? (v.students.reduce((a, s) => a + s.avg, 0) / v.students.length).toFixed(1)
    : "0";
  const attempts = v.students.reduce((a, s) => a + s.attempts, 0);
  $("report-summary").innerHTML = [
    card("完成人数", v.finished + " / " + (roster.length || "?")),
    card("全班平均分", avgAll),
    card("评测总次数", attempts),
    card("句子数", lastReport ? lastReport.assignment.sentences.length : "?"),
  ].join("");

  const thead = "<tr><th>姓名</th><th>完成</th><th>平均分</th><th>重读次数</th><th>用时(分)</th></tr>";
  const tbody = v.students.map((s) =>
    `<tr><td>${escapeHtml(s.name)}</td><td>${s.done}/${s.total}</td><td>${s.avg}</td>` +
    `<td>${s.attempts}</td><td>${Math.round(s.duration_s / 60)}</td></tr>`
  ).join("");
  $("student-table").innerHTML = thead + tbody;

  $("sentence-stats").innerHTML = v.sentences.map((ss) => {
    const chips = (ss.word_stats || []).map((w) => {
      const ratio = ss.count > 0 ? w.wrong / ss.count : 0;
      const cls = w.wrong === 0 ? "w-good" : ratio < 0.3 ? "w-mid" : "w-bad";
      return `<span class="chip ${cls}" title="${escapeHtml(w.word)}：平均 ${w.avg} 分，${w.wrong} 人读错">` +
        `${escapeHtml(w.word)}<i>${w.wrong}</i></span>`;
    }).join("");
    return `<div class="sent-item"><p class="sent-text">${ss.idx + 1}. ${escapeHtml(ss.text)} ` +
      `<span class="muted">（${ss.count} 人完成，均分 ${ss.avg}）</span></p>` +
      `<div class="chips">${chips || '<span class="muted">暂无数据</span>'}</div></div>`;
  }).join("");

  const un = $("unfinished");
  if (v.unfinished && v.unfinished.length) {
    setMsg(un, "还没完成的学生：" + v.unfinished.join("、"));
  } else if (roster.length) {
    setMsg(un, "全部学生都完成了", true);
  } else {
    setMsg(un, "");
  }
}

async function deleteAssignment() {
  const code = $("report-select").value;
  if (!code) { setMsg($("report-msg"), "请先选择一个作业"); return; }
  if (!confirm("确定删除作业 " + code + " 吗？\n删除后学生端的这个作业链接就作废了，成绩和留言也会一起删除。")) return;
  try {
    const r = await call("delete", { code });
    if (!r.ok) { setMsg($("report-msg"), "删除失败：" + r.error); return; }
    setMsg($("report-msg"), "已删除作业 " + code, true);
    lastReport = null;
    currentView = null;
    $("class-tabs").innerHTML = "";
    $("report-class-name").textContent = "";
    $("report-summary").innerHTML = "";
    $("student-table").innerHTML = "";
    $("sentence-stats").innerHTML = "";
    setMsg($("unfinished"), "");
    await loadAssignments();
  } catch (e) {
    setMsg($("report-msg"), "删除失败：" + e.message);
  }
}

function csvCell(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv() {
  if (!currentView || !lastReport) return;
  const rows = [["姓名", "完成句数", "总句数", "平均分", "重读次数", "用时(秒)"]];
  currentView.students.forEach((s) => {
    rows.push([s.name, s.done, s.total, s.avg, s.attempts, s.duration_s]);
  });
  const csv = "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "作业" + lastReport.assignment.code +
    (currentView.class_name ? "-" + currentView.class_name : "") + "-学情.csv";
  a.click();
}

// ---------------- 初始化 ----------------
window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("btn-gen").addEventListener("click", genCode);
  $("btn-publish").addEventListener("click", publish);
  $("btn-cancel-edit").addEventListener("click", cancelEdit);
  $("btn-class-create").addEventListener("click", createClass);
  $("btn-class-roster").addEventListener("click", saveClassRoster);
  $("btn-feedback-refresh").addEventListener("click", loadFeedbackAssignments);
  $("feedback-select").addEventListener("change", loadFeedbackList);
  $("btn-refresh").addEventListener("click", loadAssignments);
  $("report-select").addEventListener("change", loadReport);
  $("btn-csv").addEventListener("click", downloadCsv);
  $("btn-delete").addEventListener("click", deleteAssignment);

  $("btn-gate-enter").addEventListener("click", () => {
    const pw = $("gate-pw").value;
    if (!pw) { setMsg($("gate-msg"), "请输入管理密码"); return; }
    $("btn-gate-enter").disabled = true;
    tryLogin(pw).finally(() => { $("btn-gate-enter").disabled = false; });
  });
  $("gate-pw").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-gate-enter").click();
  });

  const saved = sessionStorage.getItem("pw");
  if (saved) {
    $("gate-pw").value = saved;
    tryLogin(saved);
  }
});
