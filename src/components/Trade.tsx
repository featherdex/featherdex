import React from 'react';
import N from 'decimal.js';
import styled from 'styled-components';
import useInterval from 'use-interval';

import { Mutex } from 'async-mutex';

import AppContext from '../contexts/AppContext';
import Order from '../order';
import api from '../api';
import AssetSearch from './AssetSearch';
import Orderbook from './Orderbook';
import CoinInput from './CoinInput';

import {
	repeatAsync, handleError, handlePromise, getFillOrders, getAddressAssets,
	toTradeInfo, estimateSellFee, estimateBuyFee, createRawAccept, createRawPay,
	createRawOrder, fundAddress, signTx, sendTx, toUTXO, sendAlert, sendConfirm,
	getChainSends, chainSend, notify, log
} from '../util';
import {
	SATOSHI, TRADE_FEERATE, MIN_TRADE_FEE, PROPID_BITCOIN, PROPID_COIN,
	ACCOUNT_LABEL, BITTREX_TRADE_FEERATE, SYMBOL_CROSS_MARK, SYMBOL_CHECK_BUTTON,
	API_RETRIES, API_RETRIES_LARGE, OrderAction
} from '../constants';

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
	isNoHighFees: boolean,
	bids: BookData[],
	asks: BookData[],
	errmsg: string,
};

export type TraderAction = {
	type: "set_price" | "set_quantity" | "set_fee" | "set_total" | "set_available"
	| "set_divisible" | "set_confirm" | "set_nohighfees" | "set_ordertype"
	| "set_buysell" | "set_trade" | "set_base" | "set_bids" | "set_asks"
	| "set_errmsg",
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
			case "set_price": {
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
			case "set_quantity": {
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
			case "set_fee": {
				log().debug("set_fee")
				log().debug(action.payload)
				const fee = new N(action.payload).toDP(8);
				return {
					...state, fee,
					total: state.price.mul(state.quantity).add(fee).toDP(8),
				};
			}
			case "set_total": {
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
			}
			case "set_available":
				return { ...state, available: action.payload };
			case "set_divisible":
				return { ...state, isDivisible: action.payload };
			case "set_nohighfees":
				return { ...state, isNoHighFees: action.payload };
			case "set_ordertype": {
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
			case "set_errmsg":
				return { ...state, errmsg: action.payload };
			default:
				throw new Error("reducerTrade called with invalid action type "
					+ action.type);
		}
	}

const Trader = ({ state, dispatch }: TraderProps) => {
	const {
		consts, settings, getClient, addPendingOrder
	} = React.useContext(AppContext);

	const tradeMutex = React.useMemo(() => new Mutex(), []);
	const availMutex = React.useMemo(() => new Mutex(), []);
	const msgMutex = React.useMemo(() => new Mutex(), []);

	const cDispatch = (type: TraderAction["type"]) => (payload: any) =>
		dispatch({ type, payload });

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		const v = target.type === "checkbox" ? target.checked : target.value;
		const name = target.name;

		switch (name) {
			case "nohighfees": cDispatch("set_nohighfees")(v as boolean);
				break;
			default:
		}
	}

	const handleChangeSel = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const target = event.target;
		const value = target.value;
		const name = target.name;

		switch (name) {
			case "ordertype": cDispatch("set_ordertype")(value);
				break;
			case "buysell": cDispatch("set_buysell")(value);
				break;
		}
	}

	const refreshAvailable = () => availMutex.runExclusive(async () => {
		const client = getClient();
		if (client === null || consts === null) return;

		const { COIN_TICKER, COIN_BASE_TICKER } = consts;
		const API = api(client);

		if (state.trade === -1) return;

		if (state.trade === PROPID_COIN) {
			if (settings.apikey.length === 0 || settings.apisecret.length === 0)
				return;
			const balance = await
				handlePromise(repeatAsync(API.getBittrexBalance, API_RETRIES)
					(settings.apikey, settings.apisecret, state.buysell === "buy" ?
						COIN_BASE_TICKER : COIN_TICKER),
					"Could not get Bittrex balance");

			cDispatch("set_available")(balance !== null ?
				new N(balance.available) : new N(0));
			return;
		}

		let balance = null;
		if (state.buysell === "buy")
			balance = await
				handlePromise(repeatAsync(API.getCoinBalance, API_RETRIES)(),
					"Could not get coin balance");
		else
			balance = await
				handlePromise(repeatAsync(API.getWalletAssets, API_RETRIES_LARGE)(),
					"Could not get wallet balances", arr => {
						const entry = arr.find(v => v.propertyid === state.trade);
						return entry !== undefined ? entry.balance : null;
					});

		cDispatch("set_available")(balance !== null ? new N(balance) : new N(0));
	});

	React.useEffect(() => { refreshAvailable(); }, [state.trade, state.buysell]);
	useInterval(refreshAvailable, 30000);

	const getErrmsg = async () => {
		const client = getClient();
		if (client === null || consts === null) return "Client not initialized";

		const { COIN_TICKER, MIN_CHANGE } = consts;

		// case: unselected
		if (state.trade === -1 || state.base === -1)
			return "Please select assets to " + (state.trade * state.base === 1 ?
				"trade" : (state.trade === -1 ? "buy" : "sell"));

		// case: invalid asset pairs
		if (state.trade === state.base)
			return "Cannot trade assets of the same type";

		if (state.trade > PROPID_COIN && state.base === PROPID_BITCOIN)
			return "Cannot trade Omni assets to Bitcoin";

		// case: trade value is zero
		if (state.buysell === "buy" && state.total.eq(0)
			|| state.buysell === "sell" && state.quantity.eq(0))
			return "Trade value must be above zero";

		// case: trade value is below dust
		if (state.price.mul(state.quantity).lt(MIN_CHANGE))
			return "Total trade is too small, value must be at least"
				+ ` ${MIN_CHANGE} ${COIN_TICKER}`;

		// case: Bittrex trade without API key
		if (state.base === PROPID_BITCOIN
			&& (settings.apikey.length === 0 || settings.apisecret.length === 0))
			return "Cannot place trade on Bittrex without API key and secret. "
				+ "Please obtain one from your Bittrex account and input them "
				+ "into settings.";

		const API = api(client);

		// Omni trades
		if (state.base === PROPID_COIN) {
			if (state.buysell === "buy") {
				const coins = await handlePromise(repeatAsync(API.getCoinBalance,
					API_RETRIES)(), "Could not get wallet balance");
				if (coins === null) return `Could not query ${COIN_TICKER} balance`;

				// case: insufficient balance, coin
				if (state.total.gt(new N(coins)))
					return "Insufficient balance, have:"
						+ ` ${coins.toFixed(8)} ${COIN_TICKER}, need:`
						+ ` ${state.total.toFixed(8)} ${COIN_TICKER}`;
			} else {
				const assets = await
					handlePromise(repeatAsync(API.getWalletAssets, API_RETRIES)(),
						"Could not get wallet assets");
				if (assets === null) return "Could not query wallet assets";

				const asset = assets.filter(v => v.propertyid === state.trade);

				// case: insufficient balance, ASSET
				if (asset.length === 0 || state.quantity.gt(new N(asset[0].balance)))
					return "Insufficient balance, "
						+ `have: ${parseFloat(asset[0].balance).toFixed(8)} `
						+ `[ASSET #${state.trade}], `
						+ `need: ${state.quantity.toFixed(8)} `
						+ `[ASSET #${state.trade}]`;
			}
		}

		return null;
	};

	React.useEffect(() => {
		msgMutex.runExclusive(async () =>
			cDispatch("set_errmsg")(await getErrmsg()));
	}, [state.trade, state.buysell, state.price, state.quantity, state.total,
		settings, consts]);

	const doTrade = () => tradeMutex.runExclusive(async () => {
		const logger = log();

		// Need to validate again (null consts checked here)
		{
			const msg = await getErrmsg();
			if (msg !== null) {
				sendAlert(msg);
				cDispatch("set_errmsg")(msg);
				return;
			}
		}

		const { COIN_MARKET, COIN_TICKER, COIN_BASE_TICKER, MIN_CHANGE } = consts;

		const tradeInfo =
			`${state.orderType.toUpperCase()} ${state.buysell.toUpperCase()}`
			+ ` ${state.quantity.toFixed(8)} `
			+ (state.trade === PROPID_COIN ? COIN_TICKER : `[ASSET #${state.trade}]`)
			+ ` @${state.price.toFixed(8)} `
			+ (state.base === PROPID_COIN ? COIN_TICKER : COIN_BASE_TICKER);

		const c =
			sendConfirm(`Are you sure you want to place this trade? ${tradeInfo}`);
		if (!c) return;

		const client = getClient();

		if (client === null) {
			sendAlert("Client not initialized");
			return;
		}

		const API = api(client);

		// Bittrex trade, place Bittrex order and hope for the best
		if (state.base === PROPID_BITCOIN) {
			await API.makeBittrexOrder(settings.apikey, settings.apisecret,
				COIN_MARKET, state.buysell, state.orderType, state.quantity,
				state.price).then((v: BittrexOrder) => {
					notify("success", "Placed order", toTradeInfo(consts, v));
				}, err => handleError(err, "error"));
			return;
		}

		if (state.orderType === "limit" && state.buysell === "buy")
			sendAlert("Warning: the current version of this app does not support "
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
				sendAlert(`Fee too low, need at least ${tradeFee} ${COIN_TICKER}`);
				return;
			}

			// Fund a utxo that can cover everything
			utxo = await fundAddress(client, state.total);
			if (utxo === null) return;

			logger.debug("new utxo")
			logger.debug(utxo)

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

			// Need to collect assets from addresses
			let address;
			let chainSends = getChainSends(addressAssets, state.quantity);

			logger.debug("chainSends")
			logger.debug(chainSends)

			address = await handlePromise(repeatAsync(API.getNewAddress, API_RETRIES)
				(ACCOUNT_LABEL), "Could not create new address for sell order");
			if (address === null) return;

			logger.debug("address")
			logger.debug(address)

			const tradeFee = await
				estimateSellFee(consts, client, chainSends).catch(e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof estimateSellFee>>;
			if (tradeFee === null) return;

			logger.debug("tradeFee")
			logger.debug(tradeFee)

			// Fund this sell transaction
			utxo = await fundAddress(client, tradeFee.totalFee,
				chainSends.length > 0 ? chainSends[0].address : address);
			if (utxo === null) return;

			logger.debug("utxo")
			logger.debug(utxo)

			// Chain send the assets to [address]
			{
				const chain = await chainSend(consts, client, state.trade,
					chainSends, utxo, address, tradeFee.sendFee, waitTXs);
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

		const order = new Order(client, state.buysell, state.orderType, state.trade,
			state.quantity, state.price, state.fee, utxo.address, state.isNoHighFees,
			waitTXs, finaltx);

		logger.debug("add pending order")
		addPendingOrder(order);

		notify("success", "Created new order", toTradeInfo(consts, order));

		logger.debug("run order")
		order.run();
	});

	const setTrade = (propid: number) => {
		const API = api(getClient());

		cDispatch("set_trade")(propid);

		if (propid < PROPID_BITCOIN) return;

		repeatAsync(API.getProperty, API_RETRIES)(propid).then(p => p.divisible,
			_ => {
				handleError(new Error("Could not query property info"), "error");
				return true;
			}).then(divisible => cDispatch("set_divisible")(divisible));
	}

	const setMax = () => {
		if (state.available.eq(0)) return;
		if (state.buysell === "buy") cDispatch("set_total")(state.available);
		else cDispatch("set_quantity")(state.available);
	};

	{
		const { COIN_TICKER = "-", COIN_BASE_TICKER = "-" } = (consts ?? {});

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
									dispatch={cDispatch("set_price")}
									step={SATOSHI} />
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
									COIN_BASE_TICKER : COIN_TICKER}
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
									onChange={handleChangeSel}
									style={{ marginLeft: 8 }}>
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
									&& state.buysell === "buy" ? COIN_BASE_TICKER
									: (state.base === PROPID_COIN
										&& state.buysell === "sell" ?
										"Asset" : COIN_TICKER)}&nbsp;
								in wallet:
							</td>
							<td style={{
								textAlign: "right",
								paddingRight: "8px"
							}}>
								<input type="number" name="balance"
									className="coin form-field"
									value={state.available.toFixed(state.buysell ===
										"buy" ? 8 : (state.isDivisible ? 8 : 0))}
									min={0} readOnly />
							</td>
							<td style={{ fontSize: "9pt", textAlign: "right" }}>
								Total:
							</td>
							<td>
								<CoinInput value={state.total}
									dispatch={cDispatch("set_total")}
									step={SATOSHI} />
							</td>
						</tr>
						<tr style={{ paddingTop: "8px" }}>
							<td style={{ fontSize: "9pt" }} colSpan={2}>
								{state.errmsg ?
									`${SYMBOL_CROSS_MARK} ${state.errmsg}`
									: `${SYMBOL_CHECK_BUTTON} OK`}
							</td>
							<td colSpan={2}>
								<C.Trader.Buttons>
									<label style={{ flexGrow: 1 }}>
										<input type="checkbox" name="nohighfees"
											className="form-field"
											checked={state.isNoHighFees}
											onChange={handleChange} />
										Low accept fees
									</label>
									<button onClick={setMax}>Max</button>
									<button onClick={doTrade}
										disabled={state.errmsg !== null}>
										Confirm
									</button>
								</C.Trader.Buttons>
							</td>
						</tr>
					</tbody>
				</C.Trader.Inputs>
			</C.Trader.Body>
		</>;
	}
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
			box-sizing: border-box;
			height: 30px;
			padding: 0;
			line-height: 125%;
		}`,
		Buttons: styled.div`
		display: flex;
		flex-flow: row;
		align-items: center;
		font-size: 9pt;
		text-align: right;
		& > * ~ * {
			margin-left: 8px;
		}`,
	},
	Orderbook: styled.div`
	height: 100%;
	box-sizing: border-box;
	min-width: 600px;
	flex: 1;
	overflow: hidden;`
};

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
		isNoHighFees: true,
		bids: [],
		asks: [],
		errmsg: null,
	};

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