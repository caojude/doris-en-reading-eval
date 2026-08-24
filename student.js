"use strict";

const API = (window.CONFIG && window.CONFIG.API) || "";
const MAX_ATTEMPTS = 3;

const $ = (id) => document.getElementById(id);

const state = {
  code: "",
  name: "",
  classId: "",
  assignment: null,
  idx: 0,
  best: [],
  attemptsLeft: MAX_ATTEMPTS,
  recording: false,
  mediaRecorder: null,
  stream: null,
  chunks: [],
  recordStart: 0,
};

// 作业码 → 名单条目 [{name, class_id, class_name, label}]，label 用于展示（重名时带班级）
let nameEntries = [];
let entriesCode = "";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function show(id) {
  ["step-enter", "step-practice", "step-done", "step-feedback"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

function setStatus(text) { $("status").textContent = text || ""; }

// ---------------- 标准音示范（浏览器自带英文发音，免费） ----------------
function pickEnglishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang && v.lang.toLowerCase().indexOf("en") === 0) || null;
}

function speakText(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.8;
  const v = pickEnglishVoice();
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => { pickEnglishVoice(); };
}

// ---------------- 接口调用 ----------------
async function call(action, payload) {
  if (!API || API.indexOf("请替换") >= 0) throw new Error("系统还没配置好，请联系老师");
  const resp = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ action }, payload)),
  });
  return await resp.json();
}

// ---------------- 进入页面 / 留言页共用：按作业码加载名单 ----------------
let loadedAssignment = null;

async function loadAssignment() {
  const inFb = !$("step-feedback").classList.contains("hidden");
  const codeInput = inFb ? $("fb-code-input") : $("code-input");
  const msgEl = inFb ? $("fb-msg") : $("enter-msg");
  const code = codeInput.value.trim();
  const list = $("name-list");
  if (code.length < 2) return;
  try {
    const r = await call("get_assignment", { code });
    if (!r.ok) {
      nameEntries = [];
      entriesCode = "";
      list.innerHTML = "";
      if (!inFb) loadedAssignment = null;
      msgEl.textContent = r.error || "作业码不存在";
      return;
    }
    if (!inFb) loadedAssignment = r.assignment;
    nameEntries = r.names || [];
    entriesCode = code;
    list.innerHTML = nameEntries
      .map((e) => `<option value="${escapeHtml(e.label)}"></option>`).join("");
    msgEl.textContent = "";
  } catch (e) {
    nameEntries = [];
    entriesCode = "";
    list.innerHTML = "";
    if (!inFb) loadedAssignment = null;
    msgEl.textContent = "加载失败，请检查网络";
  }
}

function matchNameEntry(typed) {
  // 精确匹配展示名（如"王五（三1班）"）；名字唯一时也接受只输入名字
  const exact = nameEntries.find((e) => e.label === typed);
  if (exact) return { entry: exact };
  const byName = nameEntries.filter((e) => e.name === typed);
  if (byName.length === 1) return { entry: byName[0] };
  if (byName.length > 1) return { error: "这个名字在多个班级都有，请写明班级，如：" + byName[0].label };
  return { error: "名单里没有这个名字，请核对后重新输入" };
}

async function enter() {
  const code = $("code-input").value.trim();
  const typed = $("name-input").value.trim();
  if (!code) { $("enter-msg").textContent = "请输入作业码"; return; }
  if (!typed) { $("enter-msg").textContent = "请输入你的名字"; return; }
  if (!loadedAssignment || loadedAssignment.code !== code) {
    $("enter-msg").textContent = "作业还没加载成功，请重新输入作业码";
    return;
  }
  const m = matchNameEntry(typed);
  if (!m.entry) { $("enter-msg").textContent = m.error; return; }
  state.code = code;
  state.name = m.entry.name;
  state.classId = m.entry.class_id || "";
  state.assignment = loadedAssignment;
  state.idx = 0;
  state.best = [];
  $("enter-msg").textContent = "";
  $("title-display").textContent = state.assignment.title || ("作业 " + code);
  show("step-practice");
  loadSentence();
}

function loadSentence() {
  const a = state.assignment;
  state.attemptsLeft = MAX_ATTEMPTS;
  $("progress").textContent = "第 " + (state.idx + 1) + " / " + a.sentences.length + " 句";
  $("sentence-text").textContent = a.sentences[state.idx];
  $("result-area").classList.add("hidden");
  $("record-btn").disabled = false;
  $("next-btn").disabled = true;
  updateAttemptsText();
  setStatus("");
}

// ---------------- 录音 ----------------
async function toggleRecord() {
  if (state.recording) { stopRecord(); return; }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert("无法使用麦克风。请在浏览器设置里允许麦克风权限，然后重试。");
    return;
  }
  state.chunks = [];
  state.mediaRecorder = new MediaRecorder(state.stream);
  state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.chunks.push(e.data); };
  state.mediaRecorder.onstop = onRecordStop;
  state.recordStart = Date.now();
  state.mediaRecorder.start();
  state.recording = true;
  $("record-btn").textContent = "停止录音";
  $("record-btn").classList.add("recording");
  $("listen-btn").disabled = true;
  setStatus("正在录音，大声读出来吧…");
}

function stopRecord() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
}

async function onRecordStop() {
  state.recording = false;
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  const durationMs = Date.now() - state.recordStart;
  $("record-btn").textContent = "开始录音";
  $("record-btn").classList.remove("recording");
  $("listen-btn").disabled = false;
  if (!state.chunks.length) { setStatus("没有录到声音，再试一次吧"); return; }

  setStatus("正在评分…");
  $("record-btn").disabled = true;
  try {
    const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || "" });
    const conv = await blobToPcm16k(blob);
    if (!conv || !conv.b64) throw new Error("音频转换失败");
    if (audioPeak(conv.samples) < 1000) {
      setStatus("声音有点小哦，靠近麦克风、大声读一遍吧！（这次不扣次数）");
      return;
    }
    const r = await call("evaluate", {
      code: state.code,
      name: state.name,
      class_id: state.classId,
      text: state.assignment.sentences[state.idx],
      idx: state.idx,
      audio: conv.b64,
      duration_ms: durationMs,
    });
    if (!r.ok) throw new Error(r.error || "评分失败");
    state.attemptsLeft = Math.max(0, MAX_ATTEMPTS - r.attempt);
    if (!state.best[state.idx] || r.result.total > state.best[state.idx].total) {
      state.best[state.idx] = r.result;
    }
    renderResult(r.result);
    $("next-btn").disabled = false;
  } catch (e) {
    setStatus("出错了：" + e.message);
  } finally {
    $("record-btn").disabled = false;
  }
}

// ---------------- 音频转换：任意手机格式 → 16kHz 16bit 单声道 PCM（讯飞要求） ----------------
function decodeAudio(arrayBuffer) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === "function") { p.then(resolve).catch(reject); }
    } catch (e) { reject(e); }
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function blobToPcm16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuf = await decodeAudio(arrayBuffer);
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(audioBuf.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = audioBuf;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return { b64: bytesToBase64(new Uint8Array(int16.buffer)), samples: int16 };
}

function audioPeak(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

// ---------------- 结果显示 ----------------
function chipClass(s) { return s >= 80 ? "w-good" : s >= 60 ? "w-mid" : "w-bad"; }

function renderResult(res) {
  const area = $("result-area");
  area.classList.remove("hidden");
  $("score-total").textContent = Math.round(res.total) + " 分";
  const chips = $("word-chips");
  chips.innerHTML = "";
  (res.words || []).forEach((w) => {
    const span = document.createElement("span");
    span.className = "chip " + chipClass(w.score);
    span.textContent = w.word;
    span.title = w.word + "：" + w.score + " 分";
    span.onclick = () => speakText(w.word);
    chips.appendChild(span);
  });
  if (res.is_rejected) {
    setStatus("没有听清，再读一遍吧");
  } else {
    setStatus(res.total >= 80 ? "太棒了！" : "加油！先听一下示范，再读一遍会更棒！");
  }
  updateAttemptsText();
}

function updateAttemptsText() {
  const btn = $("retry-btn");
  if (state.attemptsLeft <= 0) {
    btn.disabled = true;
    btn.textContent = "重读次数已用完";
  } else {
    btn.disabled = false;
    btn.textContent = "再读一遍（还可 " + state.attemptsLeft + " 次）";
  }
}

function retry() {
  if (state.attemptsLeft <= 0) return;
  $("result-area").classList.add("hidden");
  $("next-btn").disabled = true;
  setStatus("");
}

function next() {
  state.idx += 1;
  if (state.idx >= state.assignment.sentences.length) { finish(); return; }
  loadSentence();
}

function finish() {
  show("step-done");
  const scored = state.best.filter(Boolean);
  const total = scored.length ? Math.round(scored.reduce((s, x) => s + x.total, 0) / scored.length) : 0;
  $("final-score").textContent = total + " 分";
  let msg = "太棒了！你的发音非常标准！";
  if (total < 90) msg = "很不错，继续保持！";
  if (total < 75) msg = "完成啦！多听示范再练几遍会更好！";
  if (total < 60) msg = "别灰心，先多听几遍示范音，慢慢来！";
  $("final-msg").textContent = msg;
  const list = $("final-list");
  list.innerHTML = "";
  state.assignment.sentences.forEach((s, i) => {
    const li = document.createElement("li");
    const b = state.best[i];
    li.textContent = s + "　—　" + (b ? Math.round(b.total) + " 分" : "未完成");
    list.appendChild(li);
  });
}

// ---------------- 给老师留言（首页小按钮进入） ----------------
function openFeedback() {
  $("fb-code-input").value = $("code-input").value;
  $("fb-name-input").value = $("name-input").value;
  $("fb-msg").textContent = "";
  const btn = $("btn-fb-send");
  btn.disabled = false;
  btn.textContent = "发给老师";
  show("step-feedback");
  if ($("fb-code-input").value.trim().length >= 2) loadAssignment();
}

function closeFeedback() {
  show("step-enter");
  if ($("code-input").value.trim().length >= 2) loadAssignment();
}

async function sendFeedback() {
  const code = $("fb-code-input").value.trim();
  const typed = $("fb-name-input").value.trim();
  const text = $("fb-text").value.trim();
  if (!code) { $("fb-msg").textContent = "请输入作业码"; return; }
  if (!typed) { $("fb-msg").textContent = "请输入你的名字"; return; }
  if (entriesCode !== code) { $("fb-msg").textContent = "作业还没加载成功，请重新输入作业码"; return; }
  const m = matchNameEntry(typed);
  if (!m.entry) { $("fb-msg").textContent = m.error; return; }
  if (!text) { $("fb-msg").textContent = "写点什么再发送吧"; return; }
  if (text.length > 500) { $("fb-msg").textContent = "太长啦，最多 500 字"; return; }
  const btn = $("btn-fb-send");
  btn.disabled = true;
  try {
    const r = await call("feedback", {
      code: code,
      name: m.entry.name,
      class_id: m.entry.class_id || "",
      message: text,
    });
    if (!r.ok) throw new Error(r.error || "发送失败");
    $("fb-msg").textContent = "已发送，老师会看到的！";
    btn.textContent = "已发送";
  } catch (e) {
    btn.disabled = false;
    $("fb-msg").textContent = "发送失败：" + e.message;
  }
}

function restart() {
  state.code = "";
  state.name = "";
  state.classId = "";
  state.assignment = null;
  state.idx = 0;
  state.best = [];
  $("name-input").value = "";
  $("enter-msg").textContent = "";
  show("step-enter");
}

// ---------------- 初始化 ----------------
window.addEventListener("DOMContentLoaded", () => {
  $("code-input").addEventListener("input", loadAssignment);
  $("btn-enter").addEventListener("click", enter);
  $("listen-btn").addEventListener("click", () => {
    if (state.assignment && state.assignment.sentences[state.idx]) {
      speakText(state.assignment.sentences[state.idx]);
    }
  });
  $("record-btn").addEventListener("click", toggleRecord);
  $("retry-btn").addEventListener("click", retry);
  $("next-btn").addEventListener("click", next);
  $("btn-feedback").addEventListener("click", openFeedback);
  $("fb-code-input").addEventListener("input", loadAssignment);
  $("btn-fb-send").addEventListener("click", sendFeedback);
  $("btn-fb-back").addEventListener("click", closeFeedback);
  $("btn-restart").addEventListener("click", restart);
  const pre = new URLSearchParams(location.search).get("code");
  if (pre) { $("code-input").value = pre; loadAssignment(); }
});
