"use strict";

import React from 'react';
import useInterval from 'use-interval';

import { Column } from 'react-table';
import { DateTime } from 'luxon';
import { UTCTimestamp } from 'lightweight-charts';

import AppContext from './contexts/AppContext';
import useTimeCache from './timecache';
import Table from './Table';
import api from './api';

import { PROPID_BITCOIN, PROPID_FEATHERCOIN, OMNI_START_HEIGHT } from './constants';
import { handlePromise, repeatAsync, handleError, toFormattedAmount } from './util';

type Data = {
	time: UTCTimestamp,
	status: string,
	idBuy: number,
	idSell: number,
	quantity: number,
	price: number,
	fee: number,
	total: number,
};

const History = () => {
	const { settings, client } = React.useContext(AppContext);
	const [data, setData] = React.useState<Data[]>([]);

	const myTradesCache = useTimeCache((ts, te) =>
		!!client ? api(client).listMyAssetTrades(ts, te) : null, t => t.block);

	const columns: Column<Record<string, any>>[] = React.useMemo(() => settings ? [
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
			width: 80,
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

	const refreshData = async () => {
		const API = api(client);

		const blockHeight = await
			handlePromise(repeatAsync(API.getBlockchainInfo, 5)(),
				"Could not get blockchain info").then(v => v.blocks);

		if (blockHeight === null) return;

		let myTrades =
			[...await myTradesCache.refresh(OMNI_START_HEIGHT, blockHeight)];
		myTrades.reverse();

		const historyData: Data[] = myTrades.filter((v: AssetTrade) =>
			v.status === "CLOSED"
			|| v.status === "CANCELLED").map((v: AssetTrade) => {
				return {
					time: v.time,
					status: v.status,
					idBuy: v.idBuy,
					idSell: v.idSell,
					quantity: v.quantity,
					price: v.amount / v.quantity,
					fee: v.fee,
					total: v.amount + v.fee,
				};
			});

		let bittrexData: Data[] = [];

		if (settings.apikey.length > 0 && settings.apisecret.length > 0) {
			bittrexData = (await
				API.getBittrexHistory(settings.apikey, settings.apisecret)
					.catch((err): BittrexOrder[] => {
						handleError(err);
						return [];
					})).map(v => {
						return {
							time: Math.floor(DateTime.fromISO(v.closedAt)
								.toSeconds()) as UTCTimestamp,
							status: v.status,
							idBuy: v.direction === "BUY" ?
								PROPID_FEATHERCOIN : PROPID_BITCOIN,
							idSell: v.direction === "SELL" ?
								PROPID_FEATHERCOIN : PROPID_BITCOIN,
							quantity: parseFloat(v.fillQuantity),
							price: (parseFloat(v.proceeds)
								- parseFloat(v.commission))
								/ parseFloat(v.fillQuantity),
							fee: parseFloat(v.commission),
							total: parseFloat(v.proceeds),
						};
					});
		}

		setData(historyData.concat(bittrexData)
			.sort((a, b) => b.time - a.time));
	}

	React.useEffect(() => { refreshData(); }, []);
	useInterval(refreshData, 5000);

	if (data && data.length > 0)
		return <Table className="history-table"
			columns={columns} data={data} />;
	else
		return <div className="empty" style={{ fontSize: 12 }}>
			No history
		</div>;
};

export default History;
