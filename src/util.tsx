"use strict";

import * as fs from 'fs';
import * as path from 'path';

import React from 'react';
import N from 'decimal.js';
import Client from 'bitcoin-core';
import AbortController from 'abort-controller';
import getAppDataPath from 'appdata-path';
import ini from 'ini';
import fetch from 'node-fetch';

import { app, BrowserWindow, ipcRenderer } from 'electron';
import { Mutex } from 'async-mutex';
import {
	BarData, LineData, WhitespaceData, UTCTimestamp
} from 'lightweight-charts';
import { ReactNotificationOptions, store } from 'react-notifications-component';

import api from './api';
import Order from './order';
import Platforms from './platforms';

import {
	APP_NAME, LAYOUT_NAME, CONF_NAME, COIN_FEERATE, SATOSHI,
	MAX_ACCEPT_FEE, EMPTY_TX_VSIZE, TX_I_VSIZE, TX_O_VSIZE, OPRETURN_ACCEPT_VSIZE,
	OPRETURN_SEND_VSIZE, OPRETURN_ORDER_VSIZE, ACCOUNT_LABEL, OrderAction
} from './constants';
import { defaultLayout, defaultRPCSettings, defaultSettings } from './defaults';

let lastId = 0;
const rootPath = getAppDataPath(APP_NAME);

const logger = require('simple-node-logger').createSimpleLogger({
	logFilePath: path.join(rootPath, 'featherdex.log'),
	timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
});

export const dsum = (arr: Decimal[]) => arr.reduce((pv, v) => pv.add(v), new N(0));

export function log() {
	return logger;
}

export function setLogLevel(level: "fatal" | "error" | "warn" | "info" | "debug") {
	logger.setLevel(level);
	logger.debug(`Set log level to ${level}`)
}

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

export async function promiseStatus(p: Promise<unknown>):
	Promise<"pending" | "fulfilled" | "rejected"> {
	const uniqueVal = uniqueId("promiseStatus-");
	return Promise.race([p, uniqueVal]).then(v =>
		v === uniqueVal ? "pending" : "fulfilled", () => "rejected");
}

export function sendOpenLink(url: string) {
	ipcRenderer.send("shell:openlink", url);
}

export function sendAlert(message: string) {
	return ipcRenderer.sendSync("alert", message);
}

export function sendConfirm(message: string) {
	return ipcRenderer.sendSync("confirm", message);
}

export function downloadFile(url: string, path: string,
	callback: (status: DownloadProgress) => any): {
		abort: () => void, promise: Promise<void>
	} {
	const controller = new AbortController();
	const download = async (): Promise<void> => {
		const response = await fetch(url, { signal: controller.signal });
		if (response.status === 302)
			return download();
		else if (!response.ok)
			throw new Error(`Could not download ${url}, code ${response.status}`);

		let downBytes = 0;
		const totalBytes = Number(response.headers.get("content-length"));

		response.body.on("data", (chunk) => {
			downBytes += chunk.length;
			callback({ downBytes, totalBytes });
		});

		const fStream = fs.createWriteStream(path);

		return new Promise((resolve, reject) => {
			response.body.pipe(fStream);
			response.body.on("error", () => {
				callback(null);
				reject();
			});
			fStream.on("finish", () => {
				callback(null);
				resolve();
			});
		});
	};

	return { abort: () => controller.abort(), promise: download() };
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

		if (v === null)
			throw new Error(`Function ${func} timeout after ${times} tries`);

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

	return fs.promises.readFile(file).then(contents => {
		var rpcSettings = { ...defaultRPCSettings };
		const conf = ini.parse(contents.toString()) as Record<string, unknown>;

		Object.entries(conf).forEach(([k, v]) => {
			if (rpcSettings.hasOwnProperty(k) && typeof v === "string")
				rpcSettings[k] = v;
		});

		return rpcSettings;
	}, err => {
		sendAlert(err);
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
	logger.debug("writeLayout");
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

export function tradeToLineData(trade: AssetTrade): LineData {
	return {
		time: trade.time,
		value: +trade.amount.div(trade.quantity).toDP(8),
	};
}

export function toTradeInfo(consts: PlatformConstants,
	v: BittrexOrder | Order | AssetTrade) {
	const { COIN_TICKER, COIN_BASE_TICKER } = consts;
	const isBittrexOrder =
		(x: BittrexOrder | Order | AssetTrade): x is BittrexOrder =>
			!!(x as BittrexOrder).type;
	const isOrder = (x: Order | AssetTrade): x is Order => !!(x as Order).id;

	if (isBittrexOrder(v)) {
		let tradeInfo = `${v.type} ${v.direction} `;

		if (v.type === "LIMIT")
			tradeInfo += `${new N(v.quantity).toFixed(8)} ${COIN_TICKER}`
				+ ` @${v.limit} ${COIN_BASE_TICKER}, filled `;

		tradeInfo +=
			`${v.fillQuantity} ${COIN_TICKER} for ${v.proceeds} ${COIN_BASE_TICKER},`
			+ ` fees ${v.commission} ${COIN_BASE_TICKER}`;

		return tradeInfo;
	} else if (isOrder(v))
		return `${v.buysell.toUpperCase()} Asset #${v.id} `
			+ `${v.quantity.toFixed(8)}@${v.price.toFixed(8)} ${COIN_TICKER}, `
			+ `fees ${v.fee.toFixed(8)} ${COIN_TICKER}`;
	else
		return `Buy Asset #${v.idBuy} Sell Asset #${v.idSell}, `
			+ `${v.quantity.toFixed(8)}, ${v.remaining.toFixed(8)} remaining, `
			+ `${v.fee.toFixed(8)} ${COIN_TICKER} fees`;
}

export function tickersEqual(a: Map<number, Ticker>, b: Map<number, Ticker>) {
	if (a.size !== b.size) return false;

	for (let [k, v] of a) {
		const tv = b.get(k);
		if (tv.ask !== v.ask || tv.bid !== v.bid || tv.chg !== v.chg
			|| tv.chgp !== v.chgp || tv.last.price !== v.last.price
			|| +tv.last.time !== +v.last.time || tv.market !== v.market
			|| tv.vol !== v.vol
			|| (tv === undefined && !b.has(k))) return false;
	}
	return true;
}

export function propsEqual(a: PropertyList, b: PropertyList) {
	if (a.length !== b.length) return false;

	for (let i = 0; i < a.length; i++)
		if (a[i].id !== b[i].id || a[i].name !== b[i].name) return false;

	return true;
}

export async function estimateTxFee(client: typeof Client, rawtx: string,
	size?: number) {
	const API = api(client);
	const vsize = size ??
		await repeatAsync(API.decodeTransaction, 3)(rawtx).then(v => {
			if (!v.vsize) throw new Error("Could not decode transaction");
			return v.vsize;
		});

	const fee = await repeatAsync(API.estimateFee, 3)().catch(_ => COIN_FEERATE);

	return new N(vsize).div(new N("1000")).mul(fee).toDP(8, N.ROUND_CEIL);
}

export async function estimateBuyFee(consts: PlatformConstants,
	client: typeof Client, orders: FillOrder[]) {
	const { MIN_CHANGE } = consts;

	let defaultAcceptFee = await estimateTxFee(client, "",
		EMPTY_TX_VSIZE + TX_I_VSIZE + 2 * TX_O_VSIZE + OPRETURN_ACCEPT_VSIZE);
	let payFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ (orders.length + 2) * TX_O_VSIZE);

	let acceptFees = orders.reduce((map, v) =>
		map.set(v.address, N.max(defaultAcceptFee, v.minFee)),
		new Map<string, Decimal>());

	return {
		acceptFees, payFee,
		totalFee: dsum([...acceptFees.values()])
			.add(payFee).add(MIN_CHANGE.mul(2)).toDP(8),
	};
}

export async function estimateSellFee(consts: PlatformConstants,
	client: typeof Client, reshufflect: number) {
	const { MIN_CHANGE } = consts;

	let sendFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ TX_O_VSIZE + OPRETURN_SEND_VSIZE);
	let postFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ TX_O_VSIZE + OPRETURN_ORDER_VSIZE);

	return {
		sendFee, postFee,
		totalFee: sendFee.mul(reshufflect).add(postFee).add(MIN_CHANGE).toDP(8),
	};
}

export async function estimateSendFee(consts: PlatformConstants,
	client: typeof Client, sendct: number) {
	const { MIN_CHANGE } = consts;

	let sendFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
		+ TX_O_VSIZE + OPRETURN_SEND_VSIZE);

	return { sendFee, totalFee: sendFee.mul(sendct).add(MIN_CHANGE).toDP(8) };
}

export async function createRawSend(consts: PlatformConstants, client: typeof Client,
	recipient: string, propid: number, amount: Decimal, inUTXO: UTXO, fee: Decimal) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	const payload = await repeatAsync(API.createPayloadSend, 5)
		(propid, amount).catch(_ => {
			throw new Error("Could not create simple send payload");
		});

	const change = new N(inUTXO.amount).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error("Could not create raw send transaction, fee too high");

	const pretx = await repeatAsync(API.createRawTransaction, 3)
		({
			ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
			outs: [{ [recipient]: +change }],
		}).catch(_ => {
			throw new Error("Could not create raw send transaction (part 1)");
		});

	const rawtx = await
		repeatAsync(API.createRawTxOpReturn, 3)(pretx, payload).catch(_ => {
			throw new Error("Could not create raw send transaction (part 2)");
		});

	return rawtx;
}

export async function createRawAccept(consts: PlatformConstants,
	client: typeof Client, seller: string, propid: number, amount: Decimal,
	inUTXO: UTXO, fee: Decimal) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	const payload = await repeatAsync(API.createPayloadAccept, 5)
		(propid, amount).catch(_ => {
			throw new Error("Could not create dex accept payload");
		});

	const change = new N(inUTXO.amount).sub(MIN_CHANGE).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error("Could not create raw accept transaction, fee too high");

	const pretx = await repeatAsync(API.createRawTransaction, 3)
		({
			ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
			outs: [{ [inUTXO.address]: +change }, { [seller]: +MIN_CHANGE }],
		}).catch(_ => {
			throw new Error("Could not create raw accept transaction (part 1)");
		});

	const rawtx = await
		repeatAsync(API.createRawTxOpReturn, 3)(pretx, payload).catch(_ => {
			throw new Error("Could not create raw accept transaction (part 2)");
		});

	return rawtx;
}

export async function createRawPay(consts: PlatformConstants, client: typeof Client,
	orders: { address: string, amount: Decimal }[], inUTXO: UTXO, fee: Decimal) {
	const API = api(client);
	const { MIN_CHANGE, EXODUS_ADDRESS } = consts;

	const total = dsum(orders.map(v => v.amount));
	const change =
		new N(inUTXO.amount).sub(MIN_CHANGE).sub(total).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error(`UTXO not large enough input=${inUTXO.amount},`
			+ ` total=${total}, fee=${fee.add(MIN_CHANGE).toDP(8)}`);

	let outs: RawTxBlueprint["outs"] =
		[{ [inUTXO.address]: +change }, { [EXODUS_ADDRESS]: +MIN_CHANGE }];
	outs.push(...orders.map(order => ({ [order.address]: +order.amount.toDP(8) })));

	const rawtx = await repeatAsync(API.createRawTransaction, 3)({
		ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }], outs: outs
	}).catch(_ => {
		throw new Error("Could not create raw pay transaction");
	});

	return rawtx;
}

export async function createRawOrder(consts: PlatformConstants,
	client: typeof Client, propid: number, action: OrderAction, inUTXO: UTXO,
	fee = new N(0), quantity = new N(0), price = new N(0)) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	const payload = await handlePromise(repeatAsync(API.createPayloadOrder, 5)
		(...[propid, quantity, price, action,
			...(action === OrderAction.ORDER_CANCEL ? [0, 0] : [])]),
		"Could not create payload for raw order transaction");
	if (payload === null) return;

	const change = new N(inUTXO.amount).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error("Could not create raw order transaction, fee too high");

	logger.debug("inUTXO")
	logger.debug(inUTXO)
	logger.debug(`change=${change}`)

	const pretx = await repeatAsync(API.createRawTransaction, 3)({
		ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
		outs: [{ [inUTXO.address]: +change }],
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
		repeatAsync(API.getPayload, 5)(p.txid).then(s => {
			const rawamt = new N(parseInt(s.payload.slice(16), 16));
			return {
				address: p.referenceaddress,
				amount: p.divisible ? rawamt.times(SATOSHI) : rawamt,
			};
		}))).then(arr => arr.reduce((map, v) =>
			map.set(v.address, [...(map.get(v.address) || []), v.amount.neg()]),
			new Map<string, Decimal[]>()), _ => {
				throw new Error("Could not get payload of pending accepts");
			});
}

// Get a list of orders to fill based on the asset ID and quantity
export async function getFillOrders(client: typeof Client, propid: number,
	quantity: Decimal, price?: Decimal, isNoHighFees = true) {
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

	logger.debug("sells")
	logger.debug(sells)

	const pendingTxs = await repeatAsync(API.getPendingTxs, 5)().catch(_ => {
		throw new Error("Could not get pending transactions for orderbook query");
	});

	// Get accepts that are sitting in the mempool so we don't interfere
	const pendingAccepts = await
		getPendingAccepts(client, propid, pendingTxs).catch(_ => {
			throw new Error("Could not get pending accepts for orderbook query");
		});

	logger.debug("pendingAccepts")
	logger.debug(pendingAccepts)

	// Get cancels that are sitting in the mempool as well
	const pendingCancels = await
		repeatAsync(API.getPendingCancels, 3)(propid, pendingTxs).then(cancels =>
			cancels.reduce((map, v) => map.set(v.sendingaddress, true),
				new Map<string, boolean>()), _ => {
					throw new Error("Could not get list of pending sell cancels");
				});

	logger.debug("pendingCancels")
	logger.debug(pendingCancels)

	let fillOrders = [] as FillOrder[];
	let fillRemaining = quantity;

	logger.debug("fill order loop")
	for (let i of sells) {
		if (pendingCancels.has(i.seller)
			|| (isNoHighFees && new N(i.minimumfee).gt(MAX_ACCEPT_FEE))) continue;

		logger.debug("sell")
		logger.debug(i)

		// pendings are negative
		const orderAmount = new N(i.amountavailable)
			.plus(dsum(pendingAccepts.get(i.seller) || []).toDP(8));
		const orderPrice = new N(i.unitprice);

		if (!!price && orderPrice.gt(price)) break;

		if (orderAmount.gte(fillRemaining)) {
			logger.debug("exiting loop")
			fillOrders.push({
				address: i.seller,
				quantity: fillRemaining,
				payAmount: fillRemaining.mul(orderPrice).toDP(8),
				minFee: new N(i.minimumfee),
			});
			break;
		}

		fillOrders.push({
			address: i.seller,
			quantity: orderAmount,
			payAmount: orderAmount.mul(orderPrice).toDP(8),
			minFee: new N(i.minimumfee),
		});
		fillRemaining = fillRemaining.sub(orderAmount);
	}

	return { fillOrders, fillRemaining };
}

// Get a list of addresses and balances that have the property, factoring in pending
// sells, sorted in descending order
export async function getAddressAssets(client: typeof Client, propid: number) {
	const API = api(client);

	// Factor in balances that have pending sells
	const pendingSells = await repeatAsync(API.getPendingTxs, 3)().then(pending =>
		pending.filter(v => v.type === "DEx Sell Offer"
			&& (v as DexOrder).propertyid === propid).reduce((map, v) =>
				map.set(v.sendingaddress, [...(map.get(v.sendingaddress) || []),
				new N((v as DexOrder).amount).neg()]),
				new Map<string, Decimal[]>()), _ => {
					throw new Error("Could not get pending sells for filtering");
				});

	logger.debug("pendingSells")
	logger.debug(pendingSells)

	// Get address asset balances, filter out pending sells, descending
	const addressAssets = await
		repeatAsync(API.getWalletAddressAssets, 3)().then(assets =>
			assets.flatMap(v => v.balances.map(w =>
			({
				address: v.address,
				propertyid: w.propertyid,
				name: w.name,
				balance: new N(w.balance)
					.add(dsum(pendingSells.get(v.address) || [])),
				reserved: new N(w.reserved),
				frozen: new N(w.reserved),
			}))).filter(v =>
				v.propertyid === propid && v.balance.gt(0)).map(v =>
				({
					address: v.address,
					amount: v.balance,
					occupied: v.reserved.gt(0),
					pending: !!pendingSells.get(v.address),
				})).sort((a, b) => +b.amount - +a.amount), _ => {
					throw new Error("Could not obtain wallet address balances");
				});

	return addressAssets;
}

// Accumulate-send omni tokens [a] -> [b] -> [c] -> ... -> [final]
// Sending is performed this way in order to spend fees correctly
export async function chainSend(consts: PlatformConstants, client: typeof Client,
	propid: number, sends: { address: string, amount: N }[], firstUTXO: UTXO,
	finalAddress: string, sendFee: N, waitTXs?: string[]) {
	let utxo = firstUTXO;
	let amount = new N(0);
	for (let i = 0; i < sends.length; i++) {
		const nextAddress = i === sends.length - 1 ?
			finalAddress : sends[i + 1].address;
		amount = amount.add(sends[i].amount);

		logger.debug(`i=${i} nextAddress=${nextAddress} amount=${amount}`)
		logger.debug("createRawSend")
		const rawtx = await createRawSend(consts, client, nextAddress,
			propid, amount, utxo, sendFee).catch(e => {
				handleError(e, "error");
				return null;
			});
		if (rawtx === null) return null;

		const signedtx = await signTx(client, rawtx,
			"Could not sign raw reshuffle transaction for sell");
		if (signedtx === null) return null;

		const sendtx = await sendTx(client, signedtx,
			"Could not send raw reshuffle transaction for sell");
		if (sendtx === null) return null;

		logger.debug("push wait")
		// Push to waiting queue, wait for all then send in order
		if (waitTXs) waitTXs.push(sendtx);

		utxo = toUTXO(sendtx, 0, nextAddress, new N(utxo.amount)
			.sub(sendFee).toDP(8));

		logger.debug("new utxo")
		logger.debug(utxo)
	}

	return { utxo, waitTXs };
}

export function toUTXO(txid: string, vout: number, address: string, amount: Decimal):
	UTXO {
	return {
		txid: txid,
		vout: vout,
		address: address,
		label: "", // unused
		redeemScript: "", // unused
		scriptPubKey: "", // unused
		amount: +amount,
		confirmations: 0, // unused
		spendable: true,
		solvable: true,
		desc: "", // unused
		safe: true,
	};;
}

export async function fundTx(client: typeof Client, rawtx: string,
	options = {} as FundRawOptions, errmsg = "Could not fund raw transaction") {
	logger.debug(`fundtx ${rawtx}`)
	const API = api(client);

	let opts = { ...options };
	if (opts.changeAddress === undefined) {
		const address = await handlePromise(repeatAsync(API.getNewAddress, 5)
			(ACCOUNT_LABEL), `${errmsg} (getnewaddress)`);
		if (address === null) return null;

		logger.debug(`fundtx new address ${address}`)

		opts = { ...opts, changeAddress: address };
	}

	const promise =
		repeatAsync(API.fundRawTransaction, 3)(rawtx, opts).then(v => v.hex);
	return errmsg === null ? promise : handlePromise(promise, errmsg);
}

export function signTx(client: typeof Client, rawtx: string,
	errmsg = "Could not sign raw transaction") {
	logger.debug(`signtx ${rawtx}`)
	return handlePromise(repeatAsync(api(client).signRawTransaction, 3)(rawtx),
		errmsg, v => v.hex);
}

export function sendTx(client: typeof Client, rawtx: string,
	errmsg = "Could not send raw transaction") {
	logger.debug(`sendtx ${rawtx}`)
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
		|| err.message === "Loading block index..."
		|| err.message === "no auth mechanism defined") level = "warn";

	const flog = level === "fatal" ?
		logger.fatal : (level === "error" ?
			logger.error : (level === "warn" ? logger.warn : logger.info));

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

export async function constants(client: typeof Client) {
	const API = api(client);

	const info = await repeatAsync(API.getNetworkInfo, 5)();
	const keys = [{ pattern: "/Feathercoin", key: "FEATHERCOIN" },
	{ pattern: "/Litecoin", key: "LITECOIN" },
	{ pattern: "/Bitcoin", key: "BITCOIN" }];

	for (let { pattern, key } of keys)
		if (info.subversion.startsWith(pattern)) return Platforms[key];

	throw new Error(`Unknown platform ${info.subversion}`);
}

export class Queue<T> {
	queue = [] as T[];
	queueMap = new Map<T, number>();
	mutex = new Mutex();

	constructor(initialData = [] as T[]) {
		this.queue = [...initialData];
		this.queueMap = initialData.reduce((map, v) =>
			map.set(v, (map.get(v) || 0) + 1), new Map<T, number>());
	}

	push = (...x: T[]) => this.mutex.runExclusive(() => {
		this.queue = [...this.queue, ...x];
		this.queueMap = x.reduce((map, v) =>
			map.set(v, (map.get(v) || 0) + 1), this.queueMap);

		return this.queue.length;
	});

	pop = () => this.mutex.runExclusive(() => {
		let x = this.queue.shift();
		if (x !== undefined) {
			if (this.queueMap.get(x) === 1) this.queueMap.delete(x);
			else this.queueMap.set(x, this.queueMap.get(x) - 1);
		}
		return x;
	});

	clear = () => this.mutex.runExclusive(() => {
		const oQueue = [...this.queue];
		const oQueueMap = new Map(this.queueMap);

		this.queue = [];
		this.queueMap = new Map<T, number>();

		return { oldQueue: oQueue, oldQueueMap: oQueueMap };
	});

	has = (x: T) => this.queueMap.has(x);
}