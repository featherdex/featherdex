"use strict";

import React from 'react';

import { defaultSettings } from '../defaults';
import { AppState, AppMethods } from '../app';

const AppContext =
	React.createContext<AppState & AppMethods>({
		layoutRef: null,
		layout: null,
		consts: null,
		tickers: new Map<number, Ticker>(),
		assetList: [],
		getClient: null,
		settings: defaultSettings,
		setSettings: null,
		saveSettings: null,
		dOpen: false,
		sOpen: false,
		aOpen: false,
		pendingDownloads: [],
		addPendingDownload: null,
		clearPendingDownloads: null,
		getPendingOrders: null,
		addPendingOrder: null,
		clearStaleOrders: null,
		getBlockTimes: null,
		addBlockTime: null,
		refreshTrades: null,
		refreshAssets: null,
	});
export default AppContext;