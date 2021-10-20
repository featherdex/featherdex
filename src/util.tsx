"use strict";

import React from 'react';
import Client from 'bitcoin-core';
import getAppDataPath from 'appdata-path';

import { sum } from 'lodash';
import { Mutex } from 'async-mutex';
import {
	BarData, LineData, WhitespaceData, UTCTimestamp
} from 'lightweight-charts';
import { ReactNotificationOptions, store } from 'react-notifications-component';

import api from './api';
import Order from './order';

import {
	APP_NAME, LAYOUT_NAME, CONF_NAME, SATOSHI, COIN_FEERATE, EXODUS_ADDRESS,
	MAX_ACCEPT_FEE, EMPTY_TX_VSIZE, TX_I_VSIZE, TX_O_VSIZE, OPRETURN_ACCEPT_VSIZE,
	OPRETURN_SEND_VSIZE, OPRETURN_ORDER_VSIZE, MIN_CHANGE, EXODUS_CHANGE, OrderAction
} from './constants';
import { defaultLayout, defaultRPCSettings, defaultSettings } from './defaults';

import * as fs from 'fs';
import * as path from 'path';

import { app, BrowserWindow, shell } from 'electron';

export const log = require('simple-node-logger').createSimpleLogger({
	logFilePath: 'featherdex.log',
	timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
});

log.setLevel('debug');

let lastId = 0;
const rootPath = getAppDataPath(APP_NAME);

export function uniqueId(prefix = 'id') {
	lastId++;
	return `${prefix}${lastId}`;
}

export function isEmpty(obj: Object) {
	return Object.entries(obj).length === 0;
}

export function isBoolean(val: any) {
	const strval = val.toString().toLowerCase();
	return strval === "true" || strval === "false";
}

export function isNumber(val: any) {
	return !isNaN(parseFloat(val)) && !isNaN(val - 0);
}

export function isInteger(val: any) {
	if (!isNumber(val)) return false;
	const x = parseFloat(val);
	return (x | 0) === x;
}

export function parseBoolean(val: any) {
	return String(val).toLowerCase() === "true";
}

export function roundn(v: number, n: number): number {
	return Number(Math.round(Number(`${v.toString()}e${n.toString()}`)) + "e-" + n)
}

export const repeatAsync = <T extends unknown>
	(func: (...args: any[]) => Promise<T>, times: number) =>
	async (...funcArgs: any[]): Promise<T> => {
		let v = null;
		let done = false;

		for (var i = 0; i < times && !done; i++)
			v = await func(...funcArgs).then(val => {
				done = true;
				return val;
			});

		if (!v)
			throw new Error(`Function ${func} timeout `
				+ `after ${times} tries`);

		return v;
	}

function makeDir(path: string) {
	return fs.promises.mkdir(path, { recursive: true }).catch(
		err => handleError(err, "fatal"));
}

export function exists(path: string, directory: boolean) {
	return fs.promises.stat(path).then((stat: fs.Stats) =>
		!!stat && (directory ? stat.isDirectory() : stat.isFile()),
		_ => { return false });
}

async function checkDir(path: string) {
	const isDir = await exists(path, true);
	if (!isDir)
		return makeDir(path);
	return Promise.resolve();
}

async function readJson(file: string) {
	await checkDir(rootPath);

	return fs.promises.readFile(path.resolve(rootPath, file))
		.then((data: Buffer) => {
			try {
				return JSON.parse(data.toString());
			} catch (_) {
				return {}; // malformed JSON
			}
		}, _ => ({}));
}

async function writeJson(file: string, jsondata: Object, append = false) {
	await checkDir(rootPath);

	return fs.promises.writeFile(path.resolve(rootPath, file),
		JSON.stringify(jsondata, null, 4),
		{ flag: (append ? 'a' : 'w') })
		.catch((err: Error) => handleError(err));
}

export async function readRPCConf(file: string) {
	const isConf = await exists(file, false);
	if (!isConf) return defaultRPCSettings;

	return fs.promises.readFile(file).then(
		contents => {
			var rpcSettings = { ...defaultRPCSettings };
			for (var line of contents.toString().split("\n")) {
				const eqI = line.indexOf("=");
				if (eqI !== -1) {
					const [key, value] =
						[line.substr(0, eqI), line.substr(eqI + 1)];
					if (rpcSettings.hasOwnProperty(key))
						rpcSettings[key] = value;
				}
			}

			return rpcSettings;
		}, err => {
			alert(err);
			return defaultRPCSettings;
		});
}

export function inverseOHLC(v: BarData): BarData {
	return {
		time: v.time,
		open: 1.0 / v.open,
		high: 1.0 / v.high,
		low: 1.0 / v.low,
		close: 1.0 / v.close
	};
}

export function toFormattedAmount(num: number, numformat: string, places: number,
	style?: "decimal" | "currency" | "percent",
	colorType?: "sign" | "green" | "red" | "none",
	plain = false, currency?: string) {
	if (num === 0)
		return <span className="number-zero">-</span>;

	let positive = num > 0;
	let option = {
		style: style ? style : "decimal",
		currency: currency,
		minimumFractionDigits: places,
		maximumFractionDigits: places
	};
	let formatter = new Intl.NumberFormat(numformat, option);

	if (plain) return formatter.format(num);

	let parts = formatter.formatToParts(num);

	const color = !colorType || colorType === "sign" ? (positive ?
		"number-pos" : "number-neg") :
		(colorType === "green" ? "number-pos" :
			(colorType === "red" ? "number-neg" : "number"))

	var result = [];
	for (var i = 0; i < parts.length; i++) {
		if (["integer", "group", "minusSign", "plusSign",
			"percentSign", "decimal"].includes(parts[i].type)) {
			result.push(<span key={uniqueId("fa-")} className={color}>
				{parts[i].value}</span>);
		} else if (parts[i].type === "fraction") {
			const fraction = parts[i].value;
			var j = fraction.length;
			for (; j > 0; j--)
				if (fraction.charAt(j - 1) !== '0')
					break;

			const [apart, zpart] = [fraction.substr(0, j), fraction.substr(j)];

			result.push(<span key={uniqueId("fa-")}
				className={color}>{apart}</span>);
			result.push(<span key={uniqueId("fa-")}
				className={color + " zero-part"}>
				{zpart}</span>);
		}
	}

	return result;
}

export async function readSettings() {
	const data = await readJson(CONF_NAME);

	if (isEmpty(data))
		return defaultSettings;

	var settings = defaultSettings;
	for (var key of Object.keys(defaultSettings)) {
		settings[key] = data.hasOwnProperty(key) ?
			data[key] : defaultSettings[key];
	}

	return settings;
}

export function writeSettings(settings: Object) {
	return writeJson(CONF_NAME, settings);
}

export async function readLayout() {
	const data = await readJson(LAYOUT_NAME) as unknown;

	if (isEmpty(data))
		return defaultLayout;

	return data;
}

export function writeLayout(layout: Object) {
	return writeJson(LAYOUT_NAME, layout);
}

export function toLine(d: BarData) {
	return { time: d.time, value: d.close };
}

export function isBarData(v: (BarData | LineData | WhitespaceData)): v is BarData {
	return (v as BarData).open !== undefined;
}

export function isLineData(v: (BarData | LineData | WhitespaceData)): v is LineData {
	return (v as LineData).value !== undefined;
}

export function isWhitespaceData(v: (BarData | LineData | WhitespaceData)):
	v is WhitespaceData {
	return (v as BarData).open === undefined && (v as LineData).value === undefined;
}

export function toCandle(d: (BarData | LineData | WhitespaceData)[],
	interval: number) {
	let data: (BarData | WhitespaceData)[] = [];

	if (!d || d.length === 0) return [];

	const d0 = d[0];
	const firstTime = d0.time as UTCTimestamp;

	var place = firstTime - firstTime % interval;
	var [o, h, l, c] = [Number.NaN, 0, Number.MAX_VALUE, 0];

	for (var i = 0; i < d.length; i++) {
		const di = d[i];
		const time = di.time as UTCTimestamp;

		if (time >= place + interval) { // if we have skipped into the next candle
			if (Number.isNaN(o)) // no trades
				data.push({ time: place as UTCTimestamp });
			else
				data.push({
					time: place as UTCTimestamp,
					open: o, high: h, low: l, close: c
				});

			o = isBarData(di) ? di.open : (isLineData(di) ? di.value : Number.NaN);
			[h, l, c] = [0, Number.MAX_VALUE, 0];

			place += interval;

			// keep pushing empty candles until we catch up to the next datum
			while (time >= place + interval) {
				data.push({ time: place as UTCTimestamp });
				place += interval;
			}
		}

		if (isBarData(di)) {
			if (Number.isNaN(o)) o = di.open;
			if (di.high > h) h = di.high;
			if (di.low < l) l = di.low;
			c = di.close;
		} else if (isLineData(di)) {
			if (Number.isNaN(o)) o = di.value;
			if (di.value > h) h = di.value;
			if (di.value < l) l = di.value;
			c = di.value;
		}
	}

	data.push({
		time: place as UTCTimestamp, open: o, high: h, low: l, close: c
	});

	let gappedData: (BarData | WhitespaceData)[] = Array.from(data);
	for (var i = 1; i < data.length; i++) {
		gappedData.push(data[i - 1]);
		const diff = (data[i].time as UTCTimestamp)
			- (data[i - 1].time as UTCTimestamp);
		for (var j = 0; j < diff / interval - 1; j++)
			gappedData.push({
				time: ((data[i - 1].time as UTCTimestamp)
					+ j * interval) as UTCTimestamp
			})
	}

	return data;
}

export function tradeToLineData(trade: AssetTrade) {
	return {
		time: trade.time,
		value: roundn(trade.amount / trade.quantity, 8),
	};
}

export function toTradeInfo(v: BittrexOrder | Order | AssetTrade) {
	const isBittrexOrder =
		(x: BittrexOrder | Order | AssetTrade): x is BittrexOrder =>
			!!(x as BittrexOrder).type;
	const isOrder = (x: Order | AssetTrade): x is Order => !!(x as Order).id;

	if (isBittrexOrder(v)) {
		let tradeInfo = `${v.type} ${v.direction} `;

		if (v.type === "LIMIT")
			tradeInfo += `${parseFloat(v.quantity).toFixed(8)} FTC`
				+ ` @${v.limit} BTC, filled `;

		tradeInfo += `${v.fillQuantity} FTC for ${v.proceeds} BTC,`
			+ ` fees ${v.commission} BTC`;

		return tradeInfo;
	} else if (isOrder(v))
		return `${v.buysell.toUpperCase()} Asset #${v.id} `
			+ `${v.quantity.toFixed(8)}@${v.price.toFixed(8)} FTC, `
			+ `fees ${v.fee.toFixed(8)} FTC`;
	else
		return `Buy Asset #${v.idBuy} Sell Asset #${v.idSell}, `
			+ `${v.quantity.toFixed(8)}, ${v.remaining.toFixed(8)} remaining, `
			+ `${v.fee.toFixed(8)} FTC fees`;
}

export async function estimateTxFee(client: typeof Client,
	rawtx: string, size?: number) {
	const API = api(client);
	const vsize = size ? size :
		await repeatAsync(API.decodeTransaction, 3)(rawtx).then(v => {
			if (!v.vsize) throw new Error("Could not decode transaction");
			return v.vsize;
		});

	const fee = await repeatAsync(API.estimateFee, 3)().catch(_ => COIN_FEERATE);

	return Math.ceil(vsize / 1000.0 * fee * (1 / SATOSHI)) * SATOSHI;
}

export async function estimateBuyFee(client: typeof Client, orderct: number) {
	let acceptFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ 2 * TX_O_VSIZE + OPRETURN_ACCEPT_VSIZE);
	let payFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ (orderct + 1) * TX_O_VSIZE);

	return {
		acceptFee, payFee,
		totalFee: roundn(orderct * acceptFee + payFee
			+ EXODUS_CHANGE + MIN_CHANGE, 8)
	};
}

export async function estimateSellFee(client: typeof Client, reshufflect: number) {
	let sendFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ TX_O_VSIZE + OPRETURN_SEND_VSIZE);
	let postFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ TX_O_VSIZE + OPRETURN_ORDER_VSIZE);

	return {
		sendFee, postFee,
		totalFee: roundn(reshufflect * sendFee + postFee + MIN_CHANGE, 8)
	};
}

export async function createRawSend(client: typeof Client, recipient: string,
	propid: number, amount: number, inUTXO: UTXO, fee = 0) {
	const API = api(client);

	const payload = await repeatAsync(API.createPayloadSend, 5)
		(propid, amount).catch(_ => {
			throw new Error("Could not create simple send payload");
		});

	const change = roundn(inUTXO.amount - fee, 8);

	if (change < MIN_CHANGE)
		throw new Error("Could not create raw send transaction, fee too high");

	const pretx = await repeatAsync(API.createRawTransaction, 3)
		({
			ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
			outs: [{ [recipient]: change }],
		}).catch(_ => {
			throw new Error("Could not create raw send transaction (part 1)");
		});

	const rawtx = await
		repeatAsync(API.createRawTxOpReturn, 3)(pretx, payload).catch(_ => {
			throw new Error("Could not create raw send transaction (part 2)");
		});

	return rawtx;
}

export async function createRawAccept(client: typeof Client, seller: string,
	propid: number, amount: number, inUTXO: UTXO, fee = 0) {
	const API = api(client);

	const payload = await repeatAsync(API.createPayloadAccept, 5)
		(propid, amount).catch(_ => {
			throw new Error("Could not create dex accept payload");
		});

	const change = roundn(inUTXO.amount - MIN_CHANGE - fee, 8);

	if (change < MIN_CHANGE)
		throw new Error("Could not create raw accept transaction, fee too high");

	const pretx = await repeatAsync(API.createRawTransaction, 3)
		({
			ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
			outs: [{ [inUTXO.address]: change }, { [seller]: MIN_CHANGE }],
		}).catch(_ => {
			throw new Error("Could not create raw accept transaction (part 1)");
		});

	const rawtx = await
		repeatAsync(API.createRawTxOpReturn, 3)(pretx, payload).catch(_ => {
			throw new Error("Could not create raw accept transaction (part 2)");
		});

	return rawtx;
}

export async function createRawPay(client: typeof Client,
	orders: { address: string, amount: number }[], inUTXO: UTXO, fee = 0) {
	const API = api(client);

	const total = sum(orders.map(v => v.amount));
	const change = roundn(inUTXO.amount - EXODUS_CHANGE - total - fee, 8);

	if (change < MIN_CHANGE)
		throw new Error("UTXO not large enough"
			+ `input=${inUTXO.amount}, total=${total}, fee=${fee + EXODUS_CHANGE}`);

	let outs: RawTxBlueprint["outs"] =
		[{ [inUTXO.address]: change }, { [EXODUS_ADDRESS]: EXODUS_CHANGE }];
	outs.push(...orders.map(order =>
		({ [order.address]: roundn(order.amount, 8) })));

	const rawtx = await repeatAsync(API.createRawTransaction, 3)({
		ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }], outs: outs
	}).catch(_ => {
		throw new Error("Could not create raw pay transaction");
	});

	return rawtx;
}

export async function createRawOrder(client: typeof Client, propid: number,
	action: OrderAction, inUTXO: UTXO, fee = 0, quantity = 0, price = 0) {
	const API = api(client);

	const payload = await handlePromise(repeatAsync(API.createPayloadOrder, 5)
		(...[propid, quantity, price, action,
			...(action === OrderAction.ORDER_CANCEL ? [0, 0] : [])]),
		"Could not create payload for raw order transaction");
	if (payload === null) return;

	const change = roundn(inUTXO.amount - fee, 8);

	if (change < MIN_CHANGE)
		throw new Error("Could not create raw order transaction, fee too high");

	log.debug("inUTXO")
	log.debug(inUTXO)
	log.debug(`change=${change}`)

	const pretx = await repeatAsync(API.createRawTransaction, 3)({
		ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
		outs: [{ [inUTXO.address]: change }],
	});

	return await repeatAsync(API.createRawTxOpReturn, 3)(pretx, payload);
}

export async function getPendingAccepts(client: typeof Client, propid?: number,
	pendingTxs?: OmniTx[]) {
	const API = api(client);

	const pending = await
		repeatAsync(API.getPendingAccepts, 3)(propid, pendingTxs).catch(_ => {
			throw new Error("Could not get pending accepts on exchange");
		});

	return await Promise.all(pending.map(p =>
		repeatAsync(API.getPayload, 5)(p.txid).then(s => ({
			address: p.referenceaddress,
			amount: parseInt(s.payload.slice(16), 16),
		})))).then(arr => arr.reduce((map, v) =>
			map.set(v.address, [...(map.get(v.address) || []), -v.amount]),
			new Map<string, number[]>()), _ => {
				throw new Error("Could not get payload of pending accepts");
			});
}

// Get a list of orders to fill based on the asset ID and quantity
export async function getFillOrders(client: typeof Client, propid: number,
	quantity: number, isNoHighFees: boolean) {
	const API = api(client);

	// Get orderbook sells
	const sells: DexSell[] = await repeatAsync
		(API.getExchangeSells, 3)().then(s =>
			s.filter(v => parseInt(v.propertyid) === propid).sort((a, b) =>
				parseFloat(a.unitprice) - parseFloat(b.unitprice)), _ => {
					throw new Error
						("Could not get orderbook to fill for orderbook query");
				});
	if (sells === null) return;

	log.debug("sells")
	log.debug(sells)

	const pendingTxs = await repeatAsync(API.getPendingTxs, 5)().catch(_ => {
		throw new Error("Could not get pending transactions for orderbook query");
	});

	// Get accepts that are sitting in the mempool so we don't interfere
	const pendingAccepts = await
		getPendingAccepts(client, propid, pendingTxs).catch(_ => {
			throw new Error("Could not get pending accepts for orderbook query");
		});

	log.debug("pendingAccepts")
	log.debug(pendingAccepts)

	// Get cancels that are sitting in the mempool as well
	const pendingCancels = await
		repeatAsync(API.getPendingCancels, 3)(propid, pendingTxs).then(cancels =>
			cancels.reduce((map, v) => map.set(v.sendingaddress, true),
				new Map<string, boolean>()), _ => {
					throw new Error("Could not get list of pending sell cancels");
				});

	log.debug("pendingCancels")
	log.debug(pendingCancels)

	let fillOrders: {
		address: string, quantity: number, payAmount: number,
	}[] = [];
	let fillRemaining = quantity;

	log.debug("fill order loop")
	for (let i of sells) {
		if (pendingCancels.has(i.seller)
			|| (isNoHighFees && parseFloat(i.minimumfee) > MAX_ACCEPT_FEE)) continue;

		log.debug("sell")
		log.debug(i)

		const orderAmount = parseFloat(i.amountavailable)
			+ sum(pendingAccepts.get(i.seller) || []); // pendings are negative
		const price =
			parseFloat(i.feathercoindesired) / parseFloat(i.amountavailable);

		log.debug(`orderAmount=${orderAmount} price=${price} fillRemaining=${fillRemaining}`)

		if (orderAmount >= fillRemaining) {
			log.debug("exiting loop")
			fillOrders.push({
				address: i.seller,
				quantity: fillRemaining,
				payAmount: roundn(fillRemaining * price, 8),
			});
			break;
		}

		fillOrders.push({
			address: i.seller,
			quantity: orderAmount,
			payAmount: roundn(orderAmount * price, 8),
		});
		fillRemaining -= orderAmount;
	}

	return { fillOrders, fillRemaining };
}

export async function getAddressAssets(client: typeof Client, propid: number) {
	const API = api(client);

	// Factor in balances that have pending sells
	const pendingSells = await repeatAsync(API.getPendingTxs, 3)().then(pending =>
		pending.filter(v => v.type === "DEx Sell Offer"
			&& (v as DexOrder).propertyid === propid).reduce((map, v) =>
				map.set(v.sendingaddress,
					[...(map.get(v.sendingaddress) || []),
					-parseFloat((v as DexOrder).amount)]),
				new Map<string, number[]>()), _ => {
					throw new Error("Could not get pending sells for filtering");
				});

	log.debug("pendingSells")
	log.debug(pendingSells)

	// Get address asset balances, filter out pending sells, descending
	const addressAssets = await
		repeatAsync(API.getWalletAddressAssets, 3)().then(assets =>
			assets.flatMap(v => v.balances.map(w =>
			({
				address: v.address,
				propertyid: w.propertyid,
				name: w.name,
				balance: parseFloat(w.balance)
					+ sum(pendingSells.get(v.address) || []),
				reserved: parseFloat(w.reserved),
				frozen: parseFloat(w.reserved),
			}))).filter(v =>
				v.propertyid === propid && v.balance > 0).map(v =>
				({
					address: v.address,
					amount: v.balance,
					occupied: v.reserved > 0,
					pending: !!pendingSells.get(v.address),
				})).sort((a, b) => b.amount - a.amount), _ => {
					throw new Error("Could not obtain wallet address balances");
				});

	return addressAssets;
}

export function toUTXO(txid: string, vout: number, address: string, amount: number):
	UTXO {
	return {
		txid: txid,
		vout: vout,
		address: address,
		label: "", // unused
		redeemScript: "", // unused
		scriptPubKey: "", // unused
		amount: amount,
		confirmations: 0, // unused
		spendable: true,
		solvable: true,
		desc: "", // unused
		safe: true,
	};;
}

export function fundTx(client: typeof Client, rawtx: string,
	options = {} as FundRawOptions, errmsg = "Could not fund raw transaction") {
	log.debug(`fundtx ${rawtx}`)
	return handlePromise(repeatAsync(api(client).fundRawTransaction, 3)
		(rawtx, options), errmsg, v => v.hex);
}

export function signTx(client: typeof Client, rawtx: string,
	errmsg = "Could not sign raw transaction") {
	log.debug(`signtx ${rawtx}`)
	return handlePromise(repeatAsync(api(client).signRawTransaction, 3)(rawtx),
		errmsg, v => v.hex);
}

export function sendTx(client: typeof Client, rawtx: string,
	errmsg = "Could not send raw transaction") {
	log.debug(`sendtx ${rawtx}`)
	return handlePromise(repeatAsync(api(client).sendRawTransaction, 3)(rawtx),
		errmsg);
}

export function waitForTx(client: typeof Client, tx: string, status?: Cancellable) {
	return new Promise((resolve, reject) => {
		(async function waitFor(status) {
			if (!!status && status.isCancel) return reject();
			const isConfirm = await handlePromise(repeatAsync
				(api(client).getTransaction, 5)(tx),
				`Could not query tx ${tx}`,
				v => v.confirmations && v.confirmations > 0);
			if (isConfirm) return resolve(true);
			setTimeout(waitFor, 1000, status);
		})(status);
	});
}

export function handlePromise<T>(p: Promise<T>, errmsg: string): Promise<T>;
export function handlePromise<T, V extends unknown>
	(p: Promise<T>, errmsg: string, partThen: (v: T) => V): Promise<V>;

export function handlePromise<T, V extends unknown>
	(p: Promise<T>, errmsg: string, partThen?: (v: T) => V):
	Undefined<typeof partThen, Promise<T>, Promise<V>> {
	const partCatch = (e: Error): T => {
		handleError(e);
		handleError(new Error(errmsg), "error");
		return null;
	};
	return (partThen !== undefined ? p.then(partThen).catch(partCatch)
		: p.catch(partCatch)) as
		Undefined<typeof partThen, Promise<T>, Promise<V>>;
}

export function handleError(err: Error, level = "log") {
	if (err.message === "ESOCKETTIMEDOUT"
		|| err.message.startsWith("connect ECONNREFUSED")
		|| err.message === "no auth mechanism defined") level = "warn";

	const flog = level === "fatal" ?
		log.fatal : (level === "error" ?
			log.error : (level === "warn" ? log.warn : log.info));

	flog(`${err.name}: `, err.message);
	flog(err.stack);

	if (level === "log" || level === "warn")
		return;

	notify("danger", err.name, err.message);

	if (level === "error")
		return;

	app.quit();
}

export function createWindow(page: string, width = 1280, height = 800,
	frame = true) {
	const win = new BrowserWindow({
		width, height, frame, webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
	});
	win.loadFile(page);

	return win;
};

export function openLink(url: string) {
	shell.openExternal(url);
}

export function notify(type: ReactNotificationOptions['type'],
	title: string, message: string) {
	store.addNotification({
		title: title,
		message: message,
		type: type,
		insert: "top",
		container: "top-right",
		animationIn: ["animate__animated", "animate__fadeIn"],
		animationOut: ["animate__animated", "animate__fadeOut"],
		dismiss: {
			duration: 5000,
			onScreen: true
		}
	});
}

export function useQueue<T extends Stringable>(defaultData = [] as T[]) {
	const [queue, setQueue] = React.useState<T[]>(defaultData);
	const [queueMap, setQueueMap] = React.useState<Map<T, number>>(new Map());

	const mutex = React.useMemo(() => new Mutex(), []);

	const push = (...x: T[]) => mutex.runExclusive(() => {
		setQueue(oldQueue => [...oldQueue, ...x]);
		setQueueMap(oldQueueMap => x.reduce((map, v) =>
			map.set(v, (oldQueueMap.get(v) || 0) + 1), new Map(oldQueueMap)));
	});

	const pop = () => mutex.runExclusive(() => {
		let x: T;

		setQueue(oldQueue => {
			const q = [...oldQueue];
			x = q.shift();
			return q;
		});

		if (x !== undefined)
			setQueueMap(oldQueueMap =>
				new Map(oldQueueMap).set(x, oldQueueMap.get(x) - 1));

		return x;
	});

	const clear = () => mutex.runExclusive(() => {
		let oQueue: T[] = [];
		let oQueueMap = new Map<T, number>();

		setQueue(oldQueue => {
			oQueue = [...oldQueue];
			return [];
		});
		setQueueMap(oldQueueMap => {
			oQueueMap = new Map(oldQueueMap);
			return new Map();
		});

		return { oldQueue: oQueue, oldQueueMap: oQueueMap };
	});

	const has = (x: T) => queueMap.get(x) > 0;
	const count = (x: T) => queueMap.get(x) || 0;

	return { queue, queueMap, push, pop, clear, has, count };
}