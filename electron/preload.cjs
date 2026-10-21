// Preload: expose a minimal, safe bridge to the Rayvox renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rayvox", {
    isDesktop: true,
    onToggle: (cb) => ipcRenderer.on("rayvox:toggle", () => cb()),
    hide: () => ipcRenderer.send("rayvox:hide"),
});
