"use strict";

import React from 'react';
import useInterval from 'use-interval';
import N from 'decimal.js';

import { ipcRenderer } from 'electron';
import { Column } from 'react-table';
import { DateTime } from 'luxon';
import { UTCTimestamp } from 'lightweight-charts';
import { Menu, Item, useContextMenu, theme } from 'react-contexify';

import AppContext from './contexts/AppContext';
import Table from './Table';
import useTimeCache from './timecache';
import api from './api';

import {
	PROPID_BITCOIN, PROPID_COIN, OMNI_EXPLORER_ENDPOINT, COIN_EXPLORER_ENDPOINT,
	EMPTY_TX_VSIZE, TX_I_VSIZE, TX_O_VSIZE, OPRETURN_ORDER_VSIZE, OrderAction
} from './constants';
import {
	handleError, handlePromise, repeatAsync, waitForTx, createRawOrder,
	estimateTxFee, fundTx, signTx, sendTx, toUTXO, toFormattedAmount, toTradeInfo,
	notify, sendOpenLink, Queue, log
} from './util';

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
		settings, getClient, getConstants, getPendingOrders
	} = React.useContext(AppContext);
	const [data, setData] = React.useState<Data[]>([]);
	const [active, setActive] = React.useState<string[]>([]);
	const cancelledOrders = React.useMemo(() => new Queue<string>(), []);

	const { show } = useContextMenu();

	const myTradesCache = useTimeCache((ts, te) => {
		const client = getClient();
		return !!client ?
			api(client).listMyAssetTrades(getConstants().COIN_NAME, ts, te) : null
	}, t => t.block);

	const onContextMenu = (event: React.MouseEvent<HTMLSpanElement, MouseEvent>) => {
		event.preventDefault();
		show(event, { id: event.currentTarget.id });
	}

	const columns: Column<Record<string, any>>[] = React.useMemo(() => {
		const { COIN_OMNI_NAME, COIN_NAME, COIN_TICKER } = getConstants();
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
	},
		[settings]
	);

	const sendCancel = async (trade: AssetTrade) => {
		const logger = log();
		const client = getClient();
		const API = api(client);
		const consts = getConstants();
		const { MIN_CHANGE } = consts;

		let cancelFee: Decimal = await estimateTxFee(client, "", EMPTY_TX_VSIZE
			+ TX_I_VSIZE + TX_O_VSIZE + OPRETURN_ORDER_VSIZE).catch(e => {
				handleError(e, "error");
				return null;
			});
		if (cancelFee === null) return;

		logger.debug(`cancelFee=${cancelFee}`)

		const utxos = await
			handlePromise(repeatAsync(API.listUnspent, 3)([trade.address]),
				"Failed to get address utxos for cancel transaction");
		if (utxos === null) return;

		let utxo = utxos.find(v => new N(v.amount).gte(cancelFee.add(MIN_CHANGE)));

		// If there is not a sufficient UTXO we must make one
		if (!utxo) {
			const pretx = await
				handlePromise(repeatAsync(API.createRawTransaction, 3)
					({
						ins: [],
						outs: [{
							[trade.address]: +cancelFee.add(MIN_CHANGE).toDP(8),
						}]
					}),
					"Could not create raw transaction for cancel fee funding");
			if (pretx === null) return;

			const rawtx = await fundTx(client, pretx, { changePosition: 1 },
				"Could not fund raw transaction for cancel fee funding");
			if (rawtx === null) return;

			const signedtx = await signTx(client, rawtx,
				"Could not sign raw transaction for cancel fee funding");
			if (signedtx === null) return;

			const sendtx = await sendTx(client, signedtx,
				"Could not send transaction for cancel fee funding");
			if (sendtx === null) return;

			utxo = toUTXO(sendtx, 0, trade.address, cancelFee.add(MIN_CHANGE));
		}

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
		const API = api(getClient());
		const { OMNI_START_HEIGHT, COIN_MARKET } = getConstants();

		const blockHeight = await
			handlePromise(repeatAsync(API.getBlockchainInfo, 5)(),
				"Could not get blockchain info").then(v => v.blocks);
		if (blockHeight === null) return;

		let pendingTxs = await handlePromise(repeatAsync(API.getPendingTxs, 3)(),
			"Could not get pending transactions");
		if (pendingTxs === null) pendingTxs = [];

		const pendingCancels: Record<string, boolean> =
			Object.assign({}, ...pendingTxs.filter(v =>
				v.type === "DEx Sell Offer"
				&& (v as DexOrder).action === "cancel").map(v =>
					({ [v.sendingaddress]: true })));

		const pendingData: Data[] = getPendingOrders().map(v => {
			return {
				cancel: v.finalizing ? <></> : <a href="#" onClick={() => {
					v.cancel();
					notify("success", "Canceled pending order",
						`Canceled order ${toTradeInfo(getConstants(), v)}`);
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
							.then(v => notify("success",
								"Cancelled order", toTradeInfo(getConstants(), v))),
							"Failed to cancel Bittrex order "
							+ toTradeInfo(getConstants(), v))
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
