import fs from 'fs';
import getAppDataPath from 'appdata-path';

import {
	ipcMain, app, BrowserWindow, Menu, MenuItemConstructorOptions, dialog, shell,
	clipboard, globalShortcut, OpenDialogOptions
} from 'electron';

import { createWindow } from './util';
import { APP_NAME } from './constants';

if (require('electron-squirrel-startup')) app.quit();

const rootPath = getAppDataPath(APP_NAME);
if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true });

const isMac = process.platform === "darwin";

app.whenReady().then(() => {
	let win = createWindow("build/index.html");
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0)
			win = createWindow("build/index.html");
	});

	const isMac = process.platform === "darwin";

	const template = [ // { role: 'appMenu' }
		...(isMac ?
			[{
				label: app.name,
				submenu: [{ role: 'about' },
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }]
			} as MenuItemConstructorOptions] : []),
		{ // { role: 'fileMenu' }
			label: '&File',
			submenu: [{
				label: 'Downloads...',
				click: () => win.webContents.send("open:downloads"),
			},
			{
				label: 'Settings...',
				click: () => win.webContents.send("open:settings"),
			},
			isMac ? { role: 'close' } : { role: 'quit' }]
		} as MenuItemConstructorOptions,
		{
			label: 'Edit',
			submenu: [{ role: 'undo' },
			{ role: 'redo' },
			{ type: 'separator' },
			{ role: 'cut' },
			{ role: 'copy' },
			{ role: 'paste' },
			...(isMac ? [{ role: 'pasteAndMatchStyle' },
			{ role: 'delete' },
			{ role: 'selectAll' },
			{ type: 'separator' },
			{
				label: 'Speech',
				submenu: [{ role: 'startSpeaking' },
				{ role: 'stopSpeaking' }]
			}] : [{ role: 'delete' },
			{ type: 'separator' },
			{ role: 'selectAll' }])]
		} as MenuItemConstructorOptions,
		{ // { role: 'viewMenu' }
			label: '&View',
			submenu: [{
				label: 'Add Panel...',
				submenu: [{
					label: "Chart",
					click: () => win.webContents.send("add:tab",
						{ title: "Chart", component: "chart" }),
				},
				{
					label: "Assets",
					click: () => win.webContents.send("add:tab",
						{ title: "Assets", component: "assets" }),
				},
				{
					label: "Trade",
					click: () => win.webContents.send("add:tab",
						{ title: "Trade", component: "trade" }),
				},
				{
					label: "Orders",
					click: () => win.webContents.send("add:tab",
						{ title: "Orders", component: "orders" }),
				},
				{
					label: "History",
					click: () => win.webContents.send("add:tab",
						{ title: "History", component: "history" }),
				},
				{
					label: "Info",
					click: () => win.webContents.send("add:tab",
						{ title: "Info", component: "info" }),
				},
				{
					label: "Terminal",
					click: () => win.webContents.send("add:tab",
						{ title: "Terminal", component: "terminal" }),
				},
				{
					label: "Ticker",
					click: () => win.webContents.send("add:tab",
						{ title: "Ticker", component: "ticker" }),
				},
				{
					label: "Top Markets",
					click: () => win.webContents.send("add:tab",
						{ title: "Top Markets", component: "markets" }),
				},
				{
					label: "Time and Sales",
					click: () => win.webContents.send("add:tab",
						{ title: "Time & Sales", component: "sales" }),
				},
				{
					label: "Send Assets",
					click: () => win.webContents.send("add:tab",
						{ title: "Send Assets", component: "send" }),
				}]
			},
			{ role: 'reload' },
			{ role: 'toggleDevTools' },
			{ type: 'separator' },
			{ role: 'resetZoom' },
			{ role: 'zoomIn' },
			{ role: 'zoomOut' },
			{ type: 'separator' },
			{ role: 'togglefullscreen' }]
		} as MenuItemConstructorOptions,
		{ // { role: 'windowMenu' }
			label: '&Window',
			submenu: [{ role: 'minimize' },
			{ role: 'zoom' },
			...(isMac ?
				[{ type: 'separator' },
				{ role: 'front' },
				{ type: 'separator' },
				{ role: 'window' }]
				: [{ role: 'close' }])]
		} as MenuItemConstructorOptions,
		{
			role: 'help',
			submenu: [{
				label: 'About...',
				click: () => win.webContents.send("open:about"),
			}]
		} as MenuItemConstructorOptions
	];

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);

	const reload = () => {
		app.relaunch();
		win.reload();
	};

	ipcMain.on("register", () =>
		globalShortcut.register("CommandOrControl+R", reload));
	ipcMain.on("unregister", () => globalShortcut.unregister("CommandOrControl+R"));

	ipcMain.on("choose",
		(_, data: { rcvChannel: string, opts: OpenDialogOptions }) =>
			dialog.showOpenDialog(data.opts).then(v =>
				win.webContents.send(data.rcvChannel, v)));

	ipcMain.on("quitmsg", () =>
		dialog.showMessageBox(win, {
			message: "Shutting down...", type: "none", buttons: []
		}));

	ipcMain.on("init", () => {
		if (app.commandLine.hasSwitch("debug"))
			win.webContents.send("flag:loglevel", "debug");
	});
});

ipcMain.on("clipboard:copy", (_, text) => clipboard.writeText(text));

ipcMain.on("shell:opencont", (_, pathfile) => shell.showItemInFolder(pathfile));
ipcMain.on("shell:openlink", (_, url) => shell.openExternal(url));

ipcMain.on("app_quit", () => {
	if (!isMac) app.quit();
});

app.on("window-all-closed", () => {
	if (!isMac) app.quit();
});