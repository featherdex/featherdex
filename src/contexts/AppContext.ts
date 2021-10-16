"use strict";

import React from 'react';

import { defaultSettings } from '../defaults';
import { AppState } from '../app';

const AppContext =
	React.createContext<AppState>({
		layoutRef: null,
		layout: null,
		settings: defaultSettings,
		assetList: [],
		client: null,
		sOpen: false,
		aOpen: false,
		pendingOrders: [],
	});
export default AppContext;