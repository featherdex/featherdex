import React from 'react';

import sum from 'lodash/fp/sum';

import AppContext from './contexts/AppContext';

import Order from './order';
import api from './api';
import AssetSearch from './AssetSearch';
import Orderbook from './Orderbook';

import {
	repeatAsync, handleError, handlePromise, getFillOrders, getAddressAssets,
	isNumber, roundn, toTradeInfo, estimateSellFee, estimateBuyFee, createRawAccept,
	createRawPay, createRawSend, createRawOrder, fundTx, signTx, sendTx, toUTXO,
	notify, log
} from './util';
import {
	SATOSHI, MIN_CHANGE, TRADE_FEERATE, MIN_TRADE_FEE,
	PROPID_BITCOIN, PROPID_FEATHERCOIN, ACCOUNT_LABEL, OrderAction
} from './constants';

export type TraderState = {
	trade: number,
	base: number,
	price: number,
	quantity: number,
	fee: number,
	total: number,
	orderType: "market" | "limit",
	buysell: "buy" | "sell",
	isDivisible: boolean,
	isConfirm: boolean,
	isNoHighFees: boolean,
	bids: BookData[],
	asks: BookData[],
}

export type TraderAction = {
	type: "set_price" | "set_quantity" | "set_fee" | "set_total"
	| "set_divisible" | "set_confirm" | "set_nohighfees" | "set_ordertype"
	| "set_buysell" | "set_trade" | "set_base" | "set_bids" | "set_asks",
	payload?: any,
};

type TraderProps = {
	state: TraderState,
	dispatch: (v: TraderAction) => any,
	addPendingCallback: (order: Order) => void,
}

const reducerTrade =
	(state: TraderState, action: TraderAction): TraderState => {
		const getBest = (side: "buy" | "sell") => {
			const bestBook = side === "buy" ?
				state.asks[0] : state.bids[0];
			return bestBook ? bestBook.price : 0;
		};

		const getFee = (price: number, quantity: number) => {
			const fee = price * quantity * TRADE_FEERATE;
			return fee >= MIN_TRADE_FEE ? fee : MIN_TRADE_FEE;
		};

		switch (action.type) {
			case "set_price":
				{
					const price = action.payload;
					let v = { ...state, price: price };
					if (v.base === PROPID_BITCOIN) {
						const fee = getFee(price, state.quantity);
						v = { ...v, fee: fee, total: price * state.quantity + fee };
					} else
						v = { ...v, total: price * state.quantity + state.fee };
					return v;
				}
			case "set_quantity":
				{
					const quantity = action.payload;
					let v = { ...state, quantity: quantity };
					if (v.base === PROPID_BITCOIN) {
						const fee = state.price * quantity * 0.003;
						v = { ...v, fee: fee, total: state.price * quantity + fee };
					} else
						v = { ...v, total: state.price * quantity + state.fee };
					return v;
				}
			case "set_fee":
				return {
					...state, fee: action.payload,
					total: roundn(state.price * state.quantity + action.payload, 8),
				};
			case "set_total":
				const fee = state.base === PROPID_BITCOIN ?
					action.payload * 0.003 / 1.003 : state.fee;

				const pretotal = action.payload - fee;
				const total = Math.max(state.isDivisible ?
					action.payload : (state.price > 0 ?
						roundn(((action.payload >= state.total ?
							Math.ceil : Math.floor)
							(Math.round(pretotal / SATOSHI)
								/ Math.round(state.price / SATOSHI))
							* Math.round(state.price / SATOSHI)
							+ Math.round(fee / SATOSHI)) * SATOSHI, 8) : fee), fee);
				return {
					...state,
					total: total,
					fee: fee,
					quantity: state.price === 0 ?
						0 : (total - fee) / state.price,
				};
			case "set_divisible":
				return { ...state, isDivisible: action.payload };
			case "set_confirm":
				return { ...state, isConfirm: action.payload };
			case "set_nohighfees":
				return { ...state, isNoHighFees: action.payload };
			case "set_ordertype":
				{
					let v = { ...state, orderType: action.payload };
					if (v.orderType === "market") {
						v = { ...v, price: getBest(v.buysell) };
					}
					return v;
				}
			case "set_buysell":
				return { ...state, buysell: action.payload };
			case "set_trade":
				return {
					...state,
					trade: action.payload,
					base: action.payload === PROPID_FEATHERCOIN ?
						PROPID_BITCOIN : PROPID_FEATHERCOIN,
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

const Trader = ({ state, dispatch, addPendingCallback }: TraderProps) => {
	const { settings, client } = React.useContext(AppContext);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		const value = target.type === "checkbox" ?
			target.checked : target.value;
		const name = target.name;

		if (isNumber(value)) {
			if (name === "price")
				dispatch({
					type: "set_price", payload: parseFloat(value as string)
				});
			else if (name === "quantity")
				dispatch({
					type: "set_quantity", payload: parseFloat(value as string)
				});
			else if (name === "fee")
				dispatch({
					type: "set_fee", payload: parseFloat(value as string)
				});
			else if (name === "total")
				dispatch({
					type: "set_total", payload: parseFloat(value as string)
				});
		} else if (name === "confirm")
			dispatch({ type: "set_confirm", payload: value as boolean });
		else if (name === "nohighfees")
			dispatch({ type: "set_nohighfees", payload: value as boolean });
	}

	const handleChangeSel = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const target = event.target;
		const value = target.value;
		const name = target.name;

		if (name === "baseasset")
			dispatch({
				type: "set_base",
				payload: value === "btc" ? PROPID_BITCOIN :
					(value === "ftc" ? PROPID_FEATHERCOIN : -1),
			});
		else if (name === "ordertype")
			dispatch({ type: "set_ordertype", payload: value });
		else if (name === "buysell")
			dispatch({ type: "set_buysell", payload: value });
	}

	const doTrade = async () => {
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

		if (state.trade > PROPID_FEATHERCOIN && state.base === PROPID_BITCOIN) {
			alert("Cannot trade Omni assets to Bitcoin");
			return;
		}

		// case: trade value is zero
		if (state.buysell === "buy" && state.total === 0
			|| state.buysell === "sell" && state.quantity === 0) {
			alert("Cannot place zero-value trade");
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
			+ ` ${state.quantity.toFixed(8)}`
			+ ` ${state.trade === PROPID_FEATHERCOIN ?
				"FTC" : `[ASSET #${state.trade}]`}`
			+ ` @${state.price.toFixed(8)} ${state.base === PROPID_FEATHERCOIN ?
				"FTC" : "BTC"}`;

		if (state.isConfirm) {
			const c = confirm("Are you sure you want to place this trade? "
				+ tradeInfo);
			if (!c) return;
		}

		const API = api(client);

		// Omni trade
		if (state.base === 1) {
			if (state.buysell === "buy") {
				const coins = await handlePromise(repeatAsync
					(API.getCoinBalance, 5)(), "Could not get wallet balance");
				if (coins === null) return;

				// case: insufficient balance, FTC
				if (state.total > coins) {
					handleError(new Error("Insufficient balance, "
						+ `have: ${coins.toFixed(8)} FTC, need: `
						+ `${state.total.toFixed(8)} FTC`), "error");
					return;
				}
			} else {
				const assets = await handlePromise(repeatAsync
					(API.getWalletAssets, 5)(), "Could not get wallet assets")
				if (assets === null) return;

				const asset = assets.filter(v => v.propertyid === state.trade);

				// case: insufficient balance, ASSET
				if (asset.length === 0
					|| state.quantity > parseFloat(asset[0].balance)) {
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
				state.buysell, state.orderType, state.quantity, state.price)
				.then((v: BittrexOrder) => {
					notify("success", "Placed order", toTradeInfo(v));
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
			log.debug("entering buy")
			// Do a rough estimate to check if the fee specified is enough to cover
			// all subsequent transaction fees

			// Grab UTXOs
			const utxos = await handlePromise(repeatAsync(API.listUnspent, 3)(),
				"Could not get UTXOs");
			if (utxos == null) return;

			if (utxos.length === 0) {
				handleError(new Error("No available UTXOs for transaction"),
					"error");
				return;
			}

			log.debug("utxos")
			log.debug(utxos)

			const fillOrders = await getFillOrders(client, state.trade,
				state.quantity, state.isNoHighFees).then(v => v.fillOrders, e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof getFillOrders>>["fillOrders"];
			if (fillOrders === null) return;

			log.debug("fillOrders")
			log.debug(fillOrders)

			if (fillOrders.length === 0) {
				handleError(new Error("Could not find any sell orders to fill"),
					"error");
				return;
			}

			const tradeFee = await
				estimateBuyFee(client, fillOrders.length).catch(e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof estimateBuyFee>>;
			if (tradeFee === null) return;

			log.debug("tradeFee")
			log.debug(tradeFee)

			// case: set fee is smaller than minimum
			if (state.fee < tradeFee.totalFee) {
				alert(`Fee too low, need at least ${tradeFee} FTC`);
				return;
			}

			log.debug("find utxo loop")
			// Try to find a UTXO that can cover everything
			for (let i of utxos)
				if (i.amount >= state.total) {
					utxo = i;
					break;
				}

			log.debug("utxo")
			log.debug(utxo)

			// If we can't, make one by grouping UTXO inputs
			if (!utxo) {
				log.debug("regroup")
				// create new address
				const newAddress = await
					handlePromise(repeatAsync(API.getNewAddress, 3)(ACCOUNT_LABEL),
						"Could not create new address for grouping");
				if (newAddress === null) return;

				log.debug("newAddress")
				log.debug(newAddress)

				log.debug("createRawTransaction")

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

				log.debug("new utxo")
				log.debug(utxo)
			}

			log.debug("send accepts loop")
			// Send all accepts
			let acceptedOrders: typeof fillOrders = [];
			for (let i of fillOrders) {
				log.debug("fillOrder")
				log.debug(i)

				const skipErrorMsg = "Could not fill order from seller "
					+ `${i.address}, skipping`;

				log.debug("createRawAccept")

				const accept = await createRawAccept(client, i.address, state.trade,
					i.quantity, utxo, tradeFee.acceptFee).catch(e => {
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

				log.debug("push waitTX")
				// Push to wait queue, wait for all before sending purchase
				waitTXs.push(sendtx);

				// Make the new UTXO the output of the completed transaction
				utxo = toUTXO(sendtx, 0, utxo.address,
					roundn(utxo.amount - MIN_CHANGE - tradeFee.acceptFee, 8));

				log.debug("new utxo")
				log.debug(utxo)
			}

			// Create and sign pay transaction, pass to Order object for later
			{
				const pretx: string = await
					createRawPay(client, acceptedOrders.map(order =>
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

			log.debug("end buy")
		} else { // sell
			log.debug("enter sell")

			const addressAssets = await
				getAddressAssets(client, state.trade).catch(e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof getAddressAssets>>;
			if (addressAssets === null) return;

			if (addressAssets.length === 0) {
				handleError(new Error("No available assets found for "
					+ `[ASSET #${state.trade}]. Check that addresses with assets`
					+ "have enough FTC for transactions."),
					"error");
				return;
			}

			log.debug("addressAssets")
			log.debug(addressAssets)

			let address;
			let reshuffleAddresses: { address: string, amount: number }[] = [];
			{
				const asset = addressAssets.find(v =>
					v.amount >= state.quantity && !v.occupied && !v.pending);
				if (!!asset) address = asset.address;
			}

			log.debug("find big address")
			log.debug(address)

			// Need to group addresses
			if (!address) {
				let remaining = state.quantity;

				// Collect send inputs
				for (let i of addressAssets) {
					log.debug("addressAsset")
					log.debug(i)
					log.debug("remaining")
					log.debug(remaining)
					if (i.amount >= remaining) {
						log.debug("exiting loop")
						reshuffleAddresses.push({
							address: i.address, amount: remaining
						});
						break;
					}

					reshuffleAddresses.push({
						address: i.address, amount: i.amount
					});
					remaining -= i.amount;
				}

				log.debug("reshuffleAddresses")
				log.debug(reshuffleAddresses)

				address = await handlePromise(repeatAsync(API.getNewAddress, 5)
					(ACCOUNT_LABEL), "Could not create new address for sell order");
				if (address === null) return;

				log.debug("address")
				log.debug(address)
			}

			const tradeFee = await
				estimateSellFee(client, reshuffleAddresses.length).catch(e => {
					handleError(e, "error");
					return null;
				}) as Awaited<ReturnType<typeof estimateSellFee>>;
			if (tradeFee === null) return;

			log.debug("tradeFee")
			log.debug(tradeFee)

			// Fund this sell transaction
			{
				const firstAddress = reshuffleAddresses.length > 0 ?
					reshuffleAddresses[0].address : address;

				log.debug("firstAddress")
				log.debug(firstAddress)

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

				log.debug("utxo")
				log.debug(utxo)
			}

			log.debug("chain send tx loop")
			// Chain send transactions
			for (let i = 0; i < reshuffleAddresses.length; i++) {
				const nextAddress = i === reshuffleAddresses.length - 1 ?
					address : reshuffleAddresses[i + 1].address;
				const amount = reshuffleAddresses[i].amount;

				log.debug(`i=${i} nextAddress=${nextAddress} amount=${amount}`)
				log.debug("createRawSend")
				const rawtx = await createRawSend(client, nextAddress, state.trade,
					amount, utxo, tradeFee.sendFee).catch(e => {
						handleError(e, "error");
						return null;
					});
				if (rawtx === null) return;

				const signedtx = await signTx(client, rawtx,
					"Could not sign raw reshuffle transaction for sell");
				if (signedtx === null) return;

				const sendtx = await sendTx(client, signedtx,
					"Could not send raw reshuffle transaction for sell");
				if (sendtx === null) return;

				log.debug("push wait")
				// Push to waiting queue, wait for all then send in order
				waitTXs.push(sendtx);

				utxo = toUTXO(sendtx, 0, nextAddress,
					roundn(utxo.amount - tradeFee.sendFee, 8));

				log.debug("new utxo")
				log.debug(utxo)
			}

			// Now from [address] create the order transaction
			{
				log.debug("createRawOrder")
				const rawtx = await createRawOrder(client, state.trade,
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

		log.debug("waitTXs")
		log.debug(waitTXs)

		log.debug("create order")

		const order = new Order(client, state.buysell, state.orderType,
			state.trade, state.quantity, state.price, state.fee,
			utxo.address, state.isNoHighFees, waitTXs, finaltx);

		log.debug("add pending order")
		addPendingCallback(order);

		notify("success", "Created new order", toTradeInfo(order));

		log.debug("run order")
		order.run();
	};

	const setTrade = (propid: number) => {
		const API = api(client);

		dispatch({ type: "set_trade", payload: propid });

		repeatAsync(API.getProperty, 5)(propid).then(p => p.divisible, _ => {
			handleError(new Error("Could not query property info"), "error");
			return true;
		}).then(divisible =>
			dispatch({ type: "set_divisible", payload: divisible }));
	}

	return <>
		<div className="trader-body">
			<table className="trader-inputs">
				<thead><tr>
					<th className="trader-header" colSpan={4}>Place a trade</th>
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
								filter={v => v.id !== 0}
								zIndex={2} />
						</td>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Price:
						</td>
						<td>
							<input type="number" name="price"
								className="coin form-field"
								value={state.price.toFixed(8)} step={SATOSHI}
								min={0} onChange={handleChange}
								disabled={state.orderType === "market"} />
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
							fontSize: "10pt",
							textAlign: "right",
						}}>
							{state.trade === 1 ?
								"BTC / Bitcoin" : "FTC / Feathercoin"}
						</td>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Quantity:
						</td>
						<td>
							<input type="number" name="quantity"
								className="coin form-field"
								value={state.quantity.toFixed(state.isDivisible ?
									8 : 0)} step={state.isDivisible ? SATOSHI : 1}
								min={0} onChange={handleChange}
								disabled={state.orderType === "market"
									&& state.buysell === "buy"} />
						</td>
					</tr>
					<tr>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Buy/Sell:
						</td>
						<td style={{
							textAlign: "right",
							paddingRight: "8px"
						}}>
							<select name="buysell" value={state.buysell}
								onChange={handleChangeSel}>
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
								value={state.fee.toFixed(8)} step={SATOSHI}
								min={0} onChange={handleChange} readOnly />
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
								<option value="market">Market</option>
								<option value="limit">Limit</option>
							</select>
						</td>
						<td style={{ fontSize: "9pt", textAlign: "right" }}>
							Total:
						</td>
						<td>
							<input type="number" name="total"
								className="coin form-field"
								value={state.total.toFixed(8)} step={SATOSHI}
								min={0} onChange={handleChange}
								disabled={state.orderType === "market"
									&& state.buysell === "sell"} />
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
							}} onClick={doTrade}>Confirm</button>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</>;
};

type TradeProps = {
	addPendingCallback: (order: Order) => void,
};

const Trade = ({ addPendingCallback }: TradeProps) => {
	const initialState: TraderState = {
		trade: -1,
		base: PROPID_FEATHERCOIN,
		price: 0,
		quantity: 0,
		fee: 0,
		total: 0,
		orderType: "limit",
		buysell: "buy",
		isDivisible: true,
		isConfirm: true,
		isNoHighFees: true,
		bids: [],
		asks: [],
	}

	const [state, dispatch] = React.useReducer(reducerTrade, initialState);

	return <>
		<div className="trader">
			<Trader state={state} dispatch={dispatch}
				addPendingCallback={addPendingCallback} />
		</div>
		<div className="orderbook">
			<Orderbook state={state} dispatch={dispatch} />
		</div>
	</>;
};

export default Trade;