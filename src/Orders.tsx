"use strict";

import React from 'react';
import useInterval from 'use-interval';

import { Column } from 'react-table';
import { DateTime } from 'luxon';
import { UTCTimestamp } from 'lightweight-charts';

import AppContext from './contexts/AppContext';
import Table from './Table';
import useTimeCache from './timecache';
import api from './api';

import {
	PROPID_BITCOIN, PROPID_FEATHERCOIN, OMNI_START_HEIGHT, SATOSHI, MIN_CHANGE,
	EMPTY_TX_VSIZE, TX_I_VSIZE, TX_O_VSIZE, OPRETURN_ORDER_VSIZE, OrderAction
} from './constants';

import {
	handleError, handlePromise, repeatAsync, waitForTx, createRawOrder, roundn,
	estimateTxFee, fundTx, signTx, sendTx, toUTXO, toFormattedAmount, toTradeInfo,
	notify, useQueue, log
} from './util';

export type Data = {
	cancel: JSX.Element | string,
	time: UTCTimestamp,
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
	const { settings, client, pendingOrders } = React.useContext(AppContext);
	const [data, setData] = React.useState<Data[]>([]);
	const [active, setActive] = React.useState<string[]>([]);
	const canceledOrders = useQueue<string>([]);

	const myTradesCache = useTimeCache((ts, te) =>
		!!client ? api(client).listMyAssetTrades(ts, te) : null, t => t.block);

	const columns: Column<Record<string, any>>[] = React.useMemo(() => settings ? [
		{
			Header: '',
			accessor: 'cancel',
			width: 40,
		},
		{
			Header: 'Time',
			accessor: 'time',
			width: 145,
			Cell: (props: Record<string, any>) =>
				props.value ? DateTime.fromSeconds(props.value).toISO()
					.replace("T", " ").slice(0, -10) + " UTC" : "",
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
				(props.value === PROPID_FEATHERCOIN ? <i>FTC</i> :
					<b>{props.value}</b>),
		},
		{
			Header: 'Asset Sell ID',
			accessor: 'idSell',
			width: 80,
			Cell: props => props.value === PROPID_BITCOIN ? <i>BTC</i> :
				(props.value === PROPID_FEATHERCOIN ? <i>FTC</i> :
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
	] : [],
		[settings]
	);

	const sendCancel = async (trade: AssetTrade) => {
		const API = api(client);

		let cancelFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE + TX_I_VSIZE
			+ TX_O_VSIZE + OPRETURN_ORDER_VSIZE).catch(e => {
				handleError(e, "error");
				return null;
			});
		if (cancelFee === null) return;

		log.debug(`cancelFee=${cancelFee}`)

		const utxos = await
			handlePromise(repeatAsync(API.listUnspent, 3)([trade.address]),
				"Failed to get address utxos for cancel transaction");
		if (utxos === null) return;

		let utxo = utxos.find(v => v.amount >= cancelFee + MIN_CHANGE);

		// If there is not a sufficient UTXO we must make one
		if (!utxo) {
			const pretx = await
				handlePromise(repeatAsync(API.createRawTransaction, 3)
					({
						ins: [],
						outs: [{ [trade.address]: cancelFee + MIN_CHANGE }]
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

			utxo = toUTXO(sendtx, 0, trade.address, cancelFee + MIN_CHANGE);
		}

		log.debug("utxo");
		log.debug(utxo);

		let canceltx;
		{
			const errmsg = `Failed to cancel order ${toTradeInfo(trade)}`;

			const rawtx = await createRawOrder(client, trade.idSell,
				OrderAction.ORDER_CANCEL, utxo, cancelFee);
			if (rawtx === null) return;

			const signedtx = await signTx(client, rawtx, `${errmsg} (sign)`);
			if (signedtx === null) return;

			canceltx = await sendTx(client, signedtx, `${errmsg} (send)`);
			if (canceltx === null) return;
		}

		waitForTx(client, canceltx).then(_ => {
			canceledOrders.push(trade.txid);
			notify("success", "Cancelled order",
				`Cancelled order ${toTradeInfo(trade)}`);
		});
		notify("info", "Order cancellation sent",
			`Sent in cancellation for order ${toTradeInfo(trade)}`);
	}

	const refreshData = async () => {
		const API = api(client);

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

		const pendingData: Data[] = pendingOrders.map(v => {
			return {
				cancel: v.finalizing ? <></> : <a href="#" onClick={() => {
					v.cancel();
					notify("success", "Canceled pending order",
						`Canceled order ${toTradeInfo(v)}`);
				}}>Cancel</a>,
				time: v.time,
				status: v.status,
				idBuy: v.buysell === "buy" ? v.id : PROPID_FEATHERCOIN,
				idSell: v.buysell === "sell" ? v.id : PROPID_FEATHERCOIN,
				quantity: v.quantity,
				remaining: v.remaining,
				price: v.price,
				fee: v.fee,
				total: v.quantity * v.price
					+ (v.buysell === "sell" ? -v.fee : v.fee),
			};
		});

		const oldCancelled = await canceledOrders.clear();
		let myTrades = [...await myTradesCache.refresh(OMNI_START_HEIGHT,
			blockHeight, trade => oldCancelled.oldQueueMap.has(trade.txid))];
		myTrades.reverse();

		const historyData: Data[] = myTrades.filter((v: AssetTrade) =>
			v.status === "OPEN").map((v: AssetTrade) =>
			({
				cancel: <a href="#" onClick={() => sendCancel(v)}> Cancel</a>,
				time: v.time,
				status: pendingCancels[v.address] ? "CANCELING" : v.status,
				idBuy: v.idBuy,
				idSell: v.idSell,
				quantity: v.quantity,
				remaining: v.remaining,
				price: v.amount / v.quantity,
				fee: v.fee,
				total: v.amount + v.fee,
			}));

		let bittrexData: Data[] = [];

		if (settings.apikey.length > 0 && settings.apisecret.length > 0)
			bittrexData = (await
				API.getBittrexOrders(settings.apikey, settings.apisecret)
					.catch(err => {
						handleError(err);
						return [] as BittrexOrder[];
					})).map((v: BittrexOrder) =>
					({
						cancel: <a href="#" onClick={() =>
							handlePromise(repeatAsync(API.cancelBittrexOrder, 3)
								(settings.apikey, settings.apisecret, v.id)
								.then(v => notify("success",
									"Canceled order", toTradeInfo(v))),
								`Failed to cancel Bittrex order ${toTradeInfo(v)}`)
						}>Cancel</a>,
						time: Math.floor(DateTime.fromISO(v.createdAt)
							.toSeconds()) as UTCTimestamp,
						status: "PLACED",
						idBuy: v.direction === "BUY" ?
							PROPID_FEATHERCOIN : PROPID_BITCOIN,
						idSell: v.direction === "SELL" ?
							PROPID_FEATHERCOIN : PROPID_BITCOIN,
						quantity: parseFloat(v.quantity),
						remaining: parseFloat(v.quantity)
							- parseFloat(v.fillQuantity),
						price: parseFloat(v.limit),
						fee: parseFloat(v.commission),
						total: parseFloat(v.limit)
							* parseFloat(v.fillQuantity),
					}));

		setData(pendingData.concat(historyData).concat(bittrexData)
			.sort((a, b) => b.time - a.time));

		// Clear out old filled orders
		const dexTXs = await handlePromise(repeatAsync(API.getExchangeSells, 3)(),
			"Could not get active sells for clearing out old filled orders", arr =>
			arr.map(v => v.txid));

		let remove: string[] = [];
		setActive(oldActive => {
			const newMap = dexTXs.reduce((map, v) =>
				map.set(v, true), new Map<string, boolean>());
			remove = oldActive.filter(v => !newMap.has(v));
			return dexTXs;
		});

		canceledOrders.push(...remove);
	}

	React.useEffect(() => { refreshData(); }, []);
	useInterval(refreshData, 3000);

	if (data && data.length > 0)
		return <Table className="orders-table" columns={columns} data={data} />;
	else
		return <div className="empty" style={{ fontSize: 12 }}>
			No open orders
		</div>;
};

export default Orders;
