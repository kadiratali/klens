'use strict';

// Minimal, safe bridge: the renderer (React app) can subscribe to native-menu
// actions. In the browser build `window.klens` is undefined, so the app's
// listener is a no-op there.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('klens', {
  onMenuAction: (cb) => {
    const handler = (_event, action) => cb(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },
});
