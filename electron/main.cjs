// Electron main process for Rayvox desktop (PC) app.
const { app, BrowserWindow, session, globalShortcut, ipcMain } = require("electron");
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
        backgroundColor: "#0a0a0f",
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

app.whenReady().then(() => {
    createWindow();

    // Global hotkey: Cmd/Ctrl+K shows/hides the launcher from anywhere.
    globalShortcut.register("CommandOrControl+K", () => {
        if (!win) return;
        if (win.isVisible()) {
            win.hide();
        } else {
            win.show();
            win.focus();
            win.webContents.send("rayvox:toggle");
        }
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

ipcMain.on("rayvox:hide", () => win && win.hide());
