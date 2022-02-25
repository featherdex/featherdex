"use strict";

import fetch from 'node-fetch';
import CryptoJS from 'crypto-js';
import N from 'decimal.js';

import { DateTime } from 'luxon';
import { BarData, UTCTimestamp } from 'lightweight-charts';

const Client = require('bitcoin-core');

import {
	COINBASE_API_ENDPOINT, BITTREX_API_ENDPOINT, COIN_FEERATE, MIN_ACCEPT_FEE,
	BLOCK_WAIT, PAY_BLOCK_LIMIT, TYPE_ACCEPT_OFFER, TYPE_SELL_OFFER
} from './constants';

const api = (client: typeof Client) => {
	function API() { };

	const BittrexError = new Error("Could not connect to Bittrex, " +
		"check your internet connection.");
	const CoinbaseError = new Error("Could not connect to Coinbase, " +
		"check your internet connection.");
	const JSONError = (text: string) =>
		new Error(`Could not parse JSON from text ${text}`);

	const optArgParse = (...args: any[]) => {
		let pargs = [];

		for (let i of args)
			if (i === null || i === undefined) break;
			else pargs.push(i);

		return pargs;
	};

	const toBarData = (v: BittrexCandle): BarData => {
		return {
			time: Math.floor(DateTime.fromISO(v.startsAt)
				.toSeconds()) as UTCTimestamp,
			open: parseFloat(v.open),
			high: parseFloat(v.high),
			low: parseFloat(v.low),
			close: parseFloat(v.close)
		};
	};

	const doAuthRequest = (apiKey: string, apiSecret: string,
		uri: string, method: "GET" | "POST" | "DELETE",
		requestBody?: Record<string, any>) => {
		const timestamp = DateTime.now().toMillis();
		const contentHash = CryptoJS.SHA512(JSON.stringify(requestBody) || "")
			.toString(CryptoJS.enc.Hex);
		const preSign = [timestamp, uri, method, contentHash].join('');
		const signature = CryptoJS.HmacSHA512(preSign, apiSecret)
			.toString(CryptoJS.enc.Hex);

		let options: RequestOptions = {
			method: method, headers: {
				"Content-Type": "application/json",
				"Api-Key": apiKey,
				"Api-Timestamp": timestamp,
				"Api-Content-Hash": contentHash,
				"Api-Signature": signature,
			}
		};

		if (requestBody)
			options = { ...options, body: JSON.stringify(requestBody) };

		return fetch(uri, options)
			.then(r => r.json(),
				_ => { throw BittrexError }).then(v => {
					let err = v as BittrexErrorType;
					let errmsg;

					if (err.code) errmsg = err.code;
					if (err.detail) errmsg += `: ${err.detail}`;
					if (err.data) errmsg += `, data: ${JSON.stringify(err.data)}`;

					if (errmsg) throw new Error(errmsg);

					return v;
				});
	};

	API.isDaemonUp = () => client.command("uptime")
		.then((_: any) => true, (_: Error) => false);

	API.decodeTransaction = (rawtx: string): Promise<RawTx> =>
		client.command("decoderawtransaction", rawtx);
	API.getOmniTransaction = (txid: string) =>
		client.command("omni_gettransaction", txid);
	API.getTransaction = (txid: string): Promise<Tx> =>
		client.command("gettransaction", txid);
	API.getRawTransaction =
		(txid: string, verbose?: boolean): Promise<string | RawTx> =>
			client.command("getrawtransaction", txid, !!verbose);
	API.getBlock = async (blockhash: string, blockTimeStruct?: BlockTimeStruct):
		Promise<Block> => {
		const block: Block = await client.command("getblock", blockhash);
		if (!!blockTimeStruct) blockTimeStruct.push(block.time, block.height);
		return block;
	}
	API.getBlockHash = (height: number): Promise<string> =>
		client.command("getblockhash", height);
	API.getBlockchainInfo = (): Promise<BlockchainInfo> =>
		client.command("getblockchaininfo");
	API.getNetworkInfo = (): Promise<NetworkInfo> =>
		client.command("getnetworkinfo");
	API.estimateFee = (): Promise<number> =>
		client.command("estimatesmartfee", BLOCK_WAIT).then((v: FeeEstimate) =>
			v.feerate ?? COIN_FEERATE);

	// Get the first block on or after a timestamp and return the height
	API.getBlockNumber = async (time: UTCTimestamp, genesisTime: UTCTimestamp,
		blockTimeStruct?: BlockTimeStruct) => {
		const height = (await API.getBlockchainInfo()).blocks;

		if (time >= DateTime.now().toSeconds())
			return -1;
		if (time <= genesisTime) return 1;

		let lower = 1, upper = height;

		// If we have times in the cache then update our range the best we can
		if (!!blockTimeStruct) {
			const lowerNode = blockTimeStruct.cache.le(time),
				upperNode = blockTimeStruct.cache.ge(time);

			if (lowerNode.valid) {
				lower = lowerNode.value;
				// If the time is above the lower node's time and the lower node's
				// block is the blockchain height then we're completely out of range
				// and must invalidate
				if (time > lowerNode.key && lower === height) return -1;
			}
			if (upperNode.valid) upper = upperNode.value;
		}

		if (lower === upper) return lower;

		// Perform binary search
		do {
			const mid = Math.floor((lower + upper) / 2);
			const block = await API.getBlock(await API.getBlockHash(mid),
				blockTimeStruct);

			if (time <= block.time) upper = mid;
			else lower = mid + 1;
		} while (lower !== upper);

		return lower;
	};

	API.getCoinBook = async (market: string): Promise<BittrexBook> =>
		fetch(`${BITTREX_API_ENDPOINT}/markets/${market}/orderbook`)
			.then(r => r.json(),
				_ => { throw BittrexError; }) as Promise<BittrexBook>;

	API.getCoinTicker = async (market: string) => {
		const ticker = await
			fetch(`${BITTREX_API_ENDPOINT}/markets/${market}/ticker`)
				.then(r => r.json().catch(async _ => {
					throw JSONError(await r.text());
				}), _ => { throw BittrexError; }) as BittrexTicker;

		const summary = await
			fetch(`${BITTREX_API_ENDPOINT}/markets/${market}/summary`)
				.then(r => r.json().catch(async _ => {
					throw JSONError(await r.text());
				}), _ => { throw BittrexError; }) as BittrexSummary;

		const trades = await
			fetch(`${BITTREX_API_ENDPOINT}/markets/${market}/trades`)
				.then(r => r.json().catch(async _ => {
					throw JSONError(await r.text());
				}), _ => { throw BittrexError; }) as BittrexTrade[];

		const lastTime = trades.length > 0 ?
			DateTime.fromISO(trades[0].executedAt).toLocal() : null;
		const last = parseFloat(ticker.lastTradeRate);
		const chgp = parseFloat(summary.percentChange) / 100;

		return {
			last: { time: lastTime, price: last },
			chg: last - last / (chgp + 1),
			chgp: chgp,
			bid: parseFloat(ticker.bidRate),
			ask: parseFloat(ticker.askRate),
			vol: parseFloat(summary.volume),
		};
	};

	API.getCoinOHLC = (market: string, interval: string,
		year: number, month?: number, day?: number): Promise<BarData[]> =>
		fetch(`${BITTREX_API_ENDPOINT}/markets/${market}/candles/`
			+ `TRADE/${interval}/historical/${year}` +
			(month ? `/${month}` : "") + (day ? `/${day}` : ""))
			.then(r => r.json(), _ => { throw BittrexError; })
			.then((data: BittrexCandle[]) => data.map(toBarData));

	API.getCoinOHLCRecent = (market: string, interval: string): Promise<BarData[]> =>
		fetch(`${BITTREX_API_ENDPOINT}/markets/${market}/candles/`
			+ `TRADE/${interval}/recent`)
			.then(r => r.json(), _ => { throw BittrexError; })
			.then((data: BittrexCandle[]) => data.map(toBarData));

	API.getExchangeRates = (currency: string): Promise<CoinbaseRate> =>
		fetch(`${COINBASE_API_ENDPOINT}/exchange-rates?currency=${currency}`)
			.then(r => r.json(), _ => { throw CoinbaseError; }).then(v =>
				v as CoinbaseRate);

	API.getCoinBalance = (): Promise<number> => client.command("getbalance");
	API.getAssetBalance = (address: string, asset: number): Promise<Balance> =>
		client.command("omni_getbalance", address, asset);
	API.getAddressAssets = (address: string): Promise<AssetBalance[]> =>
		client.command("omni_getallbalancesforaddress", address);
	API.getWalletAssets = (): Promise<AssetBalance[]> =>
		client.command("omni_getwalletbalances");
	API.getWalletAddressAssets = (): Promise<AddressBalance[]> =>
		client.command("omni_getwalletaddressbalances");
	API.getProperty = (asset: number): Promise<AssetInfo> =>
		client.command("omni_getproperty", asset);
	API.listProperties = (): Promise<AssetInfo[]> =>
		client.command("omni_listproperties");
	API.listTransactions =
		(startblock?: number, endblock?: number): Promise<(OmniTx & BlockInfo)[]> =>
			client.command("omni_listtransactions",
				...optArgParse("*", 9999999, 0, startblock, endblock));
	API.listAddressGroupings = (): Promise<any[][][]> =>
		client.command("listaddressgroupings");
	API.listUnspent = (filteraddrs = [] as string[]): Promise<UTXO[]> =>
		client.command("listunspent", 0, 9999999, filteraddrs);
	API.getNewAddress = (label = "", type = "p2sh-segwit"): Promise<string> =>
		client.command("getnewaddress", label, type);
	API.getExchangeSells = (): Promise<DexSell[]> =>
		client.command("omni_getactivedexsells");
	API.getPendingTxs = (): Promise<OmniTx[]> =>
		client.command("omni_listpendingtransactions");
	API.getPendingAccepts =
		async (propid?: number, pendingTxs?: OmniTx[]):
			Promise<DexAccept[]> =>
			(pendingTxs || await API.getPendingTxs()).filter(v =>
				v.type_int === TYPE_ACCEPT_OFFER
				&& (propid !== undefined ?
					(v as DexAccept).propertyid === propid : true)) as DexAccept[];
	API.getPendingCancels = async (propid: number, pendingTxs?: OmniTx[]):
		Promise<DexOrder[]> =>
		(pendingTxs || await API.getPendingTxs()).filter(v =>
			v.type_int === TYPE_SELL_OFFER && (v as DexOrder).action === "cancel"
			&& (v as DexOrder).propertyid === propid) as DexOrder[];
	API.getPayload =
		(txid: string): Promise<{ payload: string, payloadsize: number }> =>
			client.command("omni_getpayload", txid);

	API.calcTxFee = async (rawtx: RawTx): Promise<number> => {
		const calcTotalOut = (outs: typeof rawtx.vout) =>
			outs.map(v => v.value).reduce((pv, v) => pv + v);

		const totalOut = calcTotalOut(rawtx.vout);
		const totalIn = await Promise.all(rawtx.vin.map(vin =>
			API.getRawTransaction(vin.txid, true))).then(rawtx =>
				(rawtx as RawTx[]).map(w =>
					calcTotalOut(w.vout)).reduce((pv, v) => pv + v));

		return totalIn - totalOut;
	};

	API.getNFTRanges = (propid: number): Promise<NFTRange[]> =>
		client.command("omni_getnonfungibletokenranges", propid);
	API.getNFTData = (propid: number, idx?: number): Promise<NFTInfo[]> =>
		client.command("omni_getnonfungibletokendata", ...optArgParse(propid, idx));

	API.makeAccept = (fromaddr: string, toaddr: string, propid: number,
		amount: N): Promise<string> =>
		client.command("omni_senddexaccept", fromaddr, toaddr, propid,
			amount.toFixed(8));
	API.makeOrder = (address: string, propid: number, quantity: N, price: N,
		timelimit = PAY_BLOCK_LIMIT, minfee = MIN_ACCEPT_FEE): Promise<string> =>
		client.command("omni_sendnewdexorder", address, propid, quantity.toFixed(8),
			quantity.mul(price).toFixed(8), timelimit, minfee.toFixed(8));
	API.updateOrder = (address: string, propid: number, quantity: N, price: N,
		timelimit = PAY_BLOCK_LIMIT, minfee = MIN_ACCEPT_FEE): Promise<string> =>
		client.command("omni_sendupdatedexorder", address, propid,
			quantity.toFixed(8), quantity.mul(price).toFixed(8), timelimit,
			minfee.toFixed(8));
	API.cancelOrder = (address: string, propid: number): Promise<string> =>
		client.command("omni_sendcanceldexorder", address, propid);

	API.createPayloadSend = (propid: number, amount: N): Promise<string> =>
		client.command("omni_createpayload_simplesend", propid, amount.toFixed(8));
	API.createPayloadAccept = (propid: number, amount: N): Promise<string> =>
		client.command("omni_createpayload_dexaccept", propid, amount.toFixed(8));
	API.createPayloadOrder = (propid: number, quantity: N, price: N, action: number,
		timelimit = PAY_BLOCK_LIMIT, minfee = MIN_ACCEPT_FEE): Promise<string> =>
		client.command("omni_createpayload_dexsell", propid, quantity.toFixed(8),
			quantity.mul(price).toFixed(8), timelimit, minfee.toFixed(8), action);
	API.createPayloadFixed = (ecosystem: number, type: number, previousid: number,
		category: string, subcategory: string, name: string, url: string,
		data: string, amount: N): Promise<string> =>
		client.command("omni_createpayload_issuancefixed", ecosystem, type,
			previousid, category, subcategory, name, url, data, amount.toFixed(8));
	API.createPayloadManaged = (ecosystem: number, type: number, previousid: number,
		category: string, subcategory: string, name: string, url: string,
		data: string): Promise<string> =>
		client.command("omni_createpayload_issuancemanaged", ecosystem, type,
			previousid, category, subcategory, name, url, data);
	API.createPayloadIssuer = (propid: number): Promise<string> =>
		client.command("omni_createpayload_changeissuer", propid);
	API.createPayloadSetNFT = (propid: number, tokenStart: number, tokenEnd: number,
		isIssuer: boolean, data: string): Promise<string> => {
		// TODO remove when client is fixed
		const buf = Buffer.alloc(26 + data.length);
		buf.writeUInt32BE(0xc9);
		buf.writeUInt32BE(propid, 4);
		buf.writeBigUInt64BE(BigInt(tokenStart), 8);
		buf.writeBigUInt64BE(BigInt(tokenEnd), 16);
		buf.writeUInt8(isIssuer ? 1 : 0, 24);
		buf.write(data, 25);

		return new Promise((resolve, _) => resolve(buf.toString("hex")));

		/* TODO enable when client is fixed
		client.command("omni_createpayload_setnonfungibledata", propid, tokenStart,
			tokenEnd, isIssuer, data); */
	}
	API.createPayloadGrant = (propid: number, amount: N, grantdata?: string) =>
		client.command("omni_createpayload_grant", propid, amount.toFixed(8),
			grantdata ?? "");
	API.createPayloadRevoke = (propid: number, amount: N, memo?: string) =>
		client.command("omni_createpayload_revoke",
			...optArgParse(propid, amount.toFixed(8), memo));

	API.createRawTxOpReturn =
		(rawtx: string, payload: string): Promise<string> =>
			client.command("omni_createrawtx_opreturn", rawtx, payload);
	API.createRawTxMultisig =
		(rawtx: string, payload: string, senderAddress: string, dustAddress: string):
			Promise<string> =>
			client.command("omni_createrawtx_multisig", rawtx, payload,
				senderAddress, dustAddress);
	API.createRawTransaction = (blueprint: RawTxBlueprint): Promise<string> =>
		client.command("createrawtransaction", blueprint.ins, blueprint.outs);
	API.signRawTransaction =
		(rawtx: string): Promise<{ hex: string, complete: boolean }> =>
			client.command("signrawtransaction", rawtx);
	API.fundRawTransaction = (rawtx: string, options = {} as FundRawOptions):
		Promise<{ hex: string, fee: number, changepos: number }> =>
		client.command("fundrawtransaction", rawtx, options);
	API.sendRawTransaction = (signedtx: string): Promise<string> =>
		client.command("sendrawtransaction", signedtx);

	API.sendToAddress = (address: string, amount: N) =>
		client.command("sendtoaddress", address, +amount);

	API.getBittrexMktHistory = (market: string): Promise<BittrexTrade[]> =>
		fetch(`${BITTREX_API_ENDPOINT}/markets/${market}/trades`).then(r =>
			r.json(), _ => { throw BittrexError; });
	API.getBittrexBalance = (apiKey: string, apiSecret: string, currency: string):
		Promise<BittrexBalance> =>
		doAuthRequest(apiKey, apiSecret,
			`${BITTREX_API_ENDPOINT}/balances/${currency}`,
			"GET") as Promise<BittrexBalance>;

	API.getBittrexOrders = (apiKey: string, apiSecret: string, market: string):
		Promise<BittrexOrder[]> => doAuthRequest(apiKey, apiSecret,
			`${BITTREX_API_ENDPOINT}/orders/open?marketSymbol=${market}`,
			"GET") as Promise<BittrexOrder[]>;

	API.getBittrexHistory = (apiKey: string, apiSecret: string,
		market: string): Promise<BittrexOrder[]> =>
		doAuthRequest(apiKey, apiSecret,
			`${BITTREX_API_ENDPOINT}/orders/closed?marketSymbol=${market}`,
			"GET") as Promise<BittrexOrder[]>;

	API.makeBittrexOrder = (apiKey: string, apiSecret: string, market: string,
		buysell: "buy" | "sell", orderType: "market" | "limit", quantity: N,
		price?: N) => {
		let body: BittrexNewOrder = {
			marketSymbol: market,
			direction: buysell.toUpperCase() as ("BUY" | "SELL"),
			type: orderType.toUpperCase() as ("MARKET" | "LIMIT"),
			timeInForce: orderType === "market"
				? "IMMEDIATE_OR_CANCEL" : "GOOD_TIL_CANCELLED",
			quantity: quantity.toFixed(8),
		};

		if (orderType === "limit") body = { ...body, limit: price.toFixed(8) };

		return doAuthRequest(apiKey, apiSecret,
			`${BITTREX_API_ENDPOINT}/orders`, "POST", body);
	};

	API.cancelBittrexOrder =
		(apiKey: string, apiSecret: string, orderid: string):
			Promise<BittrexOrder> => doAuthRequest(apiKey, apiSecret,
				`${BITTREX_API_ENDPOINT}/orders/${orderid}`,
				"DELETE") as Promise<BittrexOrder>;

	API.setLabel = (address: string, label = "") =>
		client.command("setlabel", address, label);

	API.getAddressInfo = (address: string): Promise<AddressInfo> =>
		client.command("getaddressinfo", address);
	API.validateAddress = (address: string): Promise<AddressValidate> =>
		client.command("validateaddress", address);

	return API;
}

export default api;