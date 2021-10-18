"use strict";

import React from 'react';

import { defaultSettings } from '../defaults';
import { AppState } from '../app';

const AppContext =
	React.createContext<AppState>({
		layoutRef: null,
		layout: null,
		settings: defaultSettings,
		setSettings: null,
		saveSettings: null,
		assetList: [],
		client: null,
		sOpen: false,
		aOpen: false,
		addPendingOrder: null,
		clearStaleOrders: null,
		pendingOrders: [],
		blockTimes: null,
		addBlockTime: null,
	});
export default AppContext;