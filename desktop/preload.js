'use strict';

// Minimal, safe bridge between the renderer (React app) and the Electron main
// process. In the browser build `window.klens` is undefined, so every consumer
// guards with `window.klens?.…` and degrades to a no-op there.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('klens', {
  // Lets the renderer light up desktop-only features (writing locators to a
  // file). Absent/undefined in the browser build.
  isDesktop: true,

  // Native-menu actions (toggle inspect/live) streamed from main.
  onMenuAction: (cb) => {
    const handler = (_event, action) => cb(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },

  // Locator export: pick a target file, append a formatted line, and read/write
  // the small prefs blob (constant template + recent files).
  chooseTargetFile: () => ipcRenderer.invoke('klens:choose-file'),
  appendToFile: (filePath, line) => ipcRenderer.invoke('klens:append', { filePath, line }),
  getPrefs: () => ipcRenderer.invoke('klens:get-prefs'),
  setPrefs: (prefs) => ipcRenderer.invoke('klens:set-prefs', prefs),
});
