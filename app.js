// app.js — Rayvox 2 launcher engine
// Rebuilt from REA static analysis of the shipped Raycast v1.104.32 artifact.
// Command taxonomy, Window Management layout names, AI BYO-provider model,
// theme colors, and deep-link scheme follow REA-FINDINGS.md observations.

import { loadModel, createRecorder, transcribe, isReady, speak } from "./voice.js";

// ---------- DOM ----------
const launcherWrap = document.getElementById("launcherWrap");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("results");
const micBtn = document.getElementById("micBtn");
const voiceBar = document.getElementById("voiceBar");
const voiceText = document.getElementById("voiceText");
const voiceModel = document.getElementById("voiceModel");
const detailWrap = document.getElementById("detailWrap");
const detailTitle = document.getElementById("detailTitle");
const detailBody = document.getElementById("detailBody");
const detailClose = document.getElementById("detailClose");

// ---------- State ----------
let open = false;
let activeIndex = 0;
let currentResults = [];

// ---------- Storage ----------
const store = {
    get(k, fallback) {
        try { const v = localStorage.getItem("rayvox:" + k); return v ? JSON.parse(v) : fallback; }
        catch (_) { return fallback; }
    },
    set(k, v) { localStorage.setItem("rayvox:" + k, JSON.stringify(v)); },
};

// ---------- Theme (REA: dark #1E1E1E / light #EEF0F2; 8 accent names) ----------
const ACCENTS = [
    { name: "Red", hex: "#ff6363" }, { name: "Orange", hex: "#ff9f43" },
    { name: "Yellow", hex: "#e0b341" }, { name: "Green", hex: "#4caf82" },
    { name: "Blue", hex: "#5aa9ff" }, { name: "Purple", hex: "#7c6cf0" },
    { name: "Pink", hex: "#f06cae" }, { name: "Magenta", hex: "#d46cf0" },
];
function applyTheme() {
    const t = store.get("theme", { mode: "dark", accent: 5 });
    document.documentElement.dataset.theme = t.mode;
    document.documentElement.style.setProperty("--accent", ACCENTS[t.accent % 8].hex);
}

// ---------- Fuzzy match ----------
function fuzzy(query, text) {
    query = query.toLowerCase(); text = text.toLowerCase();
    if (!query) return { score: 0, matches: [] };
    if (text.includes(query)) return { score: 100 - text.indexOf(query), matches: range(text.indexOf(query), query.length) };
    let ti = 0, score = 0, matches = [], streak = 0;
    for (const ch of query) {
        const found = text.indexOf(ch, ti);
        if (found === -1) return null;
        if (found === ti) { streak++; score += 3 + streak; } else { streak = 0; score += 1; }
        matches.push(found); ti = found + 1;
    }
    return { score, matches };
}
function range(start, len) { const a = []; for (let i = 0; i < len; i++) a.push(start + i); return a; }
function escapeHtml(s) { return String(s).replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function mdLite(s) {
    let h = escapeHtml(s);
    h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c.trim()}</pre>`);
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    return h.replace(/\n/g, "<br>");
}

// ---------- AI providers (REA: OpenAI-compatible BYO providers w/ abilities) ----------
// Seeded presets mirror the shipped ai-providers.template.yaml shape; keys are user-supplied.
function aiSettings() {
    return store.get("ai", {
        activePreset: "openai",
        presets: [
            { id: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1", api_key: "", model: "gpt-4o-mini", context: 128000,
              abilities: { temperature: true, vision: true, system_message: true, tools: true, reasoning_effort: false } },
            { id: "perplexity", name: "Perplexity", base_url: "https://api.perplexity.ai", api_key: "", model: "sonar", context: 128000,
              abilities: { temperature: true, vision: true, system_message: true, tools: false, reasoning_effort: false } },
        ],
    });
}
function activePreset() {
    const s = aiSettings();
    return s.presets.find(p => p.id === s.activePreset) || s.presets[0];
}
async function askAI(messages) {
    const p = activePreset();
    if (!p.api_key) throw new Error("No API key — open Settings and add one for " + p.name);
    const url = p.base_url.replace(/\/+$/, "") + "/chat/completions";
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + p.api_key },
        body: JSON.stringify({ model: p.model, messages, temperature: 0.7 }),
    });
    if (!res.ok) throw new Error(`${p.name} HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "(empty response)";
}

// ---------- Window Management (REA: exact observed command names + layout families) ----------
// Fractions reconstructed from Raycast's documented behavior; names are artifact-evidenced.
const WM_LAYOUTS = {
    "Left Half":            { x: 0, y: 0, w: .5, h: 1 },
    "Right Half":           { x: .5, y: 0, w: .5, h: 1 },
    "Top Half":             { x: 0, y: 0, w: 1, h: .5 },
    "Bottom Half":          { x: 0, y: .5, w: 1, h: .5 },
    "Top Left Quarter":     { x: 0, y: 0, w: .5, h: .5 },
    "Top Right Quarter":    { x: .5, y: 0, w: .5, h: .5 },
    "Bottom Left Quarter":  { x: 0, y: .5, w: .5, h: .5 },
    "Bottom Right Quarter": { x: .5, y: .5, w: .5, h: .5 },
    "Top Left Sixth":       { x: 0, y: 0, w: 1 / 3, h: .5 },
    "Top Center Sixth":     { x: 1 / 3, y: 0, w: 1 / 3, h: .5 },
    "Top Right Sixth":      { x: 2 / 3, y: 0, w: 1 / 3, h: .5 },
    "Bottom Left Sixth":    { x: 0, y: .5, w: 1 / 3, h: .5 },
    "Bottom Center Sixth":  { x: 1 / 3, y: .5, w: 1 / 3, h: .5 },
    "Bottom Right Sixth":   { x: 2 / 3, y: .5, w: 1 / 3, h: .5 },
    "Center Two Thirds":    { x: 1 / 6, y: 0, w: 2 / 3, h: 1 },
    "Bottom Two Thirds":    { x: 1 / 6, y: .5, w: 2 / 3, h: .5 },
    "Center Three Fourths": { x: 1 / 8, y: 0, w: 3 / 4, h: 1 },
    "Almost Maximize":      { x: .05, y: .05, w: .9, h: .9 },
    "Maximize":             { x: 0, y: 0, w: 1, h: 1 },
    "Center":               { x: .15, y: .1, w: .7, h: .8 },
};
function wmPreviewHtml(name) {
    const l = WM_LAYOUTS[name];
    // 6x4 mini-map with the active region highlighted
    let cells = "";
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
        const cx = c / 6, cy = r / 4, on =
            cx >= l.x - .01 && cx + 1 / 6 <= l.x + l.w + .01 &&
            cy >= l.y - .01 && cy + 1 / 4 <= l.y + l.h + .01;
        cells += `<div class="wm-cell${on ? " on" : ""}"></div>`;
    }
    const desktop = window.rayvox && window.rayvox.isDesktop;
    return `<div class="wm-map">${cells}</div>
        <div class="kv"><span>Layout</span><span>${escapeHtml(name)}</span></div>
        <div class="kv"><span>Applies to</span><span>${desktop ? "This window" : "Desktop app only"}</span></div>
        <p style="color:var(--text-dim);font-size:.8rem">${desktop ? "Press ↵ to apply" : "Preview only in browser — the Electron build moves the real window"}</p>`;
}
function applyWindowLayout(name) {
    if (window.rayvox && window.rayvox.moveWindow) {
        window.rayvox.moveWindow(WM_LAYOUTS[name]);
        toast("🪟 " + name);
        closeLauncher();
    } else {
        toast("🪟 " + name + " — desktop build applies this to the window");
    }
}

// ---------- Calculator with history (REA: Calculator History root command) ----------
function calcEval(q) {
    const expr = q.replace(/[^0-9+\-*/().%^ ]/g, "").trim();
    if (!expr) return null;
    try {
        const val = Function('"use strict";return (' + expr.replace(/\^/g, "**") + ")")();
        if (typeof val !== "number" || !isFinite(val)) return null;
        return { expr, val };
    } catch (_) { return null; }
}
// Natural-language conversions (REA: "Convert 10 USD to EUR and add 123 GBP" behavior class)
const UNITS = {
    km: { mi: .621371, m: 1000, ft: 3280.84 }, mi: { km: 1.60934, m: 1609.34, ft: 5280 },
    m: { ft: 3.28084, km: .001, mi: .000621371 }, ft: { m: .3048, cm: 30.48, in: 12 },
    kg: { lb: 2.20462, g: 1000 }, lb: { kg: .453592, g: 453.592 }, g: { kg: .001, lb: .00220462 },
    cm: { in: .393701, m: .01 }, in: { cm: 2.54, ft: 1 / 12 },
    l: { gal: .264172, ml: 1000 }, gal: { l: 3.78541, ml: 3785.41 },
};
function convertResult(q) {
    const m = q.match(/(-?\d+(?:\.\d+)?)\s*([a-z°]+)\s*(?:in|to|as)\s*([a-z°]+)/i);
    if (!m) return null;
    const n = parseFloat(m[1]); let from = m[2].toLowerCase().replace("°", ""); const to = m[3].toLowerCase().replace("°", "");
    if ((from === "c" && to === "f") || (from === "f" && to === "c")) {
        const v = from === "c" ? n * 9 / 5 + 32 : (n - 32) * 5 / 9;
        return { html: `<div class="calc-result">${+v.toFixed(2)} °${to.toUpperCase()}</div>${convKv(n, m[2], v, to)}` };
    }
    if (from === "f") from = "ft"; // common dictation collision
    const t = UNITS[from]?.[to];
    if (t == null) return null;
    const v = n * t;
    return { html: `<div class="calc-result">${+v.toFixed(3)} ${escapeHtml(to)}</div>${convKv(n, m[2], v, to)}` };
}
function convKv(n, from, v, to) {
    return `<div class="kv"><span>Input</span><span>${n} ${escapeHtml(from)}</span></div>
            <div class="kv"><span>Result</span><span>${+v.toFixed(3)} ${escapeHtml(to)}</span></div>`;
}
function timeDiffResult(q) {
    // "difference between 9am and 5pm" / "hours between 14:00 and 17:30"
    const m = q.match(/(?:difference|hours?|minutes?)\s*(?:between|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:and|to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!m) return null;
    const to24 = (h, mm, ap) => { h = +h; if (ap) { if (ap.toLowerCase() === "pm" && h !== 12) h += 12; if (ap.toLowerCase() === "am" && h === 12) h = 0; } return h * 60 + (+(mm || 0)); };
    let a = to24(m[1], m[2], m[3]), b = to24(m[4], m[5], m[6]);
    if (b < a) b += 24 * 60;
    const mins = b - a, hrs = Math.floor(mins / 60), rem = mins % 60;
    return { html: `<div class="calc-result">${hrs}h ${rem}m</div>
        <div class="kv"><span>From</span><span>${escapeHtml(m[1] + (m[2] ? ":" + m[2] : "") + (m[3] || ""))}</span></div>
        <div class="kv"><span>To</span><span>${escapeHtml(m[4] + (m[5] ? ":" + m[5] : "") + (m[6] || ""))}</span></div>
        <div class="kv"><span>Total</span><span>${mins} minutes</span></div>` };
}
function calcHistoryHtml() {
    const h = store.get("calcHistory", []);
    return h.length
        ? h.slice(0, 6).map(r => `<div class="kv"><span>${escapeHtml(r.expr)}</span><span>${r.val}</span></div>`).join("")
        : `<p style="color:var(--text-dim)">No history yet.</p>`;
}

// ---------- Snippets (asyar-style, kept) ----------
function seedSnippets() {
    if (!store.get("snippets", null)) {
        store.set("snippets", [
            { keyword: "brb", expansion: "Be right back!" },
            { keyword: "sig", expansion: "Best regards,\nAlex" },
            { keyword: "addr", expansion: "3rd Floor, 1 Ashley Road, Altrincham, Cheshire WA14 2DT" },
            { keyword: "lorem", expansion: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." },
        ]);
    }
}
seedSnippets();
function snippetResult(q) {
    const snippets = store.get("snippets", []);
    const query = q.trim();
    if (!query) return { show: true, html: snippets.length
        ? snippets.map(s => `<div class="kv"><span><code>${escapeHtml(s.keyword)}</code></span><span>${escapeHtml(s.expansion)}</span></div>`).join("")
        : `<p>No snippets yet.</p>` };
    const exact = snippets.find(s => s.keyword.toLowerCase() === query.toLowerCase());
    if (exact) return { show: true, copy: exact.expansion, html: `<div class="kv"><span>Keyword</span><span><code>${escapeHtml(exact.keyword)}</code></span></div><div class="calc-result" style="font-size:1rem">${escapeHtml(exact.expansion)}</div><p style="color:var(--text-dim);font-size:.8rem">Press ↵ to copy expansion</p>` };
    const matches = snippets.filter(s => s.keyword.includes(query.toLowerCase()));
    return { show: true, html: matches.length
        ? matches.map(s => `<div class="kv"><span><code>${escapeHtml(s.keyword)}</code></span><span>${escapeHtml(s.expansion)}</span></div>`).join("")
        : `<p>No snippet matches <code>${escapeHtml(query)}</code>. Try <code>sig</code>, <code>brb</code>, <code>addr</code>.</p>` };
}

// ---------- Date math ----------
function dateResult(q) {
    const query = q.trim().toLowerCase();
    if (!query) return { show: true, html: `<p>Type <code>+3 days</code>, <code>in 2 weeks</code>, or <code>10/25</code></p>` };
    const now = new Date();
    let target = null, mm;
    if ((mm = query.match(/(?:\+|in)\s*(\d+)\s*(day|days|week|weeks|month|months|hour|hours|year|years)/))) {
        const n = +mm[1], u = mm[2]; target = new Date(now);
        if (u.startsWith("day")) target.setDate(target.getDate() + n);
        else if (u.startsWith("week")) target.setDate(target.getDate() + n * 7);
        else if (u.startsWith("month")) target.setMonth(target.getMonth() + n);
        else if (u.startsWith("hour")) target.setHours(target.getHours() + n);
        else target.setFullYear(target.getFullYear() + n);
    } else if ((mm = query.match(/(\d+)\s*(day|week|month)\s*ago/))) {
        const n = +mm[1], u = mm[2]; target = new Date(now);
        if (u.startsWith("day")) target.setDate(target.getDate() - n);
        else if (u.startsWith("week")) target.setDate(target.getDate() - n * 7);
        else target.setMonth(target.getMonth() - n);
    } else if ((mm = query.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
        let yr = mm[3] ? +mm[3] : now.getFullYear(); if (yr < 100) yr += 2000;
        target = new Date(yr, +mm[1] - 1, +mm[2]);
    }
    if (!target) return { show: true, html: `<p>Couldn't parse. Try <code>+3 days</code>, <code>in 2 weeks</code>, or <code>10/25</code>.</p>` };
    const days = Math.round((target - now) / 86400000);
    const rel = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : `in ${Math.abs(days)} days`;
    return { show: true, html: `<div class="calc-result">${target.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div><div class="kv"><span>Relative</span><span>${rel}</span></div><div class="kv"><span>Time</span><span>${target.toLocaleTimeString()}</span></div>` };
}

// ---------- Settings (AI provider config; REA abilities matrix) ----------
function openSettings() {
    const s = aiSettings(); const p = activePreset();
    const presetOpts = s.presets.map(x => `<option value="${x.id}"${x.id === s.activePreset ? " selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
    openDetail("Settings — AI Provider", `
        <div class="kv"><span>Provider</span><select id="aiPreset" class="ai-input">${presetOpts}</select></div>
        <div class="kv"><span>Base URL</span><input id="aiBase" class="ai-input" value="${escapeHtml(p.base_url)}"></div>
        <div class="kv"><span>API key</span><input id="aiKey" class="ai-input" type="password" placeholder="sk-… (stored locally only)" value="${escapeHtml(p.api_key)}"></div>
        <div class="kv"><span>Model</span><input id="aiModel" class="ai-input" value="${escapeHtml(p.model)}"></div>
        <div class="kv"><span>Context</span><input id="aiCtx" class="ai-input" type="number" value="${p.context || 128000}"></div>
        <p style="color:var(--text-dim);font-size:.78rem;margin-top:.6rem">
            Any OpenAI-API-compatible endpoint works (REA-observed capability). Keys never leave this device.</p>`);
    const btn = document.createElement("button");
    btn.className = "btn"; btn.textContent = "Save settings";
    btn.onclick = () => {
        const next = aiSettings();
        const preset = next.presets.find(x => x.id === document.getElementById("aiPreset").value);
        preset.base_url = document.getElementById("aiBase").value.trim();
        preset.api_key = document.getElementById("aiKey").value.trim();
        preset.model = document.getElementById("aiModel").value.trim();
        preset.context = +document.getElementById("aiCtx").value || 128000;
        next.activePreset = preset.id;
        store.set("ai", next);
        toast("Settings saved"); closeDetail();
    };
    detailBody.appendChild(btn);
    document.getElementById("aiPreset").onchange = (e) => {
        const n = aiSettings(); n.activePreset = e.target.value; store.set("ai", n); openSettings();
    };
}

// ---------- AI Chat (REA: AI Chat root command, chat history) ----------
function chatHistoryHtml() {
    const h = store.get("chat", []);
    if (!h.length) return `<p style="color:var(--text-dim)">New chat — ask anything. Uses <b>${escapeHtml(activePreset().name)} · ${escapeHtml(activePreset().model)}</b>.</p>`;
    return h.slice(-8).map(m => `<div class="chat-msg ${m.role}"><span class="chat-role">${m.role === "user" ? "You" : "AI"}</span>${mdLite(m.content)}</div>`).join("");
}
function openChat(initial) {
    openDetail("AI Chat", `<div id="chatLog">${chatHistoryHtml()}</div>
        <div class="chat-row"><input id="chatInput" class="ai-input" placeholder="Ask AI… (Enter to send)" value="${escapeHtml(initial || "")}"></div>`);
    const input = document.getElementById("chatInput");
    const send = async () => {
        const q = input.value.trim(); if (!q) return;
        input.value = ""; input.disabled = true;
        const chat = store.get("chat", []);
        chat.push({ role: "user", content: q }); store.set("chat", chat);
        document.getElementById("chatLog").innerHTML = chatHistoryHtml() +
            `<div class="chat-msg assistant"><span class="chat-role">AI</span><i>thinking…</i></div>`;
        try {
            const reply = await askAI(chat.slice(-12).map(m => ({ role: m.role, content: m.content })));
            chat.push({ role: "assistant", content: reply }); store.set("chat", chat);
            document.getElementById("chatLog").innerHTML = chatHistoryHtml();
        } catch (e) {
            const chat2 = store.get("chat", []); chat2.pop(); store.set("chat", chat2);
            document.getElementById("chatLog").innerHTML = chatHistoryHtml() +
                `<p style="color:var(--red)">⚠ ${escapeHtml(e.message)}</p>`;
        }
        input.disabled = false; input.focus();
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    if (initial) send(); else input.focus();
}
function clearChat() { store.set("chat", []); toast("Chat cleared"); closeDetail(); }

// ---------- Emoji (REA: emoji.json root command) ----------
const EMOJI = "😀 😂 🥲 😊 😍 🤔 😎 🥳 😴 🤝 👍 🙏 💪 🔥 ⭐ ✅ ❌ ⚠️ 💡 🎉 🎧 📎 🕐 📝 🔍 🧮 🗓️ 🎤 📋 🚀 🌙 ☀️ ❤️ 🧠 🪟 📁 🏷️".split(" ");

// ---------- Clipboard capture (documented behavior: intercept copies) ----------
document.addEventListener("copy", () => {
    try {
        const sel = String(window.getSelection() || "").trim();
        if (!sel || sel.length > 5000) return;
        const clips = store.get("clips", []);
        if (clips[0] === sel) return;
        clips.unshift(sel); store.set("clips", clips.slice(0, 50));
    } catch (_) {}
});

// ---------- Commands registry ----------
const APP_GRID = ["Safari", "Mail", "Notes", "Music", "Photos", "Calendar", "Maps", "Messages", "Terminal", "VS Code", "Figma", "Slack"];

const COMMANDS = [
    // REA taxonomy below: names follow the artifact-evidenced root commands
    {
        id: "ai", title: "AI Chat", subtitle: "Chat with your configured AI provider",
        icon: "🧠", color: "accent", keywords: "ai chat ask llm gpt perplexity assistant completion", sideEffect: true,
        match: (q) => /\b(ai|chat|ask|llm|gpt|perplexity)\b/i.test(q),
        run(q) { openChat(q); return null; },
    },
    {
        id: "calc", title: "Calculator", subtitle: "Math, unit conversion, time differences",
        icon: "🧮", color: "green", keywords: "math calculate arithmetic convert units soulver",
        match: (q) => {
            const pure = /^[-+*/().^%\d\s]+$/.test(q) && /\d/.test(q);
            const conv = /(-?\d+(?:\.\d+)?)\s*[a-z°]+\s*(?:in|to|as)\s*[a-z°]+/i.test(q);
            const currency = /\d\s*(usd|eur|gbp|jpy|cny|inr|aud|cad|chf|btc)/i.test(q);
            return pure || conv || currency;
        },
        run(q) {
            const t = q.trim();
            if (!t) return { show: true, html: `<p>Type math like <code>12 * (3 + 4)</code>, <code>10 km in mi</code>, or <code>72 f in c</code></p><h4 style="margin:.6rem 0 .3rem">History</h4>${calcHistoryHtml()}` };
            // Pure math first
            if (/^[-+*/().^%\d\s]+$/.test(t) && /\d/.test(t)) {
                const c = calcEval(t);
                if (c) return { show: true, html: `<div class="kv"><span>Expression</span><span>${escapeHtml(c.expr)}</span></div><div class="calc-result">${c.val}</div><p style="color:var(--text-dim);font-size:.8rem">Press ↵ to copy result</p>`, copy: String(c.val), recordCalc: c };
            }
            // Natural-language conversions & time differences (REA: Convert … behavior class)
            const conv = convertResult(t) || timeDiffResult(t);
            if (conv) return { show: true, html: conv.html };
            // Currency has no offline rates → delegate to web search (only when it looks like currency)
            if (/\d\s*(usd|eur|gbp|jpy|cny|inr|aud|cad|chf|btc)/i.test(t)) {
                const web = COMMANDS.find(x => x.id === "web");
                return { show: true, html: `<p>No offline rate for currency — ↵ searches <b>${escapeHtml(t)}</b> instead.</p>`, openUrl: web.run(t).openUrl };
            }
            return null;
        },
    },
    {
        id: "wm", title: "Window Management", subtitle: "Halves, quarters, sixths, thirds, center, maximize",
        icon: "🪟", color: "blue", keywords: "window snap tile half quarter sixth third center maximize layout screen left right top bottom",
        match: (q) => /\b(left|right|top|bottom|center|centre|middle|half|quarter|sixth|third|maximi[sz]e|almost)\b/i.test(q),
        run(q) {
            const names = Object.keys(WM_LAYOUTS);
            if (!q.trim()) return { show: true, html: `<p>Pick a layout:</p>` + names.slice(0, 8).map(n => `<div class="kv"><span>${n}</span><span>${Math.round(WM_LAYOUTS[n].w * 100)}×${Math.round(WM_LAYOUTS[n].h * 100)}%</span></div>`).join("") + `<p style="color:var(--text-dim);font-size:.8rem">…or type e.g. <code>left half</code>, <code>bottom right quarter</code></p>` };
            const hit = names.find(n => n.toLowerCase().includes(q.toLowerCase().trim())) || names.find(n => fuzzy(q, n));
            if (!hit) return { show: true, html: `<p>No layout matches <code>${escapeHtml(q)}</code>. Try <code>left half</code>, <code>quarter</code>, <code>center</code>.</p>` };
            return { show: true, html: wmPreviewHtml(hit), apply: hit };
        },
    },
    {
        id: "clipboard", title: "Clipboard History", subtitle: "Recently copied items (auto-captured)",
        icon: "📋", color: "blue", keywords: "paste copy history clip", sideEffect: true,
        run() { openClipboard(); return null; },
    },
    {
        id: "snippet", title: "Snippets", subtitle: "Expand keyword shortcuts — type a keyword",
        icon: "🏷️", color: "yellow", keywords: "snippet shortcut expand template macro signature",
        keywordsFn: () => store.get("snippets", []).map(s => s.keyword).join(" "),
        run(q) { return snippetResult(q); },
    },
    {
        id: "note", title: "New Note", subtitle: "Capture a thought instantly",
        icon: "📝", color: "yellow", keywords: "write memo capture jot floating", sideEffect: true,
        run(q) { openNote(q); return null; },
    },
    {
        id: "quicklinks", title: "Quicklinks", subtitle: "Saved URLs with keywords",
        icon: "🔗", color: "green", keywords: "bookmark link url shortcut website",
        match: (q) => {
            const t = q.trim().toLowerCase();
            if (!t || t.includes(" ")) return false;
            const links = store.get("quicklinks", [
                { keyword: "gh", title: "GitHub", url: "https://github.com" },
                { keyword: "yt", title: "YouTube", url: "https://youtube.com" },
                { keyword: "docs", title: "MDN Docs", url: "https://developer.mozilla.org" },
            ]);
            return links.some(l => l.keyword === t || l.title.toLowerCase().startsWith(t));
        },
        run(q) {
            const links = store.get("quicklinks", [
                { keyword: "gh", title: "GitHub", url: "https://github.com" },
                { keyword: "yt", title: "YouTube", url: "https://youtube.com" },
                { keyword: "docs", title: "MDN Docs", url: "https://developer.mozilla.org" },
            ]);
            const query = q.trim().toLowerCase();
            const hit = query && links.find(l => l.keyword === query || l.title.toLowerCase().includes(query));
            if (hit) return { show: true, openUrl: hit.url, html: `<p>Open <b>${escapeHtml(hit.title)}</b></p><p style="color:var(--text-dim);font-size:.8rem">${escapeHtml(hit.url)} — press ↵</p>` };
            return { show: true, html: links.map(l => `<div class="kv"><span><code>${escapeHtml(l.keyword)}</code> ${escapeHtml(l.title)}</span><span>${escapeHtml(l.url)}</span></div>`).join("") };
        },
    },
    {
        id: "date", title: "Date Math", subtitle: "e.g. “+3 days”, “in 2 weeks”, “10/25”",
        icon: "🗓️", color: "green", keywords: "date day week month calendar when countdown",
        match: (q) => /(\+\s*\d+\s*(day|week|month|hour|year)|in\s+\d+\s*(day|week|month|hour|year)|\d+\s*(day|week|month)\s*ago|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b)/i.test(q),
        run(q) { return dateResult(q); },
    },
    {
        id: "apps", title: "Search Apps", subtitle: "Launch an app (demo grid)",
        icon: "🚀", color: "accent", keywords: "open launch application program",
        run() { return { show: true, html: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem">${APP_GRID.map(a => `<div class="clip-item" style="text-align:center;margin:0">${a}</div>`).join("")}</div>` }; },
    },
    {
        id: "time", title: "Current Time", subtitle: "Date & time",
        icon: "🕐", color: "green", keywords: "clock date today time",
        run() {
            const now = new Date();
            return { show: true, html: `<div class="calc-result">${now.toLocaleTimeString()}</div><div class="kv"><span>Date</span><span>${now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span></div>` };
        },
    },
    {
        id: "timer", title: "Start a Timer", subtitle: "e.g. “5 minutes”, “30s”",
        icon: "⏲️", color: "yellow", keywords: "countdown alarm pomodoro", sideEffect: true,
        run(q) {
            const m = q.match(/(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hour|hours)/i);
            if (!m) return { show: true, html: `<p>Say or type a duration like <code>5 minutes</code></p>` };
            let ms = +m[1]; const u = m[2].toLowerCase();
            if (u.startsWith("h")) ms *= 3600000; else if (u.startsWith("m")) ms *= 60000; else ms *= 1000;
            startTimer(ms, `${m[1]} ${m[2]}`);
            return null;
        },
    },
    {
        id: "emoji", title: "Insert Emoji", subtitle: "Pick an emoji",
        icon: "😀", color: "yellow", keywords: "emoticon symbol reaction",
        run() { return { show: true, html: `<p style="font-size:1.9rem;letter-spacing:.35rem;line-height:1.6">${EMOJI.slice(0, 24).join(" ")}</p><p style="color:var(--text-dim);font-size:.8rem">Press ↵ to copy 🚀</p>`, copy: "🚀" }; },
    },
    {
        id: "speak", title: "Speak Text", subtitle: "Read text aloud (text-to-speech)",
        icon: "🔊", color: "blue", keywords: "say aloud speak tts voice read",
        run(q) {
            const t = q.trim();
            if (!t) return { show: true, html: `<p>Type text to speak aloud</p>` };
            return { show: true, html: `<p>Press ↵ to speak:</p><div class="calc-result" style="font-size:1.2rem">${escapeHtml(t)}</div>`, speak: t };
        },
    },
    {
        id: "count", title: "Word / Char Count", subtitle: "Count words and characters",
        icon: "🔤", color: "accent", keywords: "count words characters length text",
        run(q) {
            const t = q.trim();
            if (!t) return { show: true, html: `<p>Type text to count</p>` };
            const words = t.split(/\s+/).filter(Boolean).length;
            return { show: true, html: `<div class="kv"><span>Words</span><span>${words}</span></div><div class="kv"><span>Characters</span><span>${t.length}</span></div><div class="kv"><span>Letters (no spaces)</span><span>${t.replace(/\s/g, "").length}</span></div>` };
        },
    },
    {
        id: "web", title: "Search the Web", subtitle: "Open a search in a new tab",
        icon: "🔍", color: "blue", keywords: "google search internet lookup",
        run(q) {
            const term = q.trim();
            if (!term) return { show: true, html: `<p>Type something to search the web</p>` };
            const url = "https://www.google.com/search?q=" + encodeURIComponent(term);
            return { show: true, html: `<p>Search for <b>${escapeHtml(term)}</b></p><p style="color:var(--text-dim);font-size:.8rem">Press ↵ to open in a new tab</p>`, openUrl: url };
        },
    },
    {
        id: "settings", title: "Open Settings", subtitle: "AI provider, theme, accents",
        icon: "⚙️", color: "accent", keywords: "settings preferences config provider api key theme", sideEffect: true,
        run() { openSettings(); return null; },
    },
    {
        id: "theme", title: "Cycle Accent Color", subtitle: "Red · Orange · Yellow · Green · Blue · Purple · Pink · Magenta",
        icon: "🎨", color: "accent", keywords: "color theme accent palette", sideEffect: true,
        run() { cycleAccent(); return null; },
    },
    {
        id: "mode", title: "Toggle Appearance", subtitle: "Switch dark / light",
        icon: "🌓", color: "accent", keywords: "dark light appearance mode theme toggle", sideEffect: true,
        run() { toggleMode(); return null; },
    },
    {
        id: "voice", title: "Dictation", subtitle: "Hold Space and speak — Whisper transcribes locally",
        icon: "🎤", color: "accent", keywords: "talk speech dictate whisper voice dictation", sideEffect: true,
        run() { startVoice(); return null; },
    },
];

// ---------- Search / render ----------
function search(query) {
    const q = query.trim();
    let items = [];

    for (const cmd of COMMANDS) {
        const hay = cmd.title + " " + cmd.subtitle + " " + cmd.keywords +
            (cmd.keywordsFn ? " " + cmd.keywordsFn() : "");
        const m = fuzzy(q, hay);
        // Reachable if fuzzy-matched, always shown, or its own trigger matcher
        // accepts the query (e.g. "left half", "in 3 days", "gh", "brb").
        const reachable = !q || m || cmd.alwaysShow || (cmd.match && cmd.match(q));
        if (!reachable) continue;
        let detail = null;
        if (q && !cmd.sideEffect) detail = safeRun(cmd, q);
        items.push({ cmd, title: cmd.title, sub: cmd.subtitle, icon: cmd.icon, color: cmd.color, detail, arg: q });
    }

    if (q && !items.some(i => i.detail && i.detail.show)) {
        const web = COMMANDS.find(c => c.id === "web");
        items.push({ cmd: web, title: `Search web for “${q}”`, sub: "Google", icon: web.icon, color: web.color, detail: web.run(q), arg: q });
    }

    items.sort((a, b) => (b.detail && b.detail.show ? 1 : 0) - (a.detail && a.detail.show ? 1 : 0));
    return items.slice(0, 9);
}
function safeRun(cmd, q) {
    try { return cmd.run(q); } catch (e) { return { show: true, html: `<p>Error: ${escapeHtml(String(e.message || e))}</p>` }; }
}
function render(query) {
    currentResults = search(query);
    if (activeIndex >= currentResults.length) activeIndex = 0;
    resultsEl.innerHTML = "";
    if (!currentResults.length) { resultsEl.innerHTML = `<li class="empty">No results</li>`; return; }
    currentResults.forEach((item, i) => {
        const li = document.createElement("li");
        li.className = "row" + (i === activeIndex ? " active" : "");
        const hasDetail = item.detail && item.detail.show;
        li.innerHTML = `
            <div class="row-icon ${item.color}">${item.icon}</div>
            <div class="row-main">
                <div class="row-title">${escapeHtml(item.title)}</div>
                <div class="row-sub">${escapeHtml(item.sub || "")}</div>
            </div>
            ${hasDetail ? `<span class="row-tag">preview</span>` : ""}
            <span class="row-enter">↵</span>`;
        li.addEventListener("click", () => { activeIndex = i; execute(); });
        li.addEventListener("mousemove", () => { if (activeIndex !== i) { activeIndex = i; updateActive(); } });
        resultsEl.appendChild(li);
    });
}
function updateActive() {
    [...resultsEl.children].forEach((li, i) => li.classList.toggle("active", i === activeIndex));
    const el = resultsEl.children[activeIndex];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}

// ---------- Execute ----------
function execute() {
    const item = currentResults[activeIndex];
    if (!item) return;

    if (item.cmd.sideEffect) {
        try { item.cmd.run(item.arg || ""); } catch (e) { toast(String(e.message || e)); }
        return;
    }

    const d = item.detail;
    if (!d) { closeLauncher(); return; }

    if (d.recordCalc) {
        const h = store.get("calcHistory", []);
        h.unshift(d.recordCalc); store.set("calcHistory", h.slice(0, 20));
    }
    if (d.speak) speak(d.speak);
    if (d.openUrl) { window.open(d.openUrl, "_blank"); closeLauncher(); return; }
    if (d.copy) { navigator.clipboard?.writeText(d.copy); toast("Copied"); }
    if (d.apply) { applyWindowLayout(d.apply); return; }

    openDetail(item.title, d.html);
}

// ---------- Launcher open/close ----------
function openLauncher() {
    open = true;
    launcherWrap.classList.remove("hidden");
    searchInput.value = "";
    activeIndex = 0;
    render("");
    setTimeout(() => searchInput.focus(), 10);
}
function closeLauncher() {
    open = false;
    launcherWrap.classList.add("hidden");
    closeDetail();
    if (window.rayvox && window.rayvox.hide) window.rayvox.hide();
}

// ---------- Detail panel ----------
function openDetail(title, html) {
    detailTitle.textContent = title;
    detailBody.innerHTML = html;
    detailWrap.classList.remove("hidden");
    const ta = detailBody.querySelector("textarea[data-note]");
    if (ta) {
        const btn = document.createElement("button");
        btn.className = "btn"; btn.textContent = "Save note";
        btn.onclick = () => {
            const notes = store.get("notes", []);
            notes.unshift({ text: ta.value, at: Date.now() });
            store.set("notes", notes);
            toast("Note saved"); closeDetail();
        };
        detailBody.appendChild(btn);
        ta.focus();
    }
}
function closeDetail() { detailWrap.classList.add("hidden"); }
detailClose.addEventListener("click", closeDetail);
detailWrap.addEventListener("click", (e) => { if (e.target === detailWrap) closeDetail(); });

function openNote(q) {
    openDetail("New Note", `<textarea data-note placeholder="Type or hold Space to dictate…">${escapeHtml(q || "")}</textarea>`);
}
function openClipboard() {
    const clips = store.get("clips", []);
    const html = clips.length
        ? clips.map(c => `<div class="clip-item">${escapeHtml(c)}</div>`).join("")
        : `<p style="color:var(--text-dim)">Copy something and it'll appear here (auto-capture).</p>`;
    openDetail("Clipboard History", html);
    detailBody.querySelectorAll(".clip-item").forEach((el, i) => {
        el.onclick = () => { navigator.clipboard?.writeText(clips[i]); toast("Copied"); closeDetail(); };
    });
}

// ---------- Timer ----------
let timerId = null;
function startTimer(ms, label) {
    if (timerId) clearTimeout(timerId);
    toast(`⏱️ Timer set: ${label}`);
    timerId = setTimeout(() => toast(`⏰ Time's up: ${label}`), ms);
    closeLauncher();
}

// ---------- Theme actions ----------
function cycleAccent() {
    const t = store.get("theme", { mode: "dark", accent: 5 });
    t.accent = (t.accent + 1) % 8;
    store.set("theme", t); applyTheme();
    toast("Accent: " + ACCENTS[t.accent].name);
    closeLauncher();
}
function toggleMode() {
    const t = store.get("theme", { mode: "dark", accent: 5 });
    t.mode = t.mode === "dark" ? "light" : "dark";
    store.set("theme", t); applyTheme();
    toast(t.mode === "dark" ? "Dark appearance" : "Light appearance");
    closeLauncher();
}

// ---------- Toast ----------
let toastEl = null;
function toast(msg) {
    if (!toastEl) {
        toastEl = document.createElement("div");
        Object.assign(toastEl.style, {
            position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
            background: "rgba(28,28,34,0.92)", color: "#fff", padding: "10px 16px",
            borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)",
            fontSize: "14px", zIndex: 100, backdropFilter: "blur(10px)",
            opacity: "0", transition: "opacity .25s",
        });
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.opacity = "0"; }, 1800);
}

// ---------- Voice (Whisper dictation — REA: in-app dictation subsystem) ----------
let recorder = null;
let holdingSpace = false;

async function ensureModel() {
    if (isReady()) return;
    voiceModel.textContent = "loading model…";
    micBtn.classList.add("live");
    await loadModel("Xenova/whisper-tiny", (p) => {
        if (p.status === "progress") voiceModel.textContent = `loading ${Math.round(p.progress || 0)}%`;
    });
    voiceModel.textContent = "whisper-tiny · local";
    micBtn.classList.remove("live");
}
async function startVoice() {
    if (!open) openLauncher();
    try {
        await ensureModel();
        recorder = createRecorder();
        await recorder.start();
        voiceBar.classList.remove("hidden");
        micBtn.classList.add("live");
        voiceText.textContent = "Listening… speak now";
    } catch (e) {
        toast("🎤 Mic unavailable: " + (e.message || e));
        voiceBar.classList.add("hidden");
    }
}
async function stopVoice() {
    if (!recorder) return;
    const rec = recorder;
    recorder = null;
    voiceText.textContent = "Transcribing…";
    try {
        const audio = await rec.stop();
        if (audio.length < 16000 / 2) { voiceBar.classList.add("hidden"); toast("Too short — hold Space and speak"); return; }
        const out = await transcribe(audio, {});
        const text = (out && out.text ? out.text : "").trim();
        micBtn.classList.remove("live");
        if (!text) { voiceBar.classList.add("hidden"); toast("Didn’t catch that"); return; }
        searchInput.value = text;
        activeIndex = 0;
        render(text);
        voiceText.textContent = `“${text}”`;
        setTimeout(() => voiceBar.classList.add("hidden"), 1200);
        searchInput.focus();
    } catch (e) {
        micBtn.classList.remove("live");
        voiceBar.classList.add("hidden");
        toast("Transcription failed: " + (e.message || e));
    }
}
micBtn.addEventListener("click", () => { if (recorder) stopVoice(); else startVoice(); });

// ---------- Keyboard ----------
document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open ? closeLauncher() : openLauncher();
        return;
    }
    if (!open) {
        // Alt+Space global hotkey is handled by the desktop build; in-browser ⌘K remains.
        return;
    }
    if (e.key === "Escape") {
        if (!detailWrap.classList.contains("hidden")) { closeDetail(); return; }
        closeLauncher();
        return;
    }
    if (e.code === "Space" && !e.repeat && document.activeElement === searchInput && searchInput.value === "" && !recorder) {
        e.preventDefault();
        holdingSpace = true;
        startVoice();
        return;
    }
    if (document.activeElement && document.activeElement.classList.contains("ai-input")) return; // let form fields type
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, currentResults.length - 1); updateActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); updateActive(); }
    else if (e.key === "Enter") { e.preventDefault(); execute(); }
});
document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && holdingSpace) { holdingSpace = false; stopVoice(); }
});
searchInput.addEventListener("input", () => { activeIndex = 0; render(searchInput.value); });
document.getElementById("desktop").addEventListener("click", openLauncher);

// ---------- Deep links (REA: raycast:// scheme → our rayvox://) ----------
// Web: rayvox://command?q=query in hash. Desktop: passed via IPC.
function handleDeepLink(url) {
    const m = String(url).match(/rayvox:\/\/([a-z]+)(?:\?q=(.*))?$/i);
    if (!m) return;
    const [, cmdId, q] = m;
    openLauncher();
    const cmd = COMMANDS.find(c => c.id === cmdId);
    if (!cmd) { toast("Unknown command: " + cmdId); return; }
    searchInput.value = q ? decodeURIComponent(q) : "";
    activeIndex = Math.max(0, currentResults.findIndex(i => i.cmd.id === cmdId));
    render(searchInput.value);
    setTimeout(execute, 150);
}
if (window.rayvox && window.rayvox.onDeepLink) window.rayvox.onDeepLink(handleDeepLink);

// ---------- Boot ----------
applyTheme();
render("");
if (window.rayvox && window.rayvox.isDesktop) {
    window.rayvox.onToggle(() => { open ? closeLauncher() : openLauncher(); });
}
// In-browser deep link: #rayvox://…
if (location.hash.startsWith("#rayvox://")) handleDeepLink(location.hash.slice(1));
