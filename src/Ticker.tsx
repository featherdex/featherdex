import React from 'react';
import useInterval from 'use-interval';
import styled from 'styled-components';

import AppContext from './contexts/AppContext';
import api from './api';
import Clock from './Clock';

import { BITCOIN_SYMBOL } from './constants';
import { repeatAsync, uniqueId, toFormattedAmount } from './util';

type TickerElementProps = {
	prefix: string,
	price: string,
};

const TickerElement =
	({ prefix, price }: TickerElementProps) => {
		return <div>
			{prefix}{price}
		</div>;
	};

const C = {
	TickerTable: styled.div`
	display: flex;
	background: rgb(37, 37, 44);
	position: sticky;
	left: 0;
	right: 0;
	bottom: 0;
	min-width: 250px;
	height: 24px;
	& > * {
		display: inline-flex;
		padding: 2px 4px 2px 4px;
		font-size: 10pt;
	}`,
	TickerBody: styled.div`
	flex-grow: 100;
	overflow: hidden;
	& > * {
		display: inline-block;
		padding: 0 8px 0 8px;
	}`,
};

const TickerMarquee = () => {
	const { settings, getClient, getConstants } = React.useContext(AppContext);

	const {
		COIN_TICKER, COIN_MARKET, COIN_MARKET_ALT, COIN_MARKET_ALT2,
		COIN_BASE_TICKER, COIN_BASE_TICKER_ALT, COIN_BASE_TICKER_ALT2
	} = getConstants();

	const [coinRates, setCoinRates] = React.useState<CoinbaseRate>(null);
	const [BTCRates, setBTCRates] = React.useState<CoinbaseRate>(null);

	useInterval(async () => {
		const API = api(getClient());
		setCoinRates(await repeatAsync(API.getExchangeRates, 5)(COIN_TICKER)
			.catch(_ => null));
		setBTCRates(await repeatAsync(API.getExchangeRates, 5)("BTC")
			.catch(_ => null));
	}, 5000, true);

	const getPrice = (rate: CoinbaseRate, currency: string, places = 2) =>
		rate ? toFormattedAmount(parseFloat(rate.data.rates[currency]),
			settings.numformat, places, "currency", "none",
			true, currency) as string : "-";

	let tickerList = [
		...(COIN_TICKER !== "BTC" ? [<TickerElement prefix={`${COIN_MARKET_ALT}: `}
			price={getPrice(coinRates, COIN_BASE_TICKER_ALT, 4)}
			key={uniqueId("ticker-")} />,
		<TickerElement prefix={`${COIN_MARKET_ALT2}: `}
			price={getPrice(coinRates, COIN_BASE_TICKER_ALT2, 4)}
			key={uniqueId("ticker-")} />,
		<TickerElement prefix={`${COIN_MARKET}: `}
			price={getPrice(coinRates, COIN_BASE_TICKER, 8).replace(/BTC./,
				BITCOIN_SYMBOL)}
			key={uniqueId("ticker-")} />] : []),
		<TickerElement prefix={`BTC-USD: `}
			price={getPrice(BTCRates, "USD")} key={uniqueId("ticker-")} />,
		<TickerElement prefix={`BTC-EUR: `}
			price={getPrice(BTCRates, "EUR")} key={uniqueId("ticker-")} />,
	];

	return <C.TickerBody>{tickerList}</C.TickerBody>;
};

const Height = () => {
	const { settings, getClient } = React.useContext(AppContext);

	const [height, setHeight] = React.useState(0);

	useInterval(async () => {
		const API = api(getClient());
		setHeight(await repeatAsync(API.getBlockchainInfo, 5)().then(v =>
			v.blocks, _ => 0));
	}, 5000, true);

	return <div style={{ fontSize: "10pt" }}>Blockchain Height:&nbsp;
		{toFormattedAmount(height, settings.numformat, 0, "decimal", "none", true)}</div>
}

const Ticker = () => {
	return <C.TickerTable>
		<Clock prefix="Local Time: " />
		<Height />
		<TickerMarquee />
	</C.TickerTable>;
};

export default Ticker;