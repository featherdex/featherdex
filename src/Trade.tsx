import React from 'react';
import N from 'decimal.js';
import styled from 'styled-components';
import useInterval from 'use-interval';

import { Mutex } from 'async-mutex';

import AppContext from './contexts/AppContext';
import Order from './order';
import api from './api';
import AssetSearch from './AssetSearch';
import Orderbook from './Orderbook';
import CoinInput from './CoinInput';

import {
	repeatAsync, handleError, handlePromise, getFillOrders, getAddressAssets,
	toTradeInfo, estimateSellFee, estimateBuyFee, createRawAccept,
	createRawPay, createRawOrder, fundTx, signTx, sendTx, toUTXO,
	chainSend, notify, log
} from './util';
import {
	SATOSHI, TRADE_FEERATE, MIN_TRADE_FEE, PROPID_BITCOIN, PROPID_COIN,
	ACCOUNT_LABEL, BITTREX_TRADE_FEERATE, OrderAction
} from './constants';

export type TraderState = {
	trade: number,
	base: number,
	price: Decimal,
	quantity: Decimal,
	fee: Decimal,
	total: Decimal,
	available: Decimal,
	orderType: "market" | "limit",
	buysell: "buy" | "sell",
	isDivisible: boolean,
	isConfirm: boolean,
	isNoHighFees: boolean,
	bids: BookData[],
	asks: BookData[],
}

export type TraderAction = {
	type: "set_price" | "set_quantity" | "set_fee" | "set_total" | "set_available"
	| "set_divisible" | "set_confirm" | "set_nohighfees" | "set_ordertype"
	| "set_buysell" | "set_trade" | "set_base" | "set_bids" | "set_asks",
	payload?: any,
};

type TraderProps = {
	state: TraderState,
	dispatch: (v: TraderAction) => any
}

const reducerTrade =
	(state: TraderState, action: TraderAction): TraderState => {
		const getBest = (side: "buy" | "sell") => {
			const bestBook = side === "buy" ?
				state.asks[0] : state.bids[0];
			return bestBook ? bestBook.price : new N(0);
		};

		const getFee = (price: Decimal, quantity: Decimal) => {
			const fee = price.mul(quantity).mul(TRADE_FEERATE).toDP(8);
			return fee.gte(MIN_TRADE_FEE) ? fee : MIN_TRADE_FEE;
		};

		switch (action.type) {
			case "set_price":
				{
					log().debug("set_price")
					log().debug(action.payload)
					const price = new N(action.payload).toDP(8);
					let v = { ...state, price: price };
					if (v.base === PROPID_BITCOIN) {
						const fee = getFee(price, state.quantity);
						v = {
							...v, fee,
							total: price.mul(state.quantity).add(fee).toDP(8),
						};
					} else
						v = {
							...v,
							total: price.mul(state.quantity).add(state.fee).toDP(8),
						};
					return v;
				}
			case "set_quantity":
				{
					log().debug("set_quantity")
					log().debug(action.payload)
					const quantity = new N(action.payload).toDP(8);
					let v = { ...state, quantity: quantity };
					if (v.base === PROPID_BITCOIN) {
						const fee = state.price.mul(quantity)
							.mul(BITTREX_TRADE_FEERATE).toDP(8);
						v = {
							...v, fee,
							total: state.price.mul(quantity).add(fee).toDP(8),
						};
					} else
						v = {
							...v,
							total: state.price.mul(quantity).add(state.fee).toDP(8),
						};
					return v;
				}
			case "set_fee":
				{
					log().debug("set_fee")
					log().debug(action.payload)
					const fee = new N(action.payload).toDP(8);
					return {
						...state, fee,
						total: state.price.mul(state.quantity).add(fee).toDP(8),
					};
				}
			case "set_total":
				log().debug("set_total")
				log().debug(action.payload)
				const payload = new N(action.payload).toDP(8);
				const fee = state.base === PROPID_BITCOIN ?
					new N(action.payload).times(BITTREX_TRADE_FEERATE)
						.div(BITTREX_TRADE_FEERATE.add(1)).toDP(8) : state.fee;

				const pretotal = payload.sub(fee);
				let total;

				if (state.isDivisible) total = payload;
				else if (state.price.eq(0)) total = fee;
				else {
					const rfunc = payload.gte(state.total) ?
						(n: N.Value) => N.ceil(n) : (n: N.Value) => N.floor(n);
					total = rfunc(pretotal.div(state.price)).mul(state.price)
						.add(fee).toDP(8);
				}
				if (total.lt(fee)) total = fee;

				if (state.price.eq(0))
					return { ...state, total, fee, quantity: new N(0) };

				if (state.price.mul(state.quantity).add(fee).toDP(8).eq(total))
					return { ...state, total, fee };

				return {
					...state, total, fee,
					quantity: total.minus(fee).div(state.price).toDP(8),
				};
			case "set_available":
				return { ...state, available: action.payload };
			case "set_divisible":
				return { ...state, isDivisible: action.payload };
			case "set_confirm":
				return { ...state, isConfirm: action.payload };
			case "set_nohighfees":
				return { ...state, isNoHighFees: action.payload };
			case "set_ordertype":
				{
					let v = { ...state, orderType: action.payload };
					if (v.orderType === "market")
						v = { ...v, price: getBest(v.buysell) };
					return v;
				}
			case "set_buysell":
				return { ...state, buysell: action.payload };
			case "set_trade":
				return {
					...state, trade: action.payload,
					base: action.payload === PROPID_COIN ?
						PROPID_BITCOIN : PROPID_COIN,
				};
			case "set_bids":
				return { ...state, bids: action.payload };
			case "set_asks":
				return { ...state, asks: action.payload };
			default:
				throw new Error("reducerTrade called with invalid action type "
					+ action.type);
		}
	}

const Trader = ({ state, dispatch }: TraderProps) => {
	const {
		settings, getClient, getConstants, addPendingOrder
	} = React.useContext(AppContext);

	const tradeMutex = React.useMemo(() => new Mutex(), []);
	const availMutex = React.useMemo(() => new Mutex(), []);

	const cDispatch = (type: TraderAction["type"]) => (payload: any) =>
		dispatch({ type, payload });

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		const v = target.type === "checkbox" ? target.checked : target.value;
		const name = target.name;

		switch (name) {
			case "confirm":
				cDispatch("set_confirm")(v as boolean);
				break;
			case "nohighfees":
				cDispatch("set_nohighfees")(v as boolean);
				break;
			default:
		}
	}

	const handleChangeSel = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const target = event.target;
		const value = target.value;
		const name = target.name;

		switch (name) {
			case "ordertype":
				cDispatch("set_ordertype")(value);
				break;
			case "buysell":
				cDispatch("set_buysell")(value);
				break;
		}
	}

	const refreshAvailable = () => availMutex.runExclusive(async () => {
		const { COIN_TICKER, COIN_BASE_TICKER } = getConstants();
		const API = api(getClient());

		if (state.trade === -1) return;

		if (state.trade === PROPID_COIN) {
			if (settings.apikey.length === 0 || settings.apisecret.length === 0)
				return;
			const balance = await handlePromise(repeatAsync(API.getBittrexBalance, 5)
				(settings.apikey, settings.apisecret, state.buysell === "buy" ?
					COIN_BASE_TICKER : COIN_TICKER),
				"Could not get Bittrex balance");

			dispatch({
				type: "set_available",
				payload: balance !== null ? new N(balance.available) : new N(0),
			});
			return;
		}

		let balance = null;
		if (state.buysell === "buy")
			balance = await handlePromise(repeatAsync(API.getCoinBalance, 5)(),
				"Could not get coin balance");
		else
			balance = await handlePromise(repeatAsync(API.getWalletAssets, 3)(),
				"Could not get wallet balances", arr => {
					const entry = arr.find(v => v.propertyid === state.trade);
					return entry !== undefined ? entry.balance : null;
				});

		dispatch({
			type: "set_available",
			payload: balance !== null ? new N(balance) : new N(0),
		});
	});

	React.useEffect(() => { refreshAvailable(); }, [state.trade, state.buysell]);
	useInterval(refreshAvailable, 30000);

	const doTrade = () => tradeMutex.runExclusive(async () => {
		const logger = log();
		const consts = getConstants();
		const { COIN_MARKET, COIN_TICKER, COIN_BASE_TICKER, MIN_CHANGE } = consts;

		// case: unselected
		if (state.trade === -1 || state.base === -1) {
			alert("Please select assets to " +
				(state.trade * state.base === 1 ?
					"trade" : (state.trade === -1 ? "buy" : "sell")));
			return;
		}

		// case: invalid asset pairs
		if (state.trade === state.base) {
			alert("Cannot trade assets of the same type");
			return;
		}

		if (state.trade > PROPID_COIN && state.base === PROPID_BITCOIN) {
			alert("Cannot trade Omni assets to Bitcoin");
			return;
		}

		// case: trade value is zero
		if (state.buysell === "buy" && state.total.eq(0)
			|| state.buysell === "sell" && state.quantity.eq(0)) {
			alert("Cannot place zero-value trade");
			return;
		}

		// case: trade value is below dust
		if (state.price.mul(state.quantity).lt(MIN_CHANGE)) {
			alert("Total trade is too small, value must be at least"
				+ ` ${MIN_CHANGE} ${COIN_TICKER}`);
			return;
		}

		// case: Bittrex trade without API key
		if (state.base === PROPID_BITCOIN && (settings.apikey.length === 0
			|| settings.apisecret.length === 0)) {
			alert("Cannot place trade on Bittrex without API key and secret. "
				+ "Please obtain one from your Bittrex account and input them "
				+ "into settings.");
			return;
		}

		const tradeInfo =
			`${state.orderType.toUpperCase()} ${state.buysell.toUpperCase()}`
			+ ` ${state.quantity.toFixed(8)} `
			+ (state.trade === PROPID_COIN ? COIN_TICKER : `[ASSET #${state.trade}]`)
			+ ` @${state.price.toFixed(8)} `
			+ (state.base === PROPID_COIN ? COIN_TICKER : COIN_BASE_TICKER);

		if (state.isConfirm) {
			const c = confirm("Are you sure you want to place this trade? "
				+ tradeInfo);
			if (!c) return;
		}

		const client = getClient();
		const API = api(client);

		// Omni trade
		if (state.base === 1) {
			if (state.buysell === "buy") {
				const coins = await handlePromise(repeatAsync
					(API.getCoinBalance, 5)(), "Could not get wallet balance");
				if (coins === null) return;

				// case: insufficient balance, coin
				if (state.total.gt(new N(coins))) {
					handleError(new Error("Insufficient balance, "
						+ `have: ${coins.toFixed(8)} ${COIN_TICKER}, need: `
						+ `${state.total.toFixed(8)} ${COIN_TICKER}`), "error");
					return;
				}
			} else {
				const assets = await
					handlePromise(repeatAsync(API.getWalletAssets, 5)(),
						"Could not get wallet assets");
				if (assets === null) return;

				const asset = assets.filter(v => v.propertyid === state.trade);

				// case: insufficient balance, ASSET
				if (asset.length === 0
					|| state.quantity.gt(new N(asset[0].balance))) {
					handleError(new Error("Insufficient balance, "
						+ `have: ${parseFloat(asset[0].balance).toFixed(8)} `
						+ `[ASSET #${state.trade}], `
						+ `need: ${state.quantity.toFixed(8)} `
						+ `[ASSET #${state.trade}]`), "error");
					return;
				}
			}
		} else {
			// place Bittrex order and hope for the best
			await API.makeBittrexOrder(settings.apikey, settings.apisecret,
				COIN_MARKET, state.buysell, state.orderType, state.quantity,
				state.price).then((v: BittrexOrder) => {
					notify("success", "Placed order", toTradeInfo(consts, v));
				}, err => handleError(err, "error"));
			return;
		}

		if (state.orderType === "limit" && state.buysell === "buy")
			alert("Warning: the current version of this app does not support "
				+ "buy side orderbook, and therefore, if they do not fill in "
				+ "their entirety immediately, all BUY orders will have the "
				+ "remainder of their quantity cancelled! "
				+ "(Immediate-Or-Cancel)");

		let utxo: UTXO;
		let waitTXs = [] as string[];
		let finaltx: string;

		// check if we need to move balances to a new address because
		// there is insufficient available coinage in any one address
		if (state.buysell === "buy") {
			logger.debug("entering buy")
			// Do a rough estimate to check if the fee specified is enough to cover
			// all subsequent transaction fees

			// Grab UTXOs
			const utxos = await handlePromise(repeatAsync(API.listUnspent, 3)(),
				"Could not get UTXOs");
			if (utxos == null) return;

			if (utxos.length === 0) {
				handleError(new Error("Cannot find UTXOs for transaction"), "error");
				return;
			}

			logger.debug("utxos")
			logger.debug(utxos)

			const fillOrders = await getFillOrders(client, state.trade,
				state.quantity, state.orderType === "limit" ?
				state.price : undefined, state.isNoHighFees).then(v =>
					v.fillOrders, e => {
						handleError(e, "error");
						return null;
					}) as Awaited<ReturnType<typeof getFillOrders>>["fillOrders"];
			if (fillOrders === null) return;

			logger.debug("fillOrders")
			logger.debug(fillOrders)

			if (fillOrders.length === 0) {
				handleError(new Error("Could not find any sell orders to fill"),
					"error");
				return;
			}

			const tradeFee = await
				estimateBuyFee(consts, client, fillOrders).catch(e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof estimateBuyFee>>;
			if (tradeFee === null) return;

			logger.debug("tradeFee")
			logger.debug(tradeFee)

			// case: set fee is smaller than minimum
			if (state.fee < tradeFee.totalFee) {
				alert(`Fee too low, need at least ${tradeFee} ${COIN_TICKER}`);
				return;
			}

			logger.debug("find utxo loop")
			// Try to find a UTXO that can cover everything
			for (let i of utxos)
				if (new N(i.amount).gte(state.total)) {
					utxo = i;
					break;
				}

			logger.debug("utxo")
			logger.debug(utxo)

			// If we can't, make one by grouping UTXO inputs
			if (!utxo) {
				logger.debug("regroup")
				// create new address
				const newAddress = await
					handlePromise(repeatAsync(API.getNewAddress, 3)(ACCOUNT_LABEL),
						"Could not create new address for grouping");
				if (newAddress === null) return;

				logger.debug("newAddress")
				logger.debug(newAddress)

				logger.debug("createRawTransaction")

				const pretx = await
					handlePromise(repeatAsync(API.createRawTransaction, 3)
						({ ins: [], outs: [{ [newAddress]: state.total }] }),
						"Could not create pre-raw transaction for grouping");
				if (pretx === null) return;

				const rawtx = await fundTx(client, pretx, {},
					"Could not fund raw grouping transaction for buy");
				if (rawtx === null) return;

				const signedtx = await signTx(client, rawtx,
					"Could not sign raw grouping transaction for buy");
				if (signedtx === null) return;

				const sendtx = await sendTx(client, signedtx,
					"Could not send raw grouping transaction for buy");
				if (sendtx === null) return;

				utxo = toUTXO(sendtx, 0, newAddress, state.total);

				logger.debug("new utxo")
				logger.debug(utxo)
			}

			logger.debug("send accepts loop")
			// Send all accepts
			let acceptedOrders = [] as FillOrder[];
			for (let i of fillOrders) {
				logger.debug("fillOrder")
				logger.debug(i)

				const skipErrorMsg = "Could not fill order from seller "
					+ `${i.address}, skipping`;

				logger.debug("createRawAccept")

				const acceptFee = tradeFee.acceptFees.get(i.address);
				const accept = await createRawAccept(consts, client, i.address,
					state.trade, i.quantity, utxo, acceptFee).catch(e => {
						handleError(e, "error");
						handleError(new Error(skipErrorMsg), "warn");
						return null;
					});
				if (accept === null) continue;

				const signedtx = await
					signTx(client, accept, `${skipErrorMsg} (signing)`);
				if (signedtx === null) continue;

				const sendtx = await
					sendTx(client, signedtx, `${skipErrorMsg} (sending)`);
				if (sendtx === null) continue;

				acceptedOrders.push(i);

				logger.debug("push waitTX")
				// Push to wait queue, wait for all before sending purchase
				waitTXs.push(sendtx);

				// Make the new UTXO the output of the completed transaction
				utxo = toUTXO(sendtx, 0, utxo.address,
					new N(utxo.amount).sub(MIN_CHANGE).sub(acceptFee).toDP(8));

				logger.debug("new utxo")
				logger.debug(utxo)
			}

			// Create and sign pay transaction, pass to Order object for later
			{
				const pretx: string = await createRawPay(consts, client,
					acceptedOrders.map(order =>
						({ address: order.address, amount: order.payAmount })),
					utxo, tradeFee.payFee).catch(e => {
						handleError(e);
						return null;
					});
				if (pretx === null) return;

				finaltx = await
					signTx(client, pretx, "Could not sign pay transaction");
				if (finaltx === null) return;
			}

			logger.debug("end buy")
		} else { // sell
			logger.debug("enter sell")

			const addressAssets = await
				getAddressAssets(client, state.trade).catch(e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof getAddressAssets>>;
			if (addressAssets === null) return;

			if (addressAssets.length === 0) {
				handleError(new Error("No available assets found for "
					+ `[ASSET #${state.trade}]. Check that addresses with assets`
					+ `have enough ${COIN_TICKER} for transactions.`), "error");
				return;
			}

			logger.debug("addressAssets")
			logger.debug(addressAssets)

			let address;
			let reshuffleAddresses: { address: string, amount: Decimal }[] = [];
			{
				const asset = addressAssets.find(v =>
					v.amount.gte(state.quantity) && !v.occupied && !v.pending);
				if (!!asset) address = asset.address;
			}

			logger.debug("find big address")
			logger.debug(address)

			// Need to group addresses
			if (!address) {
				let remaining = state.quantity;

				// Collect send inputs
				for (let i of addressAssets) {
					logger.debug("addressAsset")
					logger.debug(i)
					logger.debug("remaining")
					logger.debug(remaining)
					if (i.amount >= remaining) {
						logger.debug("exiting loop")
						reshuffleAddresses.push({
							address: i.address, amount: remaining
						});
						break;
					}

					reshuffleAddresses.push({
						address: i.address, amount: i.amount
					});
					remaining = remaining.sub(i.amount);
				}

				logger.debug("reshuffleAddresses")
				logger.debug(reshuffleAddresses)

				address = await handlePromise(repeatAsync(API.getNewAddress, 5)
					(ACCOUNT_LABEL), "Could not create new address for sell order");
				if (address === null) return;

				logger.debug("address")
				logger.debug(address)
			}

			const tradeFee = await estimateSellFee(consts, client,
				reshuffleAddresses.length).catch(e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof estimateSellFee>>;
			if (tradeFee === null) return;

			logger.debug("tradeFee")
			logger.debug(tradeFee)

			// Fund this sell transaction
			{
				const firstAddress = reshuffleAddresses.length > 0 ?
					reshuffleAddresses[0].address : address;

				logger.debug("firstAddress")
				logger.debug(firstAddress)

				const pretx = await
					handlePromise(repeatAsync(API.createRawTransaction, 3)({
						ins: [], outs: [{ [firstAddress]: tradeFee.totalFee }]
					}), "Could not create raw transaction for sell fee");
				if (pretx === null) return;

				const rawtx = await fundTx(client, pretx, { changePosition: 1 },
					"Could not fund raw transaction for sell fee");
				if (rawtx === null) return;

				const signedtx = await signTx(client, rawtx,
					"Could not sign raw transaction for sell fee");
				if (signedtx === null) return;

				const sendtx = await sendTx(client, signedtx,
					"Could not send raw transaction for sell fee");
				if (sendtx === null) return;

				utxo = toUTXO(sendtx, 0, firstAddress, tradeFee.totalFee);

				logger.debug("utxo")
				logger.debug(utxo)
			}

			// Chain send the assets to [address]
			{
				const chain = await chainSend(consts, client, state.trade,
					reshuffleAddresses, utxo, address, tradeFee.sendFee, waitTXs);
				if (chain === null) return;

				utxo = chain.utxo;
				waitTXs = chain.waitTXs;
			}

			// Now from [address] create the order transaction
			{
				logger.debug("createRawOrder")
				const rawtx = await createRawOrder(consts, client, state.trade,
					OrderAction.ORDER_NEW, utxo, tradeFee.postFee, state.quantity,
					state.price).catch(e => {
						handleError(e, "error");
						return null;
					});
				if (rawtx === null) return;

				const signedtx = await signTx(client, rawtx,
					"Could not sign raw sell order transaction");
				if (signedtx === null) return;

				finaltx = signedtx;
			}
		}

		logger.debug("waitTXs")
		logger.debug(waitTXs)

		logger.debug("create order")

		const order = new Order(client, state.buysell, state.orderType,
			state.trade, state.quantity, state.price, state.fee,
			utxo.address, state.isNoHighFees, waitTXs, finaltx);

		logger.debug("add pending order")
		addPendingOrder(order);

		notify("success", "Created new order", toTradeInfo(consts, order));

		logger.debug("run order")
		order.run();
	});

	const setTrade = (propid: number) => {
		const API = api(getClient());

		dispatch({ type: "set_trade", payload: propid });

		if (propid < PROPID_BITCOIN) return;

		repeatAsync(API.getProperty, 5)(propid).then(p => p.divisible, _ => {
			handleError(new Error("Could not query property info"), "error");
			return true;
		}).then(divisible =>
			dispatch({ type: "set_divisible", payload: divisible }));
	}

	const setMax = () => {
		if (state.available.eq(0)) return;
		if (state.buysell === "buy")
			dispatch({ type: "set_total", payload: state.available });
		else dispatch({ type: "set_quantity", payload: state.available });
	};

	return <>
		<C.Trader.Body>
			<C.Trader.Inputs>
				<thead><tr>
					<th style={{ textAlign: "center" }} colSpan={4}>
						Place a trade
					</th>
				</tr></thead>
				<tbody>
					<tr>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Trade asset:
						</td>
						<td style={{
							minWidth: "120px",
							padding: "0 8px 0 8px"
						}}>
							<AssetSearch setAssetCallback={setTrade}
								filter={v => v.id !== 0} zIndex={2} />
						</td>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Price:
						</td>
						<td>
							<CoinInput value={state.price}
								dispatch={cDispatch("set_price")} step={SATOSHI} />
						</td>
					</tr>
					<tr>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Base asset:
						</td>
						<td style={{
							minWidth: "120px",
							padding: "0 8px 0 8px",
							fontFamily: "monospace",
							fontSize: "12pt",
							textAlign: "right",
						}}>
							{state.trade === PROPID_COIN ?
								getConstants().COIN_BASE_TICKER :
								getConstants().COIN_TICKER}
						</td>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Quantity:
						</td>
						<td>
							<CoinInput value={state.quantity}
								dispatch={cDispatch("set_quantity")}
								step={state.isDivisible ? SATOSHI : new N(1)}
								digits={state.isDivisible ? 8 : 0}
								disabled={state.orderType === "market"
									&& state.buysell === "buy"} />
						</td>
					</tr>
					<tr>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Order type:
						</td>
						<td style={{
							textAlign: "right",
							paddingRight: "8px"
						}}>
							<select name="ordertype" value={state.orderType}
								onChange={handleChangeSel}>
								{state.buysell === "buy"
									&& <option value="market">Market</option>}
								<option value="limit">Limit</option>
							</select>
							<select name="buysell" value={state.buysell}
								onChange={handleChangeSel} style={{ marginLeft: 8 }}>
								<option value="buy">Buy</option>
								<option value="sell">Sell</option>
							</select>
						</td>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Est. fee:
						</td>
						<td>
							<input type="number" name="fee"
								className="coin form-field"
								value={state.fee.toFixed(8)} min={0} readOnly />
						</td>
					</tr>
					<tr>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							{state.base === PROPID_BITCOIN
								&& state.buysell === "buy" ?
								getConstants().COIN_BASE_TICKER
								: (state.base === PROPID_COIN
									&& state.buysell === "sell" ?
									"Asset" : getConstants().COIN_TICKER)} in wallet:
						</td>
						<td style={{
							textAlign: "right",
							paddingRight: "8px"
						}}>
							<input type="number" name="balance"
								className="coin form-field"
								value={state.available.toFixed(state.isDivisible ?
									8 : 0)} min={0} readOnly />
						</td>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Total:
						</td>
						<td>
							<CoinInput value={state.total}
								dispatch={cDispatch("set_total")} step={SATOSHI} />
						</td>
					</tr>
					<tr style={{ paddingTop: "8px" }}>
						<td colSpan={4} style={{ textAlign: "right" }}>
							<label style={
								{
									fontSize: "9pt",
									margin: "0 10px 0 4px",
									display: "inline-block"
								}
							}>
								<input type="checkbox" name="nohighfees"
									className="form-field"
									checked={state.isNoHighFees}
									onChange={handleChange} />
								Don&apos;t pay high accept fees
							</label>
							<label style={
								{
									fontSize: "9pt",
									margin: "0 10px 0 4px",
									display: "inline-block"
								}
							}>
								<input type="checkbox" name="confirm"
									className="form-field"
									checked={state.isConfirm}
									onChange={handleChange} />
								Confirm Placement
							</label>
							<button style={{
								display: "inline-block",
								marginRight: "8px",
							}} onClick={setMax}>Max</button>
							<button style={{
								display: "inline-block",
								marginRight: "8px",
							}} onClick={doTrade}>Confirm</button>
						</td>
					</tr>
				</tbody>
			</C.Trader.Inputs>
		</C.Trader.Body>
	</>;
};

const C = {
	Container: styled.div`
	width: 100%;
	height: 100%;
	display: flex;
	flex-flow: row;`,
	Trader: {
		Trader: styled.div`
		height: 100%;
		box-sizing: border-box;
		flex-basis: 475px;`,
		Body: styled.div`padding: 4px 8px 0 8px;`,
		Inputs: styled.table`
		width: 100%;
		margin-bottom: 8px;
		& td {
			height: 30px;
			padding: 0;
			line-height: 125%;
		}`,
	},
	Orderbook: styled.div`
	height: 100%;
	box-sizing: border-box;
	min-width: 600px;
	flex: 1;
	overflow: hidden;`
}

const Trade = () => {
	const initialState: TraderState = {
		trade: -1,
		base: PROPID_COIN,
		price: new N(0),
		quantity: new N(0),
		fee: new N(0),
		total: new N(0),
		available: new N(0),
		orderType: "limit",
		buysell: "buy",
		isDivisible: true,
		isConfirm: true,
		isNoHighFees: true,
		bids: [],
		asks: [],
	}

	const [state, dispatch] = React.useReducer(reducerTrade, initialState);

	return <C.Container>
		<C.Trader.Trader>
			<Trader state={state} dispatch={dispatch} />
		</C.Trader.Trader>
		<C.Orderbook>
			<Orderbook state={state} dispatch={dispatch} />
		</C.Orderbook>
	</C.Container>;
};

export default Trade;