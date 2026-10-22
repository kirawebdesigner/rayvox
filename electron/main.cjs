// Electron main process for Rayvox desktop (PC) app — Rayvox 2.
// REA-informed desktop surface: Alt+Space global hotkey (Windows Raycast parity),
// rayvox:// deep-link scheme (analogue of observed raycast://), window management IPC.
const { app, BrowserWindow, session, globalShortcut, ipcMain, screen, shell } = require("electron");
const path = require("path");

let win = null;
const isDev = process.argv.includes("--dev");

function createWindow() {
    win = new BrowserWindow({
        width: 900,
        height: 640,
        minWidth: 520,
        minHeight: 420,
        title: "Rayvox",
        backgroundColor: "#1e1e1e", // REA-observed Raycast dark bg
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 16, y: 16 },
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Mic access for Whisper dictation: grant media permission automatically.
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === "media" || permission === "audioCapture") return callback(true);
        callback(false);
    });

    win.loadFile(path.join(__dirname, "..", "index.html"));
    if (isDev) win.webContents.openDevTools({ mode: "detach" });
}

// ---- Deep links: rayvox://<command>?q=<query> (REA: raycast:// scheme analogue) ----
function handleDeepLink(url) {
    if (!win) return;
    if (win.isVisible()) win.focus();
    else { win.show(); win.focus(); }
    win.webContents.send("rayvox:deeplink", url);
}
if (app.setAsDefaultProtocolClient) app.setAsDefaultProtocolClient("rayvox");
app.on("second-instance", (_e, argv) => {
    const link = argv.find(a => a.startsWith("rayvox://"));
    if (link) handleDeepLink(link);
    else if (win) { win.show(); win.focus(); }
});
app.on("open-url", (_e, url) => { if (url && url.startsWith("rayvox://")) handleDeepLink(url); });

// ---- Window management (REA: WM layout families applied to this window) ----
ipcMain.on("rayvox:move-window", (_e, f) => {
    if (!win || !f) return;
    const display = screen.getDisplayMatching(win.getBounds());
    const area = display.workArea;
    const x = Math.round(area.x + area.width * f.x);
    const y = Math.round(area.y + area.height * f.y);
    const w = Math.round(area.width * f.w);
    const h = Math.round(area.height * f.h);
    win.setBounds({ x, y, width: w, height: h });
});

app.whenReady().then(() => {
    createWindow();

    // Global hotkeys: Alt+Space primary (Windows Raycast default), ⌘K/Ctrl+K secondary.
    globalShortcut.register("Alt+Space", () => {
        if (!win) return;
        if (win.isVisible()) { win.hide(); return; }
        win.show(); win.focus();
        win.webContents.send("rayvox:toggle");
    });
    globalShortcut.register("CommandOrControl+K", () => {
        if (!win) return;
        if (win.isVisible()) { win.hide(); return; }
        win.show(); win.focus();
        win.webContents.send("rayvox:toggle");
    });

    // Second-instance launch may carry the deep link (protocol activation).
    const link = process.argv.find(a => a.startsWith("rayvox://"));
    if (link) setTimeout(() => handleDeepLink(link), 600);

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

ipcMain.on("rayvox:hide", () => win && win.hide());
