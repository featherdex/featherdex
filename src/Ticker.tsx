import React from 'react';
import useInterval from 'use-interval';

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

const TickerMarquee = () => {
	const { settings, getClient } = React.useContext(AppContext);

	const [FTCRates, setFTCRates] = React.useState<CoinbaseRate>(null);
	const [BTCRates, setBTCRates] = React.useState<CoinbaseRate>(null);

	useInterval(async () => {
		const API = api(getClient());
		setFTCRates(await repeatAsync(API.getExchangeRates, 5)("FTC")
			.catch(_ => null));
		setBTCRates(await repeatAsync(API.getExchangeRates, 5)("BTC")
			.catch(_ => null));
	}, 5000, true);

	const getPrice = (rate: CoinbaseRate, currency: string, places = 2) =>
		rate ? toFormattedAmount(parseFloat(rate.data.rates[currency]),
			settings.numformat, places, "currency", "none",
			true, currency) as string : "-";

	let tickerList = [
		<TickerElement prefix={`FTC/USD: `}
			price={getPrice(FTCRates, "USD", 4)} key={uniqueId("ticker-")} />,
			<TickerElement prefix={`FTC/EUR: `}
			price={getPrice(FTCRates, "EUR", 4)} key={uniqueId("ticker-")} />,
		<TickerElement prefix={`FTC/BTC: `}
			price={getPrice(FTCRates, "BTC", 8).replace(/BTC/, BITCOIN_SYMBOL)}
			key={uniqueId("ticker-")} />,
		<TickerElement prefix={`BTC/USD: `}
			price={getPrice(BTCRates, "USD")} key={uniqueId("ticker-")} />,
			<TickerElement prefix={`BTC/EUR: `}
			price={getPrice(BTCRates, "EUR")} key={uniqueId("ticker-")} />,
	];

	return <div className="ticker-body">
		{tickerList}
	</div>;
};

const Ticker = () => {
	return <div className="ticker-table">
		<Clock prefix="Local Time: " />
		<TickerMarquee />
	</div>;
};

export default Ticker;