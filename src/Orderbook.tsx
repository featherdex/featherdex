"use strict";

import React from 'react';
import useInterval from 'use-interval';
import N from 'decimal.js';

import AppContext from './contexts/AppContext';

import api from './api';

import { TraderState, TraderAction } from './Trade';

import {
	PROPID_BITCOIN, PROPID_COIN, EMPTY_TX_VSIZE, TX_I_VSIZE, TX_O_VSIZE,
	OPRETURN_ORDER_VSIZE
} from './constants';

import {
	repeatAsync, handlePromise, estimateTxFee, estimateBuyFee, estimateSellFee,
	getPendingAccepts, getFillOrders, getAddressAssets, uniqueId, toFormattedAmount,
	handleError, dsum
} from './util';

type OrderbookProps = {
	state: TraderState,
	dispatch: (v: TraderAction) => void,
}

const Orderbook = ({ state, dispatch }: OrderbookProps) => {
	const { settings, getClient, getConstants } = React.useContext(AppContext);

	const refreshData = async () => {
		if (state.trade === -1 || state.base === -1
			|| state.trade === state.base
			|| (state.trade > PROPID_COIN && state.base === PROPID_BITCOIN)) {
			if (state.bids.length !== 0) dispatch({ type: "set_bids", payload: [] });
			if (state.asks.length !== 0) dispatch({ type: "set_asks", payload: [] });
			return;
		}

		const toData = (arr: BittrexBookEntry[]): BookData[] => {
			let data: BookData[] = [];
			let total = new N(0);

			for (let i = 0; i < arr.length; i++) {
				const price = new N(arr[i].rate);
				const quantity = new N(arr[i].quantity);
				const value = price.mul(quantity).toDP(8);
				total = total.add(value);

				data.push({ price, quantity, value, total });
			}

			return data;
		}

		const client = getClient();
		const API = api(client);
		if (state.trade === PROPID_COIN) {
			// coin-BTC
			const book = await API.getCoinBook(getConstants().COIN_MARKET);

			dispatch({ type: "set_bids", payload: toData(book.bid) });
			dispatch({ type: "set_asks", payload: toData(book.ask) });

			return;
		}

		const orders = await handlePromise(repeatAsync(API.getExchangeSells, 3)(),
			"Could not get sell orders on exchange",
			x => x.filter(v => parseInt(v.propertyid) === state.trade));

		if (orders === null) return;

		const accepts = await getPendingAccepts(client).catch(e => {
			handleError(e);
			return null;
		});

		if (accepts === null) return;

		let bids = new Map<Decimal, Decimal[]>();

		let asks = orders.reduce((map, v) =>
			map.set(new N(v.unitprice), [...(map.get(new N(v.unitprice)) || []),
			...(accepts[v.seller] || []), new N(v.amountavailable)]),
			new Map<Decimal, Decimal[]>());

		dispatch({ type: "set_bids", payload: [] });
		dispatch({
			type: "set_asks",
			payload: toData(Array.from(asks).sort((a, b) => +a[0] - +b[0]).map(v =>
				({ rate: v[0].toFixed(8), quantity: dsum(v[1]).toFixed(8) })))
		});

		if (state.quantity.gt(0) &&
			(state.price.gt(0) || state.orderType === "market")) {
			let estFee = new N(0);

			const book = state.buysell === "buy" ? Array.from(asks).sort((a, b) =>
				+a[0] - +b[0]) : Array.from(bids).sort((a, b) => +b[0] - +a[0]);

			// Correct price if MARKET order
			if (state.orderType === "market") {
				let price = book[0][0];
				let remaining = state.quantity;

				for (let i of book) {
					if (remaining.lte(0)) break;
					price = i[0];
					remaining = remaining.sub(dsum(i[1]));
				}

				dispatch({ type: "set_price", payload: price });
			}

			const postFee = await handlePromise(estimateTxFee(client, null,
				EMPTY_TX_VSIZE + TX_I_VSIZE + TX_O_VSIZE + OPRETURN_ORDER_VSIZE),
				"Could not estimate sell order post fee");
			if (postFee === null) return;

			// TODO change when we get non-zero depth buy orderbook
			if (book.length === 0) estFee = postFee;
			else {
				if (state.buysell === "buy") {
					const { fillOrders, fillRemaining } = await
						getFillOrders(client, state.trade, state.quantity,
							state.orderType === "limit" ? state.price : undefined,
							state.isNoHighFees).catch(e => {
								handleError(e, "error");
								return { fillOrders: null, fillRemaining: null };
							}) as Awaited<ReturnType<typeof getFillOrders>>;
					if (fillOrders === null) return;

					if (fillOrders.length === 0) {
						dispatch({ type: "set_fee", payload: postFee });
						return;
					}

					estFee = await
						estimateBuyFee(getConstants(), client, fillOrders).then(v =>
							v.totalFee, e => {
								handleError(e, "error");
								return null;
							});
					if (estFee === null) return;

					if (fillRemaining.gt(0)) estFee = estFee.add(postFee);
				} else { // sell
					const addressAssets = await
						getAddressAssets(client, state.trade).catch(e => {
							handleError(e, "error");
							return null;
						}) as Awaited<ReturnType<typeof getAddressAssets>>;
					if (addressAssets === null) return;

					let reshufflect = 0;

					// Cannot find an address to fund everything
					if (!addressAssets.find(v =>
						v.amount.gte(state.quantity) && !v.occupied && !v.pending)) {
						let remaining = state.quantity;

						// Collect send inputs
						for (let i of addressAssets) {
							if (remaining.lte(0)) break;
							reshufflect++;
							remaining = remaining.sub(i.amount);
						}
					}

					estFee = await estimateSellFee(getConstants(), client,
						reshufflect).then(v => v.totalFee, e => {
							handleError(e, "error");
							return null;
						});
					if (estFee === null) return;
				}
			}

			dispatch({ type: "set_fee", payload: estFee });
		}
	}

	React.useMemo(refreshData,
		[state.base, state.trade, state.quantity, state.price, state.isNoHighFees]);
	useInterval(refreshData, 1500);

	const createRows = (data: BookData[], side: string) => {
		const total = data && data.length > 0 ? data[data.length - 1].total : 0;
		const els = data.map((v) => {
			const totp = v.total.div(total).mul(100).toFixed(4);

			let row = [<div key={uniqueId("orderbook-row-")}
				className="td clickable"
				onClick={() => {
					if (state.orderType === "limit")
						dispatch({ type: "set_price", payload: v.price });
				}}>
				{toFormattedAmount(+v.price, settings.numformat, 8,
					"decimal", side === "bid" ? "green" : "red")}
			</div>,
			<div key={uniqueId("orderbook-row-")} className="td clickable"
				onClick={() =>
					dispatch({ type: "set_quantity", payload: v.quantity })}>
				{toFormattedAmount(+v.quantity, settings.numformat, 8,
					"decimal", "none")}
			</div>,
			<div key={uniqueId("orderbook-row-")} className="td clickable"
				onClick={() =>
					dispatch({ type: "set_total", payload: v.value })}>
				{toFormattedAmount(+v.value, settings.numformat, 8,
					"decimal", "none")}
			</div>,
			<div key={uniqueId("orderbook-row-")} className="td clickable"
				onClick={() =>
					dispatch({ type: "set_total", payload: v.total })}>
				{toFormattedAmount(+v.total, settings.numformat, 8,
					"decimal", "none")}
			</div>];

			if (side === "bid") row.reverse();

			return <div key={uniqueId("orderbook-row-")}
				className="orderbook-row-container">
				<div key={uniqueId("orderbook-row-")} style={{
					position: "absolute",
					top: 0,
					left: side === "bid" ? `calc(100% - ${totp}%)` : 0,
					backgroundColor: side === "bid" ?
						"rgba(0, 185, 0, 0.2)" : "rgba(255, 0, 0, 0.2)",
					width: `${totp}%`,
					height: "24px",
				}}></div>
				{row}
			</div>;
		});

		return els;
	}

	const error = React.useMemo(() => state.trade === -1 || state.base === -1 ?
		"Select assets to trade" : (state.trade === state.base ?
			"Traded assets cannot be same" :
			(state.trade > PROPID_COIN && state.base === PROPID_BITCOIN ?
				"Cannot trade Omni asset with Bitcoin" : null)),
		[state.trade, state.base]);

	const bidRows =
		React.useMemo(() => createRows(state.bids, "bid"), [state.bids]);
	const askRows =
		React.useMemo(() => createRows(state.asks, "ask"), [state.asks]);

	return <>
		<div className="order-table order-bid">
			<div className="order-header">
				<div className="th">Total</div>
				<div className="th">Value</div>
				<div className="th">Quantity</div>
				<div className="th">Price</div>
			</div>
			<div className="order-body">
				{bidRows.length > 0 ? bidRows :
					<div className="empty">{error ? error : "No bids"}</div>}
			</div>
		</div>
		<div className="order-table order-ask">
			<div className="order-header">
				<div className="th">Price</div>
				<div className="th">Quantity</div>
				<div className="th">Value</div>
				<div className="th">Total</div>
			</div>
			<div className="order-body">
				{askRows.length > 0 ? askRows :
					<div className="empty">{error ? error : "No bids"}</div>}
			</div>
		</div>
	</>;
};

export default Orderbook;
