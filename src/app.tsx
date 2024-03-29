"use strict";

import React from 'react';
import Modal from 'react-modal';
import ReactDOM from 'react-dom';
import Terminal from 'terminal-in-react';
import Client from 'bitcoin-core';
import ReactNotification from 'react-notifications-component';
import createRBTree from 'functional-red-black-tree';
import N from 'decimal.js';
import path from 'path';
import getAppDataPath from 'appdata-path';

import { ipcRenderer } from 'electron';
import { DateTime, Duration } from 'luxon';
import { Tree } from 'functional-red-black-tree';
import { Layout, Model, TabNode } from 'flexlayout-react';
import { Mutex } from 'async-mutex';

import api from './api';
import TradesDB from './tradesdb';
import Order from './order';
import Assets from './components/Assets';
import Downloads from './components/Download';
import About from './components/About';
import Settings from './components/Settings';
import Chart from './components/Chart';
import Trade from './components/Trade';
import History from './components/History';
import Orders from './components/Orders';
import Info from './components/Info';
import Ticker from './components/Ticker';
import Markets from './components/Markets';
import Sales from './components/Sales';
import AssetTransfer from './components/AssetTransfer';
import AssetManage from './components/AssetManage';
import AppContext from './contexts/AppContext';

import { TimeCache } from './timecache';
import {
	APP_NAME, PROPID_BITCOIN, PROPID_COIN, API_RETRIES, API_RETRIES_LARGE
} from './constants';
import {
	repeatAsync, readLayout, readSettings, writeSettings, readRPCConf, writeLayout,
	isNumber, isBoolean, parseBoolean, handlePromise, toCandle, tickersEqual,
	propsEqual, isBarData, tradeToLineData, constants, handleError, setLogLevel, log,
	dsum, sendAlert
} from './util';
import { Queue } from './queue';

import 'react-contexify/dist/ReactContexify.css';
import 'react-notifications-component/dist/theme.css'
import 'flexlayout-react/style/dark.css';
import './app.css';

type AppProps = {
	model: Model,
	initSettings: Settings,
	initRPCSettings: RPCSettings,
};

export type AppState = {
	layoutRef: React.RefObject<Layout>,
	layout: Model,
	consts: PlatformConstants,
	settings: Settings,
	tickers: Map<number, Ticker>,
	assetList: PropertyList,
	pendingDownloads: DownloadOpts[],
	dOpen: boolean,
	sOpen: boolean,
	aOpen: boolean,
};

export type AppMethods = {
	getClient: () => typeof Client,
	setSettings: (s: Record<string, any>) => void,
	saveSettings: () => void,
	addPendingDownload: Queue<DownloadOpts>["push"],
	clearPendingDownloads: Queue<DownloadOpts>["clear"],
	getPendingOrders: () => Order[],
	addPendingOrder: (o: Order) => void,
	clearStaleOrders: () => void,
	getBlockTimes: () => Tree<number, number>,
	addBlockTime: (time: number, height: number) => void,
	refreshTrades: () => Promise<AssetTrade[]>,
	refreshAssets: () => Promise<void>,
};

class App extends React.PureComponent<AppProps, AppState> {
	genAsset: ReturnType<typeof setInterval>;
	clearStale: ReturnType<typeof setInterval>;

	updateTicker: () => ReturnType<typeof setTimeout>;

	alive = false;
	client: typeof Client = null;
	pendingDownloads = new Queue<DownloadOpts>();
	pendingOrders: Order[] = [];
	blockTimes = createRBTree<number, number>();
	tickers = new Map<number, Ticker>();
	tradesCache = new TimeCache((s, e) => {
		const client = this.getClient();
		return !!this.state.consts && !!client && this.tradesDB ?
			this.tradesDB.refresh(this.state.consts, client, s, e) : null
	}, t => t.block);
	tradesDB;

	genMutex = new Mutex();

	methods: AppMethods;

	constructor(props: AppProps) {
		super(props);

		const iRPCSettings = this.props.initRPCSettings;

		this.client = new Client({
			host: iRPCSettings.rpchost,
			port: iRPCSettings.rpcport,
			username: iRPCSettings.rpcuser,
			password: iRPCSettings.rpcpassword,
		});

		this.tradesDB = new TradesDB(path.join(getAppDataPath(APP_NAME), 'tx.db'));

		this.methods = {
			getClient: this.getClient,
			setSettings: this.setSettings,
			saveSettings: this.saveSettings,
			addPendingDownload: this.addPendingDownload,
			clearPendingDownloads: this.clearPendingDownloads,
			getPendingOrders: this.getPendingOrders,
			addPendingOrder: this.addPendingOrder,
			clearStaleOrders: this.clearStaleOrders,
			getBlockTimes: this.getBlockTimes,
			addBlockTime: this.addBlockTime,
			refreshTrades: this.refreshTrades,
			refreshAssets: this.genAssetList,
		};

		this.state = {
			layoutRef: React.createRef(),
			layout: this.props.model,
			consts: null,
			settings: this.props.initSettings,
			tickers: new Map<number, Ticker>(),
			assetList: [],
			pendingDownloads: [],
			dOpen: false,
			sOpen: false,
			aOpen: false,
		};

		this.genAsset = setInterval(this.genAssetList, 60 * 1000);
		this.clearStale = setInterval(this.clearStaleOrders, 1000);

		this.updateTicker = () => {
			this.updateTickers();
			if (this.alive) return setTimeout(this.updateTicker, 2500);
		};
	}

	componentDidMount() {
		this.alive = true;

		const init = async () => {
			const up = await api(this.client).isDaemonUp();

			if (!up) {
				sendAlert("Could not establish connection to omnifeather daemon, "
					+ "please make sure it is running and that the coin "
					+ "config path in this app's settings is correct");
				this.openSettings();
				return false;
			}
			const consts = await constants(this.client).catch(e => {
				handleError(e, "error");
				return null;
			});
			if (consts === null) return false;

			try {
				this.tradesDB.init(consts);
			} catch (e) { handleError(e, "error"); }

			this.setState({ consts }, () => {
				this.genAssetList();
				this.updateTicker();
			});
		};

		init().then(v => {
			if (!v) this.updateTicker(); // start the update loop anyways
		});
	}

	componentWillUnmount() {
		clearInterval(this.genAsset);
		clearInterval(this.clearStale);

		if (this.tradesDB && this.tradesDB.ready()) this.tradesDB.finish();

		this.alive = false;
	}

	getClient = () => this.client;

	getBlockTimes = () => this.blockTimes;
	addBlockTime = (time: number, height: number) =>
		this.blockTimes = this.blockTimes.insert(time, height);

	addPendingDownload = (dl: DownloadOpts) => {
		const ret = this.pendingDownloads.push(dl);
		this.setState(oldState =>
			({ pendingDownloads: [...oldState.pendingDownloads, dl] }));
		return ret;
	}
	clearPendingDownloads = () => {
		const wasEmpty = this.pendingDownloads.queue.length === 0;
		const ret = this.pendingDownloads.clear();
		if (!wasEmpty) this.setState({ pendingDownloads: [] });
		return ret;
	}

	getPendingOrders = () => this.pendingOrders;
	addPendingOrder = (order: Order) => this.pendingOrders.push(order);
	clearStaleOrders = () => {
		const arr = this.pendingOrders.filter(o => !o.isDone);
		if (arr.length !== this.pendingOrders.length)
			this.pendingOrders = [...arr];
	}

	refreshTrades = async () => {
		log().debug("entering refreshTrades")

		const consts = this.state.consts;
		if (consts === null || this.client === null) return [];

		// Try starting the DB again...
		if (!this.tradesDB.ready())
			try {
				this.tradesDB.init(consts);
			} catch (e) { handleError(e, "error"); }

		if (!this.tradesDB.ready()) return [];

		const { OMNI_START_HEIGHT } = consts;
		const height = await repeatAsync(api(this.client).getBlockchainInfo,
			API_RETRIES)().then(v => v.blocks);

		return this.tradesCache.refresh(OMNI_START_HEIGHT, height);
	}

	updateTickers = async () => {
		if (this.client === null || this.state.consts === null) return;

		log().debug("entering updateTickers")

		const API = api(this.client);
		const now = DateTime.now().toUTC();
		const yesterday = now.minus({ days: 1 }).startOf("day");

		const { COIN_NAME, COIN_MARKET } = this.state.consts;

		let tickerData = await
			handlePromise(repeatAsync(API.getCoinTicker, API_RETRIES)(COIN_MARKET),
				`Could not get ${COIN_NAME} ticker data`);
		if (tickerData === null) return;

		let marketData =
			new Map<number, Ticker>([[1, { market: COIN_MARKET, ...tickerData }]]);

		const dexsells = await
			handlePromise(repeatAsync(API.getExchangeSells, API_RETRIES_LARGE)(),
				"Could not get open exchange orders");
		if (dexsells === null) return;

		const allTrades: AssetTrade[] = await this.refreshTrades().catch(e => {
			handleError(e, "error");
			return null;
		});
		if (allTrades === null) return;

		for (let asset of this.state.assetList) {
			const propid = asset.id;
			if (propid < 2) continue;

			const trades = allTrades.filter(v =>
				v.idBuy === propid).sort((a, b) => b.time - a.time);

			let lastTime;
			let last = new N(0);

			if (trades.length > 0) {
				let lastTrade = trades[0];
				lastTime = DateTime.fromSeconds(lastTrade.time);
				last = lastTrade.amount.div(lastTrade.quantity).toDP(8);
			}

			if (last.eq(0)) continue; // Empty market

			const asks = dexsells.filter(v =>
				parseInt(v.propertyid) === propid).map(v => parseFloat(v.unitprice));

			const dayCandles = toCandle(trades.filter(v =>
				v.time < yesterday.plus({ days: 1 }).toSeconds())
				.map(tradeToLineData),
				Duration.fromObject({ days: 1 }).as('seconds'));
			const dayClose = dayCandles.length > 0 && isBarData(dayCandles[0]) ?
				dayCandles[0].close : null;
			const chg = dayClose ? last.sub(dayClose) : new N(0);

			marketData.set(asset.id, {
				market: asset.name,
				last: { time: lastTime, price: +last },
				chg: +chg,
				chgp: dayClose ? +chg.div(dayClose) : 0,
				bid: 0,
				ask: asks.length !== 0 ? Math.min(...asks) : 0,
				vol: +dsum(trades.filter(v => v.time >= now.minus({ days: 1 })
					.toSeconds()).map(v => v.amount)),
			});
		}

		this.setState(oldState => {
			if (!tickersEqual(oldState.tickers, marketData))
				return { tickers: marketData };
		});
	}

	genAssetList = () => this.genMutex.runExclusive(async () => {
		if (this.client === null || this.state.consts === null) return;

		const { COIN_NAME } = this.state.consts;

		let proplist = [{
			id: PROPID_BITCOIN,
			name: `(${PROPID_BITCOIN}) Bitcoin`,
		},
		{
			id: PROPID_COIN,
			name: `(${PROPID_COIN}) ${COIN_NAME}`,
		}];

		const API = api(this.client);

		const list = await
			handlePromise(repeatAsync(API.listProperties, API_RETRIES_LARGE)(),
				"Could not list properties for asset list generation", data =>
				proplist.concat(data.slice(2).map(x =>
					({ id: x.propertyid, name: `(${x.propertyid}) ${x.name}` }))));
		if (list === null) return;

		this.setState(oldState => {
			if (!propsEqual(list, oldState.assetList)) return { assetList: list };
		});
	});

	factory = (node: TabNode) => {
		var component = node.getComponent();

		const panel = (el: JSX.Element, style: Record<string, any> = {}) =>
			<div className="panel" style={style}>
				<AppContext.Provider value={{ ...this.state, ...this.methods }}>
					{el}
				</AppContext.Provider>
			</div>;

		if (component === "text")
			return panel(<>Panel {node.getName()}</>);
		else if (component === "ticker")
			return panel(<Ticker />);
		else if (component === "assets")
			return panel(<Assets />);
		else if (component === "chart")
			return panel(<Chart />, {
				minWidth: "580px",
				overflow: "auto"
			});
		else if (component === "markets")
			return panel(<Markets />);
		else if (component === "sales")
			return panel(<Sales />);
		else if (component === "transfer")
			return panel(<AssetTransfer />);
		else if (component === "manage")
			return panel(<AssetManage />);
		else if (component === "terminal")
			return panel(<Terminal
				color='green' backgroundColor='black' barColor='black'
				style={{
					fontWeight: "bold",
					fontSize: "1em"
				}}
				commandPassThrough={(cmd: any, print: (k: any) => void) => {
					const cmdarr = cmd as string[];
					const [c, args] = [cmdarr[0], cmdarr.slice(1)];

					const stripQuotes = (v: string) =>
						v.replace(/(?<!\\)"(?<inner>[^"]*)(?<!\\)"/g,
							'$<inner>');

					// Fix default split on space inside quotes
					// and convert number strings to numbers
					const parseArgs =
						args.reduce((prev: string[], val: string) => {
							if (prev.length === 0) return [val];
							if (prev[prev.length - 1].length === 0 ||
								(prev[prev.length - 1]
									.split('"').length - 1) % 2 === 0)
								return prev.concat([val]);
							return prev.slice(0, -1)
								.concat(prev[prev.length - 1] + " " + val);
						}, []).map(x => isNumber(x) ? parseFloat(x) :
							(isBoolean(x) ? parseBoolean(x) : stripQuotes(x)));

					this.client.command(stripQuotes(c),
						...parseArgs).then((r: Object) =>
							print(JSON.stringify(r, null, 2)),
							(err: Error) => print(err.message));
				}}
				msg={`Enter ${this.state.consts?.COIN_OMNI_NAME ?? "a"} command...`}
				commands={{
					"help": (cmd: any, print: (k: any) => void) => {
						const cmdarr = cmd as string[];
						const [c, args] = [cmdarr[0], cmdarr.slice(1)];
						this.client.command(c, ...args)
							.then((r: Object) => print(r),
								(err: Error) => print(err.message));
					}
				}}
				startState="maximised" />);
		else if (component === "trade")
			return panel(<Trade />,
				{ minWidth: "935px", overflow: "auto" });
		else if (component === "orders")
			return panel(<Orders />);
		else if (component === "history")
			return panel(<History />);
		else if (component === "info")
			return panel(<Info />);

		return <></>;
	}

	openDownloads = () => this.setState({ dOpen: true });
	closeDownloads = () => this.setState({ dOpen: false });

	openSettings = () => readSettings().then(s => {
		this.setState({ settings: s, sOpen: true });
	});
	setSettings = (s: Record<string, any>) =>
		this.setState(oldState => ({ settings: { ...oldState.settings, ...s } }));
	closeSettings = () => this.setState({ sOpen: false });
	saveSettings = async () => {
		const clientSettings = await
			handlePromise(readRPCConf(this.state.settings.dconfpath),
				"Could not read RPC conf file", s => ({
					host: s.rpchost,
					port: s.rpcport,
					username: s.rpcuser,
					password: s.rpcpassword,
				}));
		if (clientSettings !== null) {
			this.client = new Client(clientSettings);

			const consts = await constants(this.client).catch(e => {
				handleError(e, "error");
				return null;
			});

			try {
				this.tradesDB.init(consts);
			} catch (e) { handleError(e, "error"); }

			if (consts !== null)
				this.setState({ consts }, () => { this.genAssetList(); });
		}
		writeSettings(this.state.settings);
	};

	openAbout = () => this.setState({ aOpen: true });
	closeAbout = () => this.setState({ aOpen: false });

	render() {
		return <AppContext.Provider value={{ ...this.state, ...this.methods }}>
			<Layout ref={this.state.layoutRef}
				model={this.state.layout}
				factory={this.factory} />
			<Settings isOpen={this.state.sOpen}
				closeModalCallback={this.closeSettings} />
			<About isOpen={this.state.aOpen}
				closeModalCallback={this.closeAbout} />
			<Downloads isOpen={this.state.dOpen}
				closeModalCallback={this.closeDownloads} />
		</AppContext.Provider>;
	}
}

export const appRef = React.createRef<App>();

export const addTab = (title: string, component: string) => {
	let layoutRef = appRef.current.state.layoutRef;
	if (layoutRef && layoutRef.current)
		layoutRef.current.addTabToActiveTabSet({
			type: "tab",
			name: title,
			component: component,
		});
}

ipcRenderer.on("flag:loglevel", (_, level) => setLogLevel(level));

(async () => {
	ipcRenderer.send("init");

	let initSettings = await readSettings();
	let rpcSettings = await readRPCConf(initSettings.dconfpath);
	let initLayout = await readLayout();

	let model = Model.fromJson(initLayout);
	let appComponent = <>
		<App ref={appRef}
			model={model} initSettings={initSettings}
			initRPCSettings={rpcSettings} />
		<ReactNotification />
	</>;

	ipcRenderer.on("open:downloads", () => appRef.current.openDownloads());
	ipcRenderer.on("open:settings", () => appRef.current.openSettings());
	ipcRenderer.on("open:about", () => appRef.current.openAbout());
	ipcRenderer.on("add:tab", (_, msg) => addTab(msg.title, msg.component));

	window.onfocus = _ => ipcRenderer.send("register");
	window.onblur = _ => ipcRenderer.send("unregister");

	window.onbeforeunload = (e: BeforeUnloadEvent) => {
		log().debug("onbeforeunload");
		ipcRenderer.send("unregister");
		ipcRenderer.send("quitmsg");
		if (!!appRef.current && !!appRef.current.state.layout)
			writeLayout(appRef.current.state.layout.toJson()).then(_ => {
				ipcRenderer.send("app_quit");
				window.onbeforeunload = null;
			});

		e.returnValue = false;
	};

	ipcRenderer.send("register");

	Modal.setAppElement("#root");

	ReactDOM.render(appComponent, document.getElementById("root"));
})();