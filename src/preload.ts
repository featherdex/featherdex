import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld("api", {
	quit: () => ipcRenderer.send("app_quit")
});