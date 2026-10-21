// app.js — Rayvox launcher engine
// Combines Raycast-style command launcher UX with Whisper voice input.

import { loadModel, createRecorder, transcribe, isReady, speak } from "./voice.js";

// ---------- DOM ----------
const launcherWrap = document.getElementById("launcherWrap");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("results");
const modeIcon = document.getElementById("modeIcon");
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
let modelLoading = false;

// ---------- Storage helpers ----------
const store = {
    get(k, fallback) {
        try { const v = localStorage.getItem("rayvox:" + k); return v ? JSON.parse(v) : fallback; }
        catch (_) { return fallback; }
    },
    set(k, v) { localStorage.setItem("rayvox:" + k, JSON.stringify(v)); },
};

// ---------- Fuzzy match (subsequence + score) ----------
function fuzzy(query, text) {
    query = query.toLowerCase();
    text = text.toLowerCase();
    if (!query) return { score: 0, matches: [] };
    if (text.includes(query)) return { score: 100 - text.indexOf(query), matches: range(text.indexOf(query), query.length) };
    let ti = 0, score = 0, matches = [], streak = 0;
    for (const ch of query) {
        const found = text.indexOf(ch, ti);
        if (found === -1) return null;
        if (found === ti) { streak++; score += 3 + streak; } else { streak = 0; score += 1; }
        matches.push(found);
        ti = found + 1;
    }
    return { score, matches };
}
function range(start, len) { const a = []; for (let i = 0; i < len; i++) a.push(start + i); return a; }
function highlight(text, matches) {
    if (!matches || !matches.length) return escapeHtml(text);
    const set = new Set(matches);
    let out = "", bold = false;
    for (let i = 0; i < text.length; i++) {
        const m = set.has(i);
        if (m && !bold) { out += "<b>"; bold = true; }
        if (!m && bold) { out += "</b>"; bold = false; }
        out += escapeHtml(text[i]);
    }
    if (bold) out += "</b>";
    return out;
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------- Commands registry ----------
// Each command: { id, title, subtitle, icon, color, keywords, run(q) }
const emoji = "😀 🎉 ✅ ❌ 🔥 ⭐ 💡 🎧 📎 🕐 📝 🔍 🧮 🗓️ 🎤 📋 🚀 🌙 ☀️ ❤️ 🙏 💪 🤔 📌".split(" ");

const COMMANDS = [
    {
        id: "calc", title: "Calculator", subtitle: "Evaluate math — type an expression",
        icon: "🧮", color: "green", keywords: "math calculate arithmetic",
        alwaysShow: true,
        run(q) {
            const expr = q.replace(/[^0-9+\-*/().%^ ]/g, "").trim();
            if (!expr) return { show: true, html: `<p>Type math like <code>12 * (3 + 4)</code></p>` };
            try {
                const safe = expr.replace(/\^/g, "**");
                // eslint-disable-next-line no-new-func
                const val = Function('"use strict";return (' + safe + ")")();
                if (typeof val !== "number" || !isFinite(val)) throw 0;
                return { show: true, html: `<div class="kv"><span>Expression</span><span>${escapeHtml(expr)}</span></div><div class="calc-result">${val}</div><p style="color:var(--text-dim);font-size:.8rem">Press ↵ to copy result</p>`, copy: String(val) };
            } catch (_) { return { show: true, html: `<p>Could not evaluate <code>${escapeHtml(expr)}</code></p>` }; }
        },
    },
    {
        id: "voice", title: "Voice Input", subtitle: "Hold Space and speak — Whisper transcribes locally",
        icon: "🎤", color: "accent", keywords: "talk speech dictate whisper voice", sideEffect: true,
        run() { startVoice(); return null; },
    },
    {
        id: "note", title: "New Note", subtitle: "Capture a thought instantly",
        icon: "📝", color: "yellow", keywords: "write memo capture jot", sideEffect: true,
        run(q) { openNote(q); return null; },
    },
    {
        id: "clipboard", title: "Clipboard History", subtitle: "Recently copied items",
        icon: "📋", color: "blue", keywords: "paste copy history clip", sideEffect: true,
        run() { openClipboard(); return null; },
    },
    {
        id: "apps", title: "Search Apps", subtitle: "Launch an app (demo grid)",
        icon: "🚀", color: "accent", keywords: "open launch application program",
        run() { return appsResult(); },
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
        id: "timer", title: "Start a Timer", subtitle: "e.g. “5 minutes”, “30s”",
        icon: "⏲️", color: "yellow", keywords: "countdown alarm pomodoro", sideEffect: true,
        run(q) {
            const m = q.match(/(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hour|hours)/i);
            if (!m) return { show: true, html: `<p>Say or type a duration like <code>5 minutes</code></p>` };
            let ms = parseInt(m[1], 10);
            const u = m[2].toLowerCase();
            if (u.startsWith("h")) ms *= 3600000; else if (u.startsWith("m")) ms *= 60000; else ms *= 1000;
            startTimer(ms, `${m[1]} ${m[2]}`);
            return null;
        },
    },
    {
        id: "theme", title: "Toggle Glow", subtitle: "Cycle the accent color",
        icon: "🌙", color: "accent", keywords: "color theme accent dark", sideEffect: true,
        run() { cycleAccent(); return null; },
    },
    {
        id: "tts", title: "Speak Text", subtitle: "Read text aloud (text-to-speech)",
        icon: "🔊", color: "blue", keywords: "say aloud speak tts voice read",
        run(q) {
            const t = q.trim();
            if (!t) return { show: true, html: `<p>Type text to speak aloud</p>` };
            return { show: true, html: `<p>Press ↵ to speak:</p><div class="calc-result" style="font-size:1.2rem">${escapeHtml(t)}</div>`, speak: t };
        },
    },
    {
        id: "snippet", title: "Snippets", subtitle: "Expand keyword shortcuts — type a keyword",
        icon: "⚡", color: "yellow", keywords: "snippet shortcut expand template macro",
        run(q) { return snippetResult(q); },
    },
    {
        id: "date", title: "Date Math", subtitle: "e.g. “+3 days”, “in 2 weeks”, “10/25”",
        icon: "🗓️", color: "green", keywords: "date day week month calendar when countdown",
        run(q) { return dateResult(q); },
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
        id: "emoji", title: "Insert Emoji", subtitle: "Pick an emoji",
        icon: "😀", color: "yellow", keywords: "emoticon symbol reaction",
        run(q) {
            const list = emoji.filter(e => !q || true).slice(0, 12);
            return { show: true, html: `<p style="font-size:2rem;letter-spacing:.4rem">${list.join(" ")}</p><p style="color:var(--text-dim);font-size:.8rem">Press ↵ to copy 🚀</p>`, copy: "🚀" };
        },
    },
];

const APP_GRID = ["Safari", "Mail", "Notes", "Music", "Photos", "Calendar", "Maps", "Messages", "Terminal", "VS Code", "Figma", "Slack"];
function appsResult() {
    return { show: true, html: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem">${APP_GRID.map(a => `<div class="clip-item" style="text-align:center;margin:0">${a}</div>`).join("")}</div>` };
}

// ---------- Snippets (asyar-style keyword → expansion) ----------
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
    if (!query) {
        return { show: true, html: snippets.length
            ? snippets.map(s => `<div class="kv"><span><code>${escapeHtml(s.keyword)}</code></span><span>${escapeHtml(s.expansion)}</span></div>`).join("")
            : `<p>No snippets yet.</p>` };
    }
    // Exact keyword match → expand + copy (copy happens on Enter via execute())
    const exact = snippets.find(s => s.keyword.toLowerCase() === query.toLowerCase());
    if (exact) {
        return { show: true, copy: exact.expansion, html: `<div class="kv"><span>Keyword</span><span><code>${escapeHtml(exact.keyword)}</code></span></div><div class="calc-result" style="font-size:1rem">${escapeHtml(exact.expansion)}</div><p style="color:var(--text-dim);font-size:.8rem">Press ↵ to copy expansion</p>` };
    }
    // Otherwise show matching snippets
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
    let target = null;

    // “+N unit” or “in N unit”
    let m = query.match(/(?:\+|in)\s*(\d+)\s*(day|days|week|weeks|month|months|hour|hours|year|years)/);
    if (m) {
        const n = parseInt(m[1], 10); const u = m[2];
        target = new Date(now);
        if (u.startsWith("day")) target.setDate(target.getDate() + n);
        else if (u.startsWith("week")) target.setDate(target.getDate() + n * 7);
        else if (u.startsWith("month")) target.setMonth(target.getMonth() + n);
        else if (u.startsWith("hour")) target.setHours(target.getHours() + n);
        else if (u.startsWith("year")) target.setFullYear(target.getFullYear() + n);
    }
    // “N days ago”
    if (!target && (m = query.match(/(\d+)\s*(day|week|month)\s*ago/))) {
        const n = parseInt(m[1], 10); const u = m[2];
        target = new Date(now);
        if (u.startsWith("day")) target.setDate(target.getDate() - n);
        else if (u.startsWith("week")) target.setDate(target.getDate() - n * 7);
        else target.setMonth(target.getMonth() - n);
    }
    // MM/DD or MM/DD/YYYY
    if (!target && (m = query.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
        let yr = m[3] ? parseInt(m[3], 10) : now.getFullYear();
        if (yr < 100) yr += 2000;
        target = new Date(yr, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }
    if (!target) return { show: true, html: `<p>Couldn't parse. Try <code>+3 days</code>, <code>in 2 weeks</code>, or <code>10/25</code>.</p>` };

    const days = Math.round((target - now) / 86400000);
    const rel = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : `in ${Math.abs(days)} days`;
    return { show: true, html: `<div class="calc-result">${target.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div><div class="kv"><span>Relative</span><span>${rel}</span></div><div class="kv"><span>Time</span><span>${target.toLocaleTimeString()}</span></div>` };
}

// ---------- Search / render ----------
function search(query) {
    const q = query.trim();
    let items = [];

    // Exact-ish calculator: pure math expression
    if (q && /^[-+*/().^%\d\s]+$/.test(q) && /\d/.test(q)) {
        const calc = COMMANDS.find(c => c.id === "calc");
        const r = calc.run(q);
        items.push({ cmd: calc, title: "Calculator", sub: q, icon: calc.icon, color: calc.color, detail: r });
    }

    for (const cmd of COMMANDS) {
        if (cmd.id === "calc") continue;
        const hay = cmd.title + " " + cmd.subtitle + " " + cmd.keywords;
        const m = fuzzy(q, hay);
        if (q && !m && !cmd.alwaysShow) continue;
        // Previewable commands compute a detail while searching; side-effect commands
        // (voice, note, clipboard, timer, theme) wait until Enter is pressed.
        let detail = null;
        if (q && !cmd.sideEffect) detail = cmd.run ? safeRun(cmd, q) : null;
        items.push({
            cmd, title: cmd.title, sub: q ? `${cmd.subtitle}` : cmd.subtitle,
            icon: cmd.icon, color: cmd.color, detail, arg: q,
        });
    }

    // Web search fallback when query is free text
    if (q && !items.some(i => i.detail && i.detail.show)) {
        const web = COMMANDS.find(c => c.id === "web");
        items.push({ cmd: web, title: `Search web for “${q}”`, sub: "Google", icon: web.icon, color: web.color, detail: web.run(q), arg: q });
    }

    items.sort((a, b) => (b.detail && b.detail.show ? 1 : 0) - (a.detail && a.detail.show ? 1 : 0));
    return items.slice(0, 9);
}

// Run a command safely; side-effect-only commands return null.
function safeRun(cmd, q) {
    try { return cmd.run(q); } catch (e) { return { show: true, html: `<p>Error: ${escapeHtml(String(e.message || e))}</p>` }; }
}

function render(query) {
    currentResults = search(query);
    if (activeIndex >= currentResults.length) activeIndex = 0;
    resultsEl.innerHTML = "";
    if (!currentResults.length) {
        resultsEl.innerHTML = `<li class="empty">No results</li>`;
        return;
    }
    currentResults.forEach((item, i) => {
        const li = document.createElement("li");
        li.className = "row" + (i === activeIndex ? " active" : "");
        const hasDetail = item.detail && item.detail.show;
        li.innerHTML = `
            <div class="row-icon ${item.color}">${item.icon}</div>
            <div class="row-main">
                <div class="row-title">${highlight(item.title, [])}</div>
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

    // Side-effect commands (voice, note, clipboard, timer, theme) run only on Enter.
    if (item.cmd.sideEffect) {
        try { item.cmd.run(item.arg || ""); } catch (e) { toast(String(e.message || e)); }
        return;
    }

    const d = item.detail;
    if (!d) { closeLauncher(); return; }

    if (d.speak) speak(d.speak);            // SuperCmd-style text-to-speech
    if (d.openUrl) { window.open(d.openUrl, "_blank"); closeLauncher(); return; }
    if (d.copy) { navigator.clipboard?.writeText(d.copy); toast("Copied"); }

    // Show detail panel for previewable results
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
}

// ---------- Detail panel ----------
function openDetail(title, html) {
    detailTitle.textContent = title;
    detailBody.innerHTML = html;
    detailWrap.classList.remove("hidden");
    // Wire up textarea save if present
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
        : `<p style="color:var(--text-dim)">No clipboard history yet. Copy something and it’ll appear here.</p>`;
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
    timerId = setTimeout(() => { toast(`⏰ Time's up: ${label}`); }, ms);
    closeLauncher();
}

// ---------- Accent cycling ----------
const ACCENTS = ["#7c6cf0", "#5aa9ff", "#4caf82", "#e0b341", "#e05252", "#d46cf0"];
let accentIdx = 0;
function cycleAccent() {
    accentIdx = (accentIdx + 1) % ACCENTS.length;
    document.documentElement.style.setProperty("--accent", ACCENTS[accentIdx]);
    toast("Accent updated");
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
        });
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.opacity = "0"; toastEl.style.transition = "opacity .3s"; }, 1800);
}

// ---------- Voice (Whisper) ----------
let recorder = null;
let holdingSpace = false;

async function ensureModel() {
    if (isReady()) return;
    const modelId = "Xenova/whisper-tiny";
    modelLoading = true;
    voiceModel.textContent = "loading model…";
    micBtn.classList.add("live");
    await loadModel(modelId, (p) => {
        if (p.status === "progress") voiceModel.textContent = `loading ${Math.round(p.progress || 0)}%`;
    });
    modelLoading = false;
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
        // Put transcript into the search bar and run it as a command/argument.
        searchInput.value = text;
        activeIndex = 0;
        render(text);
        voiceText.textContent = `“${text}”`;
        setTimeout(() => { voiceBar.classList.add("hidden"); }, 1200);
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

    // ⌘K / Ctrl+K toggles launcher
    if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open ? closeLauncher() : openLauncher();
        return;
    }

    if (!open) return;

    if (e.key === "Escape") {
        if (!detailWrap.classList.contains("hidden")) { closeDetail(); return; }
        closeLauncher();
        return;
    }

    // Hold Space to talk (when input is empty so Space doesn't type)
    if (e.code === "Space" && !e.repeat && document.activeElement === searchInput && searchInput.value === "" && !recorder) {
        e.preventDefault();
        holdingSpace = true;
        startVoice();
        return;
    }

    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, currentResults.length - 1); updateActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); updateActive(); }
    else if (e.key === "Enter") { e.preventDefault(); execute(); }
});

document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && holdingSpace) {
        holdingSpace = false;
        stopVoice();
    }
});

searchInput.addEventListener("input", () => { activeIndex = 0; render(searchInput.value); });

// Open on click of desktop
document.getElementById("desktop").addEventListener("click", openLauncher);

// ---------- Boot ----------
render("");

// Desktop (Electron) integration: global hotkey toggles the launcher.
if (window.rayvox && window.rayvox.isDesktop) {
    window.rayvox.onToggle(() => { openLauncher(); });
}
