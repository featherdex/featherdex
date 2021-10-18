import {
	ipcMain, app, BrowserWindow, Menu, MenuItemConstructorOptions
} from 'electron';

import { createWindow } from './util';

if (require('electron-squirrel-startup')) app.quit();

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
				}]
			},
			{ role: 'reload' },
			{ role: 'forceReload' },
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
});

ipcMain.on("app_quit", () => {
	if (!isMac) app.quit();
});

app.on("window-all-closed", () => {
	if (!isMac) app.quit();
});