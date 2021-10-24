"use strict";

import React from 'react';
import Modal from 'react-modal';
import ReactDOM from 'react-dom';
import Terminal from 'terminal-in-react';
import Client from 'bitcoin-core';
import ReactNotification from 'react-notifications-component';
import createRBTree from 'functional-red-black-tree';
import isEqual from 'lodash/fp/isEqual';
import path from 'path';

import { ipcRenderer } from 'electron';
import { Tree } from 'functional-red-black-tree';
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

import { writeLayout, createWindow } from './util';
import {
	repeatAsync, readLayout, readSettings, writeSettings, readRPCConf,
	isNumber, isBoolean, parseBoolean, handleError, log
} from './util';

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
	settings: Settings,
	setSettings: (s: Record<string, any>) => void,
	saveSettings: () => void,
	assetList: PropertyList,
	client: typeof Client,
	sOpen: boolean,
	aOpen: boolean,
	pendingOrders: Order[],
	addPendingOrder: (o: Order) => void,
	clearStaleOrders: () => void,
	blockTimes: Tree<number, number>,
	addBlockTime: (time: number, height: number) => void,
};

class App extends React.PureComponent<AppProps, AppState> {
	genAsset: ReturnType<typeof setTimeout>;
	clearStale: ReturnType<typeof setTimeout>;

	constructor(props: AppProps) {
		super(props);

		const iSettings = this.props.initSettings;
		const iRPCSettings = this.props.initRPCSettings;

		let client = new Client({
			host: iRPCSettings.rpchost,
			port: iRPCSettings.rpcport,
			username: iRPCSettings.rpcuser,
			password: iRPCSettings.rpcpassword,
		});

		log.debug(`host=${iRPCSettings.rpchost}`);
		log.debug(`port=${iRPCSettings.rpcport}`);
		log.debug(`username=${iRPCSettings.rpcuser}`)
		log.debug(`password=${iRPCSettings.rpcpassword}`)

		api(client).isDaemonUp().then((v: boolean) => {
			if (!v) {
				alert("Could not establish connection to omnifeather daemon, "
					+ "please make sure it is running and that the Feathercoin "
					+ "config path in this app's settings is correct");
				this.openSettings();
			}
		});

		this.state = {
			layoutRef: React.createRef(),
			layout: this.props.model,
			settings: iSettings,
			setSettings: this.setSettings,
			saveSettings: this.saveSettings,
			assetList: [],
			client: client,
			sOpen: false,
			aOpen: false,
			pendingOrders: [],
			addPendingOrder: this.addPendingOrder,
			clearStaleOrders: this.clearStaleOrders,
			blockTimes: createRBTree<number, number>(),
			addBlockTime: this.addBlockTime,
		};

		this.genAssetList();
		this.genAsset = setInterval(this.genAssetList, 60 * 1000);
		this.clearStale = setInterval(this.clearStaleOrders, 1000);
	}

	componentWillUnmount() {
		clearInterval(this.genAsset);
	}

	addBlockTime = (time: number, height: number) =>
		this.setState(oldState =>
			({ blockTimes: oldState.blockTimes.insert(time, height) }));

	addPendingOrder = (order: Order) =>
		this.setState(oldState =>
			({ pendingOrders: [...oldState.pendingOrders, order] }));

	clearStaleOrders = () => {
		this.setState(oldState => {
			const arr = oldState.pendingOrders.filter(o => !o.isDone);
			if (arr.length !== oldState.pendingOrders.length)
				return { pendingOrders: arr };
		});
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
			this.setState(oldState => {
				const arr = proplist.concat(data.slice(2).map(x =>
					({ id: x.propertyid, name: `${x.propertyid}: ${x.name}` })));
				if (!isEqual(arr, oldState.assetList)) return { assetList: arr };
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
				closeModalCallback={this.closeSettings} />
			<About
				isOpen={this.state.aOpen}
				closeModalCallback={this.closeAbout} />
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

(async () => {
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

	ipcRenderer.on("open:settings", () => appRef.current.openSettings());
	ipcRenderer.on("open:about", () => appRef.current.openAbout());
	ipcRenderer.on("open:tab", (_, msg) => addTab(msg.title, msg.component));

	window.onbeforeunload = (e: BeforeUnloadEvent) => {
		createWindow(path.resolve("src", "shutdown.html"), 120, 60, false);
		if (appRef.current && appRef.current.state.layout)
			writeLayout(appRef.current.state.layout.toJson()).then(_ => {
				ipcRenderer.send("app_quit");
				window.onbeforeunload = null;
			});

		e.returnValue = false;
	};

	Modal.setAppElement("#root");

	ReactDOM.render(appComponent, document.getElementById("root"));
})();