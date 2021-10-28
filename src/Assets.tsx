"use strict";

import React from 'react';
import useInterval from 'use-interval';

import { Column } from 'react-table';
import { DateTime, Duration } from 'luxon';
import { UTCTimestamp } from 'lightweight-charts';

import AppContext from './contexts/AppContext';
import Table from './Table';
import api from './api';
import useTimeCache from './timecache';

import { OMNI_START_TIME } from './constants';
import {
	handleError, toFormattedAmount, toCandle, tradeToLineData, isBarData, roundn
} from './util';

type Data = {
	asset: string,
	last: number,
	chg: number,
	chgp: number,
	bid: number,
	ask: number,
	quantity: number,
	value: number,
	vol: number,
};

const Assets = () => {
	const { settings, getClient, getBlockTimes, addBlockTime
	} = React.useContext(AppContext);
	const [data, setData] = React.useState<Data[]>([]);
	const [lasts, setLasts] = React.useState<Record<number, number>>({});

	const tradesCache = useTimeCache((ts, te) => {
		const client = getClient();
		return !!client ?
			api(client).listAssetTrades(ts as UTCTimestamp, te as UTCTimestamp,
				{ cache: getBlockTimes(), push: addBlockTime }) : null
	}, t => t.time);

	const columns: Column<Record<string, any>>[] = React.useMemo(() => settings ? [
		{
			Header: 'Asset',
			accessor: 'asset',
			width: 90,
		},
		{
			Header: 'Quantity',
			accessor: 'quantity',
			width: 75,
			Cell: (props: Record<string, any>) =>
				toFormattedAmount(props.value, settings.numformat, 8,
					"decimal", "none"),
		},
		{
			Header: 'Value',
			accessor: 'value',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
				"decimal", "none"),
		},
		{
			Header: 'Last',
			accessor: 'last',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8),
		},
		{
			Header: 'Chg',
			accessor: 'chg',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8),
		},
		{
			Header: 'Chg %',
			accessor: 'chgp',
			width: 60,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 1,
				"percent"),
		},
		{
			Header: 'Bid',
			accessor: 'bid',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
				"decimal", "none"),
		},
		{
			Header: 'Ask',
			accessor: 'ask',
			width: 75,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
				"decimal", "none"),
		},
		{
			Header: 'Volume (24h)',
			accessor: 'vol',
			width: 120,
			Cell: props => toFormattedAmount(props.value, settings.numformat, 8,
				"decimal", "none"),
		},
	] : [],
		[settings]
	);

	const refreshData = async () => {
		const emptyTickerData = {
			last: 0, chg: 0, chgp: 0, bid: 0, ask: 0, vol: 0
		};

		const API = api(getClient());
		const now = DateTime.now().toUTC();
		const yesterday = now.minus({ days: 1 }).startOf("day");

		const tickerData = await API.getCoinTicker().catch(err => {
			handleError(err, "error");
			return emptyTickerData;
		});

		var assetData = [];

		// Bittrex data if available
		if (settings.apikey.length > 0 && settings.apisecret.length > 0) {
			const btcbal = await
				API.getBittrexBalance(settings.apikey, settings.apisecret,
					"BTC").then(v => v.available, _ => null);
			const ftcbal = await
				API.getBittrexBalance(settings.apikey, settings.apisecret,
					"FTC").then(v => v.available, _ => null);

			if (btcbal && ftcbal) {
				assetData.push({
					asset: "BTC (Bittrex)",
					quantity: btcbal,
					value: btcbal,
					...emptyTickerData,
				});
				assetData.push({
					asset: "FTC (Bittrex)",
					quantity: ftcbal,
					value: ftcbal * tickerData.last,
					...tickerData,
				});
			}
		}

		// FTC in wallet data
		const quant = await API.getCoinBalance().catch((err: Error) => {
			handleError(err);
			return 0;
		});
		const FTCData = {
			asset: "FTC (wallet)",
			quantity: quant,
			value: quant * tickerData.last,
			...(assetData.length > 0 ? emptyTickerData : tickerData),
		};

		assetData.push(FTCData);

		const assets = await API.getWalletAssets()
			.catch(e => {
				handleError(e, "error");
				return null as AssetBalance[];
			});

		// if the api call failed just update coin data only
		if (!assets && data.length !== 0) {
			assetData = Array.from(data);
			assetData[0] = FTCData;
			setData(assetData);
			return;
		}

		const dexsells = await API.getExchangeSells().catch((e): DexSell[] => {
			handleError(e);
			return [];
		});

		const allTrades: AssetTrade[] = await tradesCache.refresh(OMNI_START_TIME,
			Math.floor(now.toSeconds()));

		for (var asset of assets) {
			const balance = parseFloat(asset.balance);
			const propid = asset.propertyid;

			const trades = allTrades.filter(v =>
				v.idBuy === propid).sort((a, b) => b.time - a.time);

			let last = lasts[propid]; // use cache
			if (last === undefined) last = 0; // if cache fails use default value

			if (trades.length > 0) {
				let lastTrade = trades[0];
				last = roundn(lastTrade.amount / lastTrade.quantity, 8);
				setLasts({ ...lasts, [propid]: last });
			}

			const asks = dexsells.filter(v =>
				parseInt(v.propertyid) === propid).map(v => parseFloat(v.unitprice));

			const dayCandles = toCandle(trades.filter(v =>
				v.time < yesterday.plus({ days: 1 }).toSeconds())
				.map(tradeToLineData),
				Duration.fromObject({ days: 1 }).as('seconds'));
			const dayClose = dayCandles.length > 0 && isBarData(dayCandles[0]) ?
				dayCandles[0].close : null;
			const chg = dayClose ? last - dayClose : 0;

			assetData.push({
				asset: asset.name,
				quantity: balance,
				value: last * balance,
				last: last,
				chg: chg,
				chgp: dayClose ? chg / dayClose : 0,
				bid: 0,
				ask: asks.length !== 0 ? Math.min(...asks) : 0,
				vol: trades.filter(v => v.time >= now.minus({ days: 1 }).toSeconds())
					.map(v => v.amount).reduce((pv, v) => pv + v, 0)
			});
		}

		setData(assetData);
	}

	React.useEffect(() => { refreshData(); }, []);
	useInterval(refreshData, 2000);

	return <Table className="assets-table" columns={columns} data={data} />;
};

export default Assets;
