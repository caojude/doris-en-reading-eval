"use strict";

const API = (window.CONFIG && window.CONFIG.API) || "";
const MAX_ATTEMPTS = 3;

const $ = (id) => document.getElementById(id);

const state = {
  code: "",
  name: "",
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function show(id) {
  ["step-enter", "step-practice", "step-done"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
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

// ---------------- 进入页面 ----------------
let loadedAssignment = null;

async function loadAssignment() {
  const code = $("code-input").value.trim();
  const sel = $("name-select");
  if (code.length < 2) return;
  try {
    const r = await call("get_assignment", { code });
    if (!r.ok) {
      sel.innerHTML = '<option value="">' + escapeHtml(r.error || "作业码不存在") + "</option>";
      loadedAssignment = null;
      return;
    }
    loadedAssignment = r.assignment;
    sel.innerHTML = '<option value="">请选择你的名字</option>' +
      (r.names || []).map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  } catch (e) {
    sel.innerHTML = '<option value="">加载失败，请检查网络</option>';
    loadedAssignment = null;
  }
}

async function enter() {
  const code = $("code-input").value.trim();
  const name = $("name-select").value;
  if (!code) { $("enter-msg").textContent = "请输入作业码"; return; }
  if (!name) { $("enter-msg").textContent = "请选择你的名字"; return; }
  if (!loadedAssignment || loadedAssignment.code !== code) {
    $("enter-msg").textContent = "作业还没加载成功，请重新输入作业码";
    return;
  }
  state.code = code;
  state.name = name;
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
  setStatus("正在录音，请大声朗读上面这句话…");
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
  if (!state.chunks.length) { setStatus("没有录到声音，请重试"); return; }

  setStatus("正在评分…");
  $("record-btn").disabled = true;
  try {
    const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || "" });
    const conv = await blobToPcm16k(blob);
    if (!conv || !conv.b64) throw new Error("音频转换失败");
    if (audioPeak(conv.samples) < 1000) {
      setStatus("录音声音太小，请靠近麦克风、大声朗读（这次不会消耗重读次数）");
      return;
    }
    const r = await call("evaluate", {
      code: state.code,
      name: state.name,
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
    setStatus("没有听清，请再读一遍");
  } else {
    setStatus(res.total >= 80 ? "很好！" : "再试试，可以先听示范再重读");
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

function restart() {
  state.code = "";
  state.name = "";
  state.assignment = null;
  state.idx = 0;
  state.best = [];
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
  $("btn-restart").addEventListener("click", restart);
  const pre = new URLSearchParams(location.search).get("code");
  if (pre) { $("code-input").value = pre; loadAssignment(); }
});
