"use strict";

import React from 'react';
import useInterval from 'use-interval';
import N from 'decimal.js';

import { ipcRenderer } from 'electron';
import { Column } from 'react-table';
import { DateTime } from 'luxon';
import { UTCTimestamp } from 'lightweight-charts';
import { Menu, Item, useContextMenu, theme } from 'react-contexify';

import AppContext from '../contexts/AppContext';
import Table from './Table';
import useTimeCache from '../timecache';
import api from '../api';

import {
	PROPID_BITCOIN, PROPID_COIN, EMPTY_TX_VSIZE, IN_P2PKH_VSIZE, IN_P2WSH_VSIZE,
	OUT_P2PKH_VSIZE, OUT_P2WSH_VSIZE, OPRET_ORDER_VSIZE, TYPE_SELL_OFFER, OrderAction
} from '../constants';
import {
	handleError, handlePromise, repeatAsync, waitForTx, createRawOrder,
	estimateTxFee, fundAddress, signTx, sendTx, toFormattedAmount, toTradeInfo,
	getAddressType, notify, sendAlert, sendOpenLink, log
} from '../util';
import { Queue } from '../queue';

export type Data = {
	cancel: JSX.Element | string,
	time: { time: UTCTimestamp, txid?: string },
	status: string,
	idBuy: number,
	idSell: number,
	quantity: number,
	remaining: number,
	price: number,
	fee: number,
	total: number,
};

const Orders = () => {
	const {
		consts, settings, getClient, getPendingOrders
	} = React.useContext(AppContext);
	const [data, setData] = React.useState<Data[]>([]);
	const [active, setActive] = React.useState<string[]>([]);
	const cancelledOrders = React.useMemo(() => new Queue<string>(), []);

	const { show } = useContextMenu();

	const myTradesCache = useTimeCache((ts, te) => {
		const client = getClient();
		return !!client ? api(client).listMyAssetTrades(ts, te) : null
	}, t => t.block);

	const onContextMenu = (event: React.MouseEvent<HTMLSpanElement, MouseEvent>) => {
		event.preventDefault();
		show(event, { id: event.currentTarget.id });
	}

	const columns: Column<Record<string, any>>[] = React.useMemo(() => {
		const { COIN_TICKER = "-" } = (consts ?? {});
		return settings ? [
			{
				Header: '',
				accessor: 'cancel',
				width: 40,
			},
			{
				Header: 'Time',
				accessor: 'time',
				width: 145,
				Cell: (props: Record<string, any>) => {
					if (!props.value) return "";

					const v = props.value;
					const time = v.time ?
						DateTime.fromSeconds(v.time).setLocale(settings.numformat)
							.toLocaleString({
								...DateTime.DATE_SHORT,
								...DateTime.TIME_24_WITH_SHORT_OFFSET,
								month: "2-digit",
								day: "2-digit",
							}) : "";

					if (!v.txid) return <span>{time}</span>;
					else {
						const {
							COIN_OMNI_NAME = "Omni", COIN_NAME = "Coin",
							OMNI_EXPLORER_ENDPOINT = "", COIN_EXPLORER_ENDPOINT = ""
						} = (consts ?? {});

						const onOmni = () =>
							sendOpenLink(`${OMNI_EXPLORER_ENDPOINT}/tx/${v.txid}`);
						const onFeather = () =>
							sendOpenLink(`${COIN_EXPLORER_ENDPOINT}/tx/${v.txid}`);

						return <>
							<span id={`orders-time-${v.txid}`} title={v.txid}
								onContextMenu={onContextMenu}>
								{time}
							</span>
							<Menu id={`orders-time-${v.txid}`} theme={theme.dark}
								animation={false}>
								<Item onClick={() => {
									ipcRenderer.send("clipboard:copy", v.txid);
									notify("success", "Copied txid to clipboard",
										`Copied ${v.txid} to clipboard`);
								}}>
									Copy Transaction ID to clipboard...
								</Item>
								<Item onClick={onOmni}>
									Open in {COIN_OMNI_NAME} Explorer...
								</Item>
								<Item onClick={onFeather}>
									Open in {COIN_NAME} Explorer...
								</Item>
							</Menu>
						</>;
					}
				},
			},
			{
				Header: 'Status',
				accessor: 'status',
				width: 60,
				Cell: props => props.value,
			},
			{
				Header: 'Asset Buy ID',
				accessor: 'idBuy',
				width: 80,
				Cell: props => props.value === PROPID_BITCOIN ? <i>BTC</i> :
					(props.value === PROPID_COIN ? <i>{COIN_TICKER}</i> :
						<b>{props.value}</b>),
			},
			{
				Header: 'Asset Sell ID',
				accessor: 'idSell',
				width: 80,
				Cell: props => props.value === PROPID_BITCOIN ? <i>BTC</i> :
					(props.value === PROPID_COIN ? <i>{COIN_TICKER}</i> :
						<b>{props.value}</b>),
			},
			{
				Header: 'Quantity',
				accessor: 'quantity',
				width: 80,
				Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
					"decimal", "none"),
			},
			{
				Header: 'Remaining',
				accessor: 'remaining',
				width: 80,
				Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
					"decimal", "none"),
			},
			{
				Header: 'Price',
				accessor: 'price',
				width: 80,
				Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
					"decimal", "none"),
			},
			{
				Header: 'Fee',
				accessor: 'fee',
				width: 75,
				Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
					"decimal", "none"),
			},
			{
				Header: 'Total',
				accessor: 'total',
				width: 90,
				Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
					"decimal", "none"),
			},
		] : []
	}, [consts, settings]);

	const sendCancel = async (trade: AssetTrade) => {
		const logger = log();

		const client = getClient();
		if (client === null || consts === null) {
			sendAlert("Client not initialized");
			return;
		}

		const { MIN_CHANGE } = consts;

		let cancelSize = EMPTY_TX_VSIZE.add(OPRET_ORDER_VSIZE);
		if (getAddressType(consts, trade.address) === "leg")
			cancelSize = cancelSize.add(IN_P2PKH_VSIZE).add(OUT_P2PKH_VSIZE);
		else cancelSize = cancelSize.add(IN_P2WSH_VSIZE).add(OUT_P2WSH_VSIZE);

		const cancelFee = await estimateTxFee(client, "", cancelSize).catch(e => {
			handleError(e, "error");
			return null as N;
		});
		if (cancelFee === null) return;

		logger.debug(`cancelFee=${cancelFee}`)

		// Fund the cancel transaction
		const utxo = await
			fundAddress(client, cancelFee.add(MIN_CHANGE).toDP(8), trade.address);
		if (utxo === null) return;

		logger.debug("utxo");
		logger.debug(utxo);

		let canceltx;
		{
			const errmsg = `Failed to cancel order ${toTradeInfo(consts, trade)}`;

			const rawtx = await createRawOrder(consts, client, trade.idSell,
				OrderAction.ORDER_CANCEL, utxo, cancelFee);
			if (rawtx === null) return;

			const signedtx = await signTx(client, rawtx, `${errmsg} (sign)`);
			if (signedtx === null) return;

			canceltx = await sendTx(client, signedtx, `${errmsg} (send)`);
			if (canceltx === null) return;
		}

		waitForTx(client, canceltx).then(_ => {
			cancelledOrders.push(trade.txid);
			notify("success", "Cancelled order",
				`Cancelled order ${toTradeInfo(consts, trade)}`);
		});
		notify("info", "Order cancellation sent",
			`Sent in cancellation for order ${toTradeInfo(consts, trade)}`);
	}

	const refreshData = async () => {
		const client = getClient();
		if (client === null || consts === null) return;

		const API = api(client);
		const { OMNI_START_HEIGHT, COIN_MARKET } = consts;

		const blockHeight = await
			handlePromise(repeatAsync(API.getBlockchainInfo, 5)(),
				"Could not get blockchain info").then(v => v.blocks);
		if (blockHeight === null) return;

		let pendingTxs = await handlePromise(repeatAsync(API.getPendingTxs, 3)(),
			"Could not get pending transactions");
		if (pendingTxs === null) pendingTxs = [];

		const pendingCancels: Record<string, boolean> =
			Object.assign({}, ...pendingTxs.filter(v =>
				v.type_int === TYPE_SELL_OFFER
				&& (v as DexOrder).action === "cancel").map(v =>
					({ [v.sendingaddress]: true })));

		const pendingData: Data[] = getPendingOrders().map(v => {
			return {
				cancel: v.finalizing ? <></> : <a href="#" onClick={() => {
					v.cancel();
					notify("success", "Canceled pending order",
						`Canceled order ${toTradeInfo(consts, v)}`);
				}}>Cancel</a>,
				time: { time: v.time },
				status: v.status,
				idBuy: v.buysell === "buy" ? v.id : PROPID_COIN,
				idSell: v.buysell === "sell" ? v.id : PROPID_COIN,
				quantity: +v.quantity,
				remaining: +v.remaining,
				price: +v.price,
				fee: +v.fee,
				total: +v.quantity.mul(v.price).add(v.buysell === "sell" ?
					v.fee.neg() : v.fee).toDP(8),
			};
		});

		const oldCancelled = await cancelledOrders.clear();
		let myTrades = [...await myTradesCache.refresh(OMNI_START_HEIGHT,
			blockHeight, trade => oldCancelled.oldQueueMap.has(trade.txid))];
		myTrades.reverse();

		const historyData: Data[] = myTrades.filter((v: AssetTrade) =>
			v.status === "OPEN").map((v: AssetTrade) =>
			({
				cancel: <a href="#" onClick={() => sendCancel(v)}> Cancel</a>,
				time: { time: v.time, txid: v.txid },
				status: pendingCancels[v.address] ? "CANCELING" : v.status,
				idBuy: v.idBuy,
				idSell: v.idSell,
				quantity: +v.quantity,
				remaining: +v.remaining,
				price: +v.amount.div(v.quantity),
				fee: +v.fee,
				total: +v.amount.add(v.fee),
			}));

		let bittrexData: Data[] = [];

		if (settings.apikey.length > 0 && settings.apisecret.length > 0)
			bittrexData = (await API.getBittrexOrders(settings.apikey,
				settings.apisecret, COIN_MARKET).catch(err => {
					handleError(err);
					return [] as BittrexOrder[];
				})).map((v: BittrexOrder) =>
				({
					cancel: <a href="#" onClick={() =>
						handlePromise(repeatAsync(API.cancelBittrexOrder, 3)
							(settings.apikey, settings.apisecret, v.id)
							.then(o => notify("success", "Cancelled order",
								toTradeInfo(consts, o))),
							"Failed to cancel Bittrex order "
							+ toTradeInfo(consts, v))
					}>Cancel</a>,
					time: {
						time: Math.floor(DateTime.fromISO(v.createdAt)
							.toSeconds()) as UTCTimestamp
					},
					status: "PLACED",
					idBuy: v.direction === "BUY" ? PROPID_COIN : PROPID_BITCOIN,
					idSell: v.direction === "SELL" ? PROPID_COIN : PROPID_BITCOIN,
					quantity: parseFloat(v.quantity),
					remaining: parseFloat(v.quantity) - parseFloat(v.fillQuantity),
					price: parseFloat(v.limit),
					fee: parseFloat(v.commission),
					total: parseFloat(v.limit) * parseFloat(v.fillQuantity),
				}));

		setData(pendingData.concat(historyData).concat(bittrexData)
			.sort((a, b) => b.time.time - a.time.time));

		// Clear out old filled orders
		const dexTXs = await handlePromise(repeatAsync(API.getExchangeSells, 3)(),
			"Could not get active sells for clearing out old filled orders", arr =>
			arr.map(v => v.txid));

		setActive(oldActive => {
			const newMap = dexTXs.reduce((map, v) =>
				map.set(v, true), new Map<string, boolean>());
			cancelledOrders.push(...oldActive.filter(v => !newMap.has(v)));
			return dexTXs;
		});
	}

	React.useEffect(() => { refreshData(); }, [settings]);
	useInterval(refreshData, 5000);

	if (data && data.length > 0)
		return <Table className="orders-table" columns={columns} data={data} />;
	else
		return <div className="empty" style={{ fontSize: 12 }}>
			No open orders
		</div>;
};

export default Orders;
