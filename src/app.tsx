"use strict";

import React from 'react';
import Modal from 'react-modal';
import ReactDOM from 'react-dom';
import Terminal from 'terminal-in-react';
import Client from 'bitcoin-core';
import ReactNotification from 'react-notifications-component';
import process from 'process';

import { Layout, Model, TabNode } from 'flexlayout-react';

import api from './api';
import Order from './order';
import Assets from './Assets';
import About from './About';
import Settings from './Settings';
import Chart from './Chart';
import Trade from './Trade';
import History from './History';
import Orders from './Orders';
import Info from './Info';
import Ticker from './Ticker';
import AppContext from './contexts/AppContext';

import { PROPID_BITCOIN, PROPID_FEATHERCOIN } from './constants';

import {
	repeatAsync, cleanup, readLayout, readSettings, writeSettings, readRPCConf,
	isNumber, isBoolean, parseBoolean, handleError
} from './util';

import 'react-notifications-component/dist/theme.css'
import 'flexlayout-react/style/dark.css';
import './app.css';

const nw = require('nw.gui');

type AppProps = {
	model: Model,
	initSettings: Settings,
	initRPCSettings: RPCSettings,
};

export type AppState = {
	layoutRef: React.RefObject<Layout>,
	layout: Model,
	settings: Settings,
	assetList: PropertyList,
	client: typeof Client,
	sOpen: boolean,
	aOpen: boolean,
	pendingOrders: Order[],
};

class App extends React.Component<AppProps, AppState> {
	genAsset: ReturnType<typeof setTimeout>;
	clearStale: ReturnType<typeof setTimeout>;

	constructor(props: AppProps) {
		super(props);

		const initSettings = this.props.initSettings;
		const initRPCSettings = this.props.initRPCSettings;

		let client = new Client({
			host: initRPCSettings.rpchost,
			port: initRPCSettings.rpcport,
			username: initRPCSettings.rpcuser,
			password: initRPCSettings.rpcpassword,
		});

		const API = api(client);

		API.isDaemonUp().then((v: boolean) => {
			if (!v)
				alert("Could not establish connection to omnifeather daemon, "
					+ "please make sure it is running and that the Feathercoin "
					+ "config path in this app's settings is correct");
		})

		this.state = {
			layoutRef: React.createRef(),
			layout: this.props.model,
			settings: initSettings,
			assetList: [],
			client: client,
			sOpen: false,
			aOpen: false,
			pendingOrders: [],
		}

		this.genAssetList();
		this.genAsset = setInterval(this.genAssetList, 60 * 1000);
		this.clearStale = setInterval(this.clearStaleOrders, 1000);
	}

	componentWillUnmount() {
		clearInterval(this.genAsset);
	}

	addPendingOrder = (order: Order) => {
		const orders = Array.from(this.state.pendingOrders);
		orders.push(order);
		this.setState({ pendingOrders: orders });
	}

	clearStaleOrders = () => {
		const orders = this.state.pendingOrders.filter(o => !o.isDone);
		if (orders.length != this.state.pendingOrders.length)
			this.setState({ pendingOrders: orders });
	}

	genAssetList = () => {
		let proplist = [{
			id: PROPID_BITCOIN,
			name: `${PROPID_BITCOIN}: Bitcoin`,
		},
		{
			id: PROPID_FEATHERCOIN,
			name: `${PROPID_FEATHERCOIN}: Feathercoin`,
		}];

		if (!this.state.client)
			return proplist;

		const API = api(this.state.client);

		repeatAsync(API.listProperties, 3)().then(data =>
			this.setState({
				assetList: proplist.concat(data.slice(2).map(x =>
					({ id: x.propertyid, name: `${x.propertyid}: ${x.name}` })))
			}), e => {
				handleError(e, "error");
				return null;
			});
	}

	factory = (node: TabNode) => {
		var component = node.getComponent();
		const panel = (el: JSX.Element, style: Record<string, any> = {}) =>
			<div className="panel" style={style}>
				<AppContext.Provider value={this.state}>
					{el}
				</AppContext.Provider>
			</div>
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
		else if (component === "terminal")
			return panel(<Terminal
				color='green'
				backgroundColor='black'
				barColor='black'
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

					this.state.client.command(stripQuotes(c), ...parseArgs)
						.then((r: Object) =>
							print(JSON.stringify(r, null, 2)),
							(err: Error) => print(err.message));
				}}
				msg='Enter omnifeather command...'
				commands={{
					"help": (cmd: any, print: (k: any) => void) => {
						const cmdarr = cmd as string[];
						const [c, args] = [cmdarr[0], cmdarr.slice(1)];
						this.state.client.command(c, ...args)
							.then((r: Object) => print(r),
								(err: Error) => print(err.message));
					}
				}}
				startState="maximised"
			/>);
		else if (component === "trade")
			return panel(<Trade addPendingCallback={this.addPendingOrder} />,
				{ minWidth: "935px", overflow: "auto" });
		else if (component === "orders")
			return panel(<Orders />);
		else if (component === "history")
			return panel(<History />);
		else if (component === "info")
			return panel(<Info />);

		return <></>;
	}

	openSettings = () =>
		readSettings().then((s) => this.setState({ settings: s, sOpen: true }));

	setSettings = (s: Record<string, any>) =>
		this.setState({ settings: { ...this.state.settings, ...s } })
	closeSettings = () => this.setState({ sOpen: false });
	saveSettings = () => {
		readRPCConf(this.state.settings.dconfpath).then(s =>
			this.setState({
				client: new Client({
					host: s.rpchost,
					port: s.rpcport,
					username: s.rpcuser,
					password: s.rpcpassword,
				})
			}));
		writeSettings(this.state.settings);
	};

	openAbout = () => this.setState({ aOpen: true });
	closeAbout = () => this.setState({ aOpen: false });

	render() {
		return <AppContext.Provider value={this.state}>
			<Layout
				ref={this.state.layoutRef}
				model={this.state.layout}
				factory={this.factory} />
			<Settings
				isOpen={this.state.sOpen}
				setSettingsCallback={this.setSettings}
				closeModalCallback={this.closeSettings}
				saveModalCallback={this.saveSettings} />
			<About
				isOpen={this.state.aOpen}
				closeModalCallback={this.closeAbout} />
		</AppContext.Provider>;
	}
}

(async function() {
	let initSettings = await readSettings();
	let rpcSettings = await readRPCConf(initSettings.dconfpath);
	let initLayout = await readLayout();

	let model = Model.fromJson(initLayout);
	let appRef = React.createRef<App>();
	let app = <>
		<App ref={appRef}
			model={model} initSettings={initSettings}
			initRPCSettings={rpcSettings} />
		<ReactNotification />
	</>;
	let win = nw.Window.get();
	const end = () => cleanup(appRef.current.state.layout);

	const addTab = (title: string, component: string) => {
		let layoutRef = appRef.current.state.layoutRef;
		if (layoutRef && layoutRef.current)
			layoutRef.current.addTabToActiveTabSet({
				type: "tab",
				name: title,
				component: component,
			});
	}

	let themenu = new nw.Menu({ type: 'menubar' });

	let filemenu = new nw.Menu();
	filemenu.append(new nw.MenuItem({
		label: 'Settings...',
		click: () => appRef.current.openSettings(),
	}));
	filemenu.append(new nw.MenuItem({
		label: 'Quit',
		click: end,
		key: "Q",
		modifiers: process.platform === "darwin" ? "cmd+shift" : "ctrl+shift"
	}));

	let panelmenu = new nw.Menu();
	panelmenu.append(new nw.MenuItem({
		label: "Chart",
		click: () => addTab("Chart", "chart"),
	}));
	panelmenu.append(new nw.MenuItem({
		label: "Assets",
		click: () => addTab("Assets", "assets"),
	}));
	panelmenu.append(new nw.MenuItem({
		label: "Trade",
		click: () => addTab("Trade", "trade"),
	}));
	panelmenu.append(new nw.MenuItem({
		label: "Orders",
		click: () => addTab("Orders", "orders"),
	}));
	panelmenu.append(new nw.MenuItem({
		label: "History",
		click: () => addTab("History", "history"),
	}));
	panelmenu.append(new nw.MenuItem({
		label: "Info",
		click: () => addTab("Info", "info"),
	}));
	panelmenu.append(new nw.MenuItem({
		label: "Terminal",
		click: () => addTab("Terminal", "terminal"),
	}));
	panelmenu.append(new nw.MenuItem({
		label: "Ticker",
		click: () => addTab("Ticker", "ticker"),
	}));

	let viewmenu = new nw.Menu();
	viewmenu.append(new nw.MenuItem({
		label: "New Panel",
		submenu: panelmenu
	}))

	let aboutmenu = new nw.Menu();
	aboutmenu.append(new nw.MenuItem({
		label: 'About...',
		click: () => appRef.current.openAbout(),
	}));

	themenu.append(new nw.MenuItem({
		label: 'File',
		submenu: filemenu,
	}));

	themenu.append(new nw.MenuItem({
		label: 'View',
		submenu: viewmenu,
	}));

	themenu.append(new nw.MenuItem({
		label: 'Help',
		submenu: aboutmenu,
	}));

	win.menu = themenu;
	win.on('close', end);

	Modal.setAppElement('#root');

	ReactDOM.render(app, document.getElementById('root'));
})();