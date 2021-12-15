"use strict";

import React from 'react';
import useInterval from 'use-interval';

import { DateTime } from 'luxon';
import { Column } from 'react-table';

import AppContext from './contexts/AppContext';
import Table from './Table';
import api from './api';

import { PROPID_COIN } from './constants';
import { handlePromise, repeatAsync, toFormattedAmount } from './util';

type Data = {
	asset: string,
	last: { time: DateTime, price: number },
	chg: number,
	chgp: number,
	bid: number,
	ask: number,
	quantity: number,
	value: number,
	vol: number,
};

const Assets = () => {
	const {
		settings, getClient, getConstants, tickers
	} = React.useContext(AppContext);
	const [data, setData] = React.useState<Data[]>([]);

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
			Cell: props =>
				<span title={props.value.time.setLocale(settings.numformat)
					.toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)}>
					{toFormattedAmount(props.value.price, settings.numformat, 8)}
				</span>,
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
		if (!tickers || !tickers.get(PROPID_COIN)) return;

		const emptyTickerData = {
			last: { time: null as DateTime, price: 0 },
			chg: 0, chgp: 0, bid: 0, ask: 0, vol: 0
		};

		const API = api(getClient());
		const { COIN_TICKER, COIN_NAME } = getConstants();

		const tickerData = tickers.get(PROPID_COIN);
		let assetData: Data[] = [];

		// Bittrex data if available
		if (settings.apikey.length > 0 && settings.apisecret.length > 0) {
			const btcbal = await
				API.getBittrexBalance(settings.apikey, settings.apisecret,
					"BTC").then(v => v.available, _ => null);
			const coinbal = await
				API.getBittrexBalance(settings.apikey, settings.apisecret,
					COIN_TICKER).then(v => v.available, _ => null);

			if (btcbal && coinbal) {
				assetData.push({
					asset: "BTC (Bittrex)",
					quantity: btcbal,
					value: btcbal,
					...emptyTickerData,
				});
				assetData.push({
					asset: `${COIN_TICKER} (Bittrex)`,
					quantity: coinbal,
					value: coinbal * tickerData.last.price,
					...tickerData,
				});
			}
		}

		// coin in wallet data
		const quant = await handlePromise(repeatAsync(API.getCoinBalance, 5)(),
			`Could not get ${COIN_NAME} balance`);
		if (quant === null) return;

		const coinData = {
			asset: `${COIN_TICKER} (wallet)`,
			quantity: quant,
			value: quant * tickerData.last.price,
			...(assetData.length > 0 ? emptyTickerData : tickerData),
		};

		assetData.push(coinData);

		const assets = await handlePromise(repeatAsync(API.getWalletAssets, 3)(),
			"Could not get wallet asset balances");
		if (assets === null) return;

		for (let asset of assets) {
			const balance = parseFloat(asset.balance);
			const assetTicker = tickers.get(asset.propertyid) || emptyTickerData;

			assetData.push({
				asset: `(${asset.propertyid}) ${asset.name}`,
				quantity: balance,
				value: assetTicker.last.price * balance,
				...assetTicker,
			});
		}

		setData(assetData);
	}

	React.useEffect(() => { refreshData(); }, [tickers]);
	useInterval(refreshData, 5000);

	return <Table className="assets-table" columns={columns} data={data} />;
};

export default Assets;
