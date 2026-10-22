// Preload: expose a minimal, safe bridge to the Rayvox renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rayvox", {
    isDesktop: true,
    onToggle: (cb) => ipcRenderer.on("rayvox:toggle", () => cb()),
    onDeepLink: (cb) => ipcRenderer.on("rayvox:deeplink", (_e, url) => cb(url)),
    hide: () => ipcRenderer.send("rayvox:hide"),
    moveWindow: (f) => ipcRenderer.send("rayvox:move-window", f),
});
