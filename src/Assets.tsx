"use strict";

import React from 'react';
import useInterval from 'use-interval';

import { Column } from 'react-table';

import AppContext from './contexts/AppContext';
import Table from './Table';
import api from './api';

import { PROPID_FEATHERCOIN } from './constants';
import { handlePromise, repeatAsync, toFormattedAmount } from './util';

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
	const { settings, getClient, tickers } = React.useContext(AppContext);
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
		if (!tickers || !tickers.get(PROPID_FEATHERCOIN)) return;

		const emptyTickerData = {
			last: 0, chg: 0, chgp: 0, bid: 0, ask: 0, vol: 0
		};

		const API = api(getClient());
		const tickerData = tickers.get(PROPID_FEATHERCOIN);

		let assetData: Data[] = [];

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
		const quant = await handlePromise(repeatAsync(API.getCoinBalance, 5)(),
			"Could not get Feathercoin balance");
		if (quant === null) return;

		const FTCData = {
			asset: "FTC (wallet)",
			quantity: quant,
			value: quant * tickerData.last,
			...(assetData.length > 0 ? emptyTickerData : tickerData),
		};

		assetData.push(FTCData);

		const assets = await handlePromise(repeatAsync(API.getWalletAssets, 3)(),
			"Could not get wallet asset balances");
		if (assets === null) return;

		for (let asset of assets) {
			const balance = parseFloat(asset.balance);
			const assetTicker = tickers.get(asset.propertyid) || emptyTickerData;

			assetData.push({
				asset: `(${asset.propertyid}) ${asset.name}`,
				quantity: balance,
				value: assetTicker.last * balance,
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
