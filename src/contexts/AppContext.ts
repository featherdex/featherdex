"use strict";

import React from 'react';

import { defaultSettings } from '../defaults';
import { AppState, AppMethods } from '../app';

const AppContext =
	React.createContext<AppState & AppMethods>({
		layoutRef: null,
		layout: null,
		tickers: new Map<number, Ticker>(),
		assetList: [],
		getClient: null,
		getConstants: null,
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
	});
export default AppContext;