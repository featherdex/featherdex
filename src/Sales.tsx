"use strict";

import React from 'react';
import styled from 'styled-components';

import { ipcRenderer } from 'electron';
import { Column } from 'react-table';
import { DateTime } from 'luxon';
import { UTCTimestamp } from 'lightweight-charts';
import { Menu, Item, useContextMenu, theme } from 'react-contexify';

import AssetSearch from './AssetSearch';
import AppContext from './contexts/AppContext';
import Table from './Table';
import api from './api';

import {
	PROPID_BITCOIN, PROPID_COIN, OMNI_EXPLORER_ENDPOINT, COIN_EXPLORER_ENDPOINT
} from './constants';
import {
	handlePromise, repeatAsync, handleError, toFormattedAmount, sendOpenLink, notify
} from './util';

type TradeColor = "green" | "red" | "none";

type Data = {
	time: { time: UTCTimestamp, txid?: string },
	status: string,
	quantity: { color: TradeColor, quantity: number },
	price: { color: TradeColor, price: number },
	fee: { color: TradeColor, fee: number },
	total: { color: TradeColor, total: number },
};

const C = {
	SalesContainer: styled.div`
	display: flex;
	height: 27.5px;
	margin-bottom: 2px;`,
	SalesSearch: styled.div`flex: 1;`,
	SalesLabel: styled.div`
	display: flex;
    flex-direction: column;
    justify-content: center;
	padding-right: 1em;
	font-size: 9pt;`,
	SalesText: styled.div` 
	display: flex;
    flex-direction: column;
    justify-content: center;
    padding-right: 4px;
	font-size: 12pt;
	font-family: monospace !important;`,
};

const Sales = () => {
	const {
		settings, getClient, getConstants, refreshTrades
	} = React.useContext(AppContext);

	const [id, setID] = React.useState(-1);
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
			width: 160,
			Cell: (props: Record<string, any>) => {
				if (!props.value) return "";

				const v = props.value;
				const time = v.time ?
					DateTime.fromSeconds(v.time).toISO().replace("T",
						" ").slice(0, -10) + " UTC" : "";

				if (!v.txid) return <span>{time}</span>;
				else {
					const { COIN_OMNI_NAME, COIN_NAME } = getConstants();

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
			Header: 'Quantity',
			accessor: 'quantity',
			width: 80,
			Cell: props => toFormattedAmount(props.value.quantity,
				settings.numformat, 8, "decimal", props.value.color),
		},
		{
			Header: 'Price',
			accessor: 'price',
			width: 80,
			Cell: props => toFormattedAmount(props.value.price,
				settings.numformat, 8, "decimal", props.value.color),
		},
		{
			Header: 'Fee',
			accessor: 'fee',
			width: 75,
			Cell: props => toFormattedAmount(props.value.fee,
				settings.numformat, 8, "decimal", props.value.color),
		},
		{
			Header: 'Total',
			accessor: 'total',
			width: 130,
			Cell: props => toFormattedAmount(props.value.total,
				settings.numformat, 8, "decimal", props.value.color),
		},
	] : [],
		[settings]
	);

	const refreshData = async () => {
		if (id < PROPID_COIN) return;

		const API = api(getClient());
		const { OMNI_START_HEIGHT, COIN_MARKET } = getConstants();

		const height = await handlePromise(repeatAsync(API.getBlockchainInfo, 5)(),
			"Could not get blockchain info", v => v.blocks);

		let tradeData: Data[] = [];

		if (id > PROPID_COIN) {
			// Second check needed for constants not updating in time
			if (height === null || height < OMNI_START_HEIGHT) return;

			let trades: AssetTrade[] = await refreshTrades().then(a => [...a], e => {
				handleError(e, "error");
				return null;
			});
			if (trades === null) return;

			trades.reverse();

			tradeData = trades.filter(trade => trade.idBuy === id).map(v => ({
				time: { time: v.time, txid: v.txid },
				status: v.status,
				quantity: { color: "none", quantity: v.quantity },
				price: { color: "none", price: v.amount / v.quantity },
				fee: { color: "none", fee: v.fee },
				total: { color: "none", total: v.amount + v.fee },
			}));
		} else {
			tradeData = (await API.getBittrexMktHistory(COIN_MARKET).catch((err) => {
				handleError(err);
				return [] as BittrexTrade[];
			})).map(v => {
				const clr: TradeColor = v.takerSide === "BUY" ?
					"green" : v.takerSide === "SELL" ? "red" : "none";
				return {
					time: {
						time: Math.floor(DateTime.fromISO(v.executedAt)
							.toSeconds()) as UTCTimestamp
					},
					status: "CLOSED",
					quantity: { color: clr, quantity: parseFloat(v.quantity) },
					price: { color: clr, price: parseFloat(v.rate) },
					fee: { color: clr, fee: 0 },
					total: {
						color: clr,
						total: parseFloat(v.quantity) * parseFloat(v.rate)
					},
				}
			});
		}

		setData(tradeData);
	}

	React.useEffect(() => { refreshData(); }, [id]);

	return <>
		<C.SalesContainer>
			<C.SalesLabel>Trade asset:</C.SalesLabel>
			<C.SalesSearch>
				<AssetSearch setAssetCallback={setID} zIndex={2} />
			</C.SalesSearch>
			<div className="chart-hspace"></div>
			<C.SalesLabel>Base asset:</C.SalesLabel>
			<C.SalesText>
				{id === PROPID_COIN ?
					getConstants().COIN_BASE_TICKER :
					getConstants().COIN_TICKER}
			</C.SalesText>
			<div className="chart-hspace"></div>
			<label className="chart-button">
				<input type="button" name="refresh" onClick={refreshData} />
				<span className="checkmark">&#128472;</span>
			</label>
		</C.SalesContainer>
		{id === -1 ?
			<div className="empty" style={{ fontSize: 12 }}>
				Select assets to see trades
			</div> : id === PROPID_BITCOIN ?
				<div className="empty" style={{ fontSize: 12 }}>
					Invalid selection
				</div> : (!data || data.length === 0 ?
					<div className="empty" style={{ fontSize: 12 }}>
						No trades
					</div> :
					<Table className="sales-table" columns={columns} data={data} />)
		}
	</>;
};

export default Sales;
