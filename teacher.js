"use strict";

const API = (window.CONFIG && window.CONFIG.API) || "";
const $ = (id) => document.getElementById(id);
let lastReport = null;

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
    body: JSON.stringify(Object.assign({ action, password: $("pw-input").value || "" }, payload || {})),
  });
  return await resp.json();
}

// ---------------- 页签 ----------------
function showTab(name) {
  ["tab-publish", "tab-roster", "tab-report"].forEach((t) => $(t).classList.toggle("hidden", t !== name));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "tab-roster") loadRoster();
  if (name === "tab-report") loadAssignments();
}

// ---------------- 发布作业 ----------------
function genCode() { $("pub-code").value = String(Math.floor(1000 + Math.random() * 9000)); }

async function publish() {
  const code = $("pub-code").value.trim();
  const title = $("pub-title").value.trim();
  const text = $("pub-text").value;
  if (!code) { setMsg($("pub-msg"), "请填写作业码"); return; }
  if (!text.trim()) { setMsg($("pub-msg"), "请粘贴课文内容"); return; }
  try {
    const r = await call("publish", { code, title, text });
    if (!r.ok) { setMsg($("pub-msg"), "发布失败：" + r.error); return; }
    const url = location.origin + "/index.html?code=" + encodeURIComponent(code);
    $("pub-msg").classList.add("ok");
    $("pub-msg").innerHTML = "发布成功！共 " + r.sentences.length + " 句。<br>学生链接（复制发到家长群）：" +
      `<input readonly value="${escapeHtml(url)}" onclick="this.select()" style="width:100%;margin-top:6px">`;
  } catch (e) {
    setMsg($("pub-msg"), "发布失败：" + e.message);
  }
}

// ---------------- 班级名单 ----------------
async function loadRoster() {
  try {
    const r = await call("get_roster", {});
    if (r.ok) {
      $("roster-input").value = (r.names || []).join("\n");
      setMsg($("roster-msg"), "");
    } else {
      setMsg($("roster-msg"), "加载失败：" + r.error);
    }
  } catch (e) {
    setMsg($("roster-msg"), "加载失败：" + e.message);
  }
}

async function saveRoster() {
  const text = $("roster-input").value;
  try {
    const r = await call("roster", { names: text });
    if (r.ok) setMsg($("roster-msg"), "已保存 " + r.count + " 名学生", true);
    else setMsg($("roster-msg"), "保存失败：" + r.error);
  } catch (e) {
    setMsg($("roster-msg"), "保存失败：" + e.message);
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
  const roster = r.roster || [];
  const avgAll = r.students.length
    ? (r.students.reduce((a, s) => a + s.avg, 0) / r.students.length).toFixed(1)
    : "0";
  const attempts = r.students.reduce((a, s) => a + s.attempts, 0);
  $("report-summary").innerHTML = [
    card("完成人数", r.finished + " / " + (roster.length || "?")),
    card("全班平均分", avgAll),
    card("评测总次数", attempts),
    card("句子数", r.assignment.sentences.length),
  ].join("");

  const thead = "<tr><th>姓名</th><th>完成</th><th>平均分</th><th>重读次数</th><th>用时(分)</th></tr>";
  const tbody = r.students.map((s) =>
    `<tr><td>${escapeHtml(s.name)}</td><td>${s.done}/${s.total}</td><td>${s.avg}</td>` +
    `<td>${s.attempts}</td><td>${Math.round(s.duration_s / 60)}</td></tr>`
  ).join("");
  $("student-table").innerHTML = thead + tbody;

  $("sentence-stats").innerHTML = r.sentences.map((ss) => {
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
  if (r.unfinished && r.unfinished.length) {
    setMsg(un, "还没完成的学生：" + r.unfinished.join("、"));
  } else if (roster.length) {
    setMsg(un, "全部学生都完成了", true);
  } else {
    setMsg(un, "");
  }
}

function csvCell(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv() {
  if (!lastReport) return;
  const rows = [["姓名", "完成句数", "总句数", "平均分", "重读次数", "用时(秒)"]];
  lastReport.students.forEach((s) => {
    rows.push([s.name, s.done, s.total, s.avg, s.attempts, s.duration_s]);
  });
  const csv = "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "作业" + lastReport.assignment.code + "-学情.csv";
  a.click();
}

// ---------------- 初始化 ----------------
window.addEventListener("DOMContentLoaded", () => {
  $("pw-input").addEventListener("input", () => {
    sessionStorage.setItem("pw", $("pw-input").value);
  });
  const saved = sessionStorage.getItem("pw");
  if (saved) $("pw-input").value = saved;
  if (!API || API.indexOf("请替换") >= 0) {
    setMsg($("pub-msg"), "提示：config.js 里的函数地址还没填（部署时配置）");
  }
});
