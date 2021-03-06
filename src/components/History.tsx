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
import api from '../api';

import { PROPID_BITCOIN, PROPID_COIN, API_RETRIES_LARGE } from '../constants';
import {
	repeatAsync, handleError, toFormattedAmount, sendOpenLink, notify
} from '../util';

type Data = {
	time: { time: UTCTimestamp, txid?: string },
	status: string,
	idBuy: number,
	idSell: number,
	quantity: number,
	price: number,
	fee: number,
	total: number,
};

const History = () => {
	const {
		consts, settings, getClient, refreshTrades
	} = React.useContext(AppContext);
	const [data, setData] = React.useState<Data[]>([]);

	const { show } = useContextMenu();

	const onContextMenu = (event: React.MouseEvent) => {
		event.preventDefault();
		show(event, { id: event.currentTarget.id });
	};

	const columns: Column<Record<string, any>>[] = React.useMemo(() => settings ? [
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
						<span id={`history-time-${v.txid}`} title={v.txid}
							onContextMenu={onContextMenu}>
							{time}
						</span>
						<Menu id={`history-time-${v.txid}`} theme={theme.dark}
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
			width: 80,
			Cell: props => props.value,
		},
		{
			Header: 'Asset Buy ID',
			accessor: 'idBuy',
			width: 80,
			Cell: props => props.value === PROPID_BITCOIN ? <i>BTC</i> :
				(props.value === PROPID_COIN ?
					<i>{consts?.COIN_TICKER ?? "-"}</i> : <b>{props.value}</b>),
		},
		{
			Header: 'Asset Sell ID',
			accessor: 'idSell',
			width: 80,
			Cell: props => props.value === PROPID_BITCOIN ? <i>BTC</i> :
				(props.value === PROPID_COIN ?
					<i>{consts?.COIN_TICKER ?? "-"}</i> : <b>{props.value}</b>),
		},
		{
			Header: 'Quantity',
			accessor: 'quantity',
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
	] : [], [consts, settings]);

	const refreshData = async () => {
		const client = getClient();
		if (client === null || consts === null) return;

		const API = api(client);
		const { COIN_MARKET } = consts;

		// oldest to newest here
		let myTrades = await refreshTrades().then(trades =>
			trades.filter(trade => trade.isMine), e => {
				handleError(e, "error");
				return null as AssetTrade[];
			});
		if (myTrades === null) return;

		// Open sell orders on exchange
		const dexSells: Record<string, DexSell> = await
			repeatAsync(API.getExchangeSells, API_RETRIES_LARGE)().then(sells =>
				Object.assign({}, ...sells.map(s => ({ [s.txid]: s }))), e => {
					handleError(e, "error");
					return null;
				});
		if (dexSells === null) return;

		// operate on trades in reverse order
		let historyData = myTrades.reduceRight(({ cancels, tradeData }, trade) => {
			// Skip open sells
			if (dexSells[trade.txid]) return { cancels, tradeData };
			
			// Skip and record cancellations
			if (trade.status === "CANCELED")
				return {
					cancels: cancels.set(trade.address,
						(cancels.get(trade.address) || 0) + 1),
					tradeData
				};

			let cancel = false;
			if (cancels.get(trade.address)) {
				cancel = true;
				cancels.set(trade.address, cancels.get(trade.address) - 1);
			}

			tradeData.push({
				time: { time: trade.time, txid: trade.txid },
				status: cancel ? "CANCELED" : trade.status,
				idBuy: trade.idBuy,
				idSell: trade.idSell,
				quantity: +trade.quantity,
				price: +trade.amount.div(trade.quantity).toDP(8),
				fee: +trade.fee,
				total: +trade.amount.add(trade.fee),
			});

			return { cancels, tradeData };
		}, {
			cancels: new Map<string, number>(),
			tradeData: [] as Data[],
		}).tradeData;

		let bittrexData: Data[] = [];
		const apiKey = settings.apikey, apiSecret = settings.apisecret;
		if (apiKey.length > 0 && apiSecret.length > 0) {
			bittrexData = (await repeatAsync(API.getBittrexHistory,
				API_RETRIES_LARGE)(apiKey, apiSecret, COIN_MARKET).catch(e => {
					handleError(e, "error");
					return [] as BittrexOrder[];
				})).map(v => ({
					time: {
						time: Math.floor(DateTime.fromISO(v.closedAt)
							.toSeconds()) as UTCTimestamp
					},
					status: v.status,
					idBuy: v.direction === "BUY" ? PROPID_COIN : PROPID_BITCOIN,
					idSell: v.direction === "SELL" ? PROPID_COIN : PROPID_BITCOIN,
					quantity: parseFloat(v.fillQuantity),
					price: +(new N(v.proceeds).sub(new N(v.commission))
						.div(new N(v.fillQuantity)).toDP(8)),
					fee: parseFloat(v.commission),
					total: parseFloat(v.proceeds),
				}));
		}

		setData(historyData.concat(bittrexData).sort((a, b) =>
			b.time.time - a.time.time));
	}

	React.useEffect(() => { refreshData(); }, []);
	useInterval(refreshData, 5000);

	return data && data.length > 0 ?
		<Table className="history-table" columns={columns} data={data} /> :
		<div className="empty" style={{ fontSize: 12 }}>No history</div>;
};

export default History;
