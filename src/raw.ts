import N from 'decimal.js';
import Client from 'bitcoin-core';

import api from './api';

import { ACCOUNT_LABEL, OrderAction } from './constants';
import { repeatAsync, dsum, log } from './util';

async function createRawTxPayload(consts: PlatformConstants, client: typeof Client,
	payload: string, inUTXO: UTXO, fee: N, changeAddress = inUTXO.address) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	const change = new N(inUTXO.amount).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error("Could not create raw transaction, fee too high");

	log().debug("inUTXO")
	log().debug(inUTXO)
	log().debug(`change=${change}`)

	const pretx = await repeatAsync(API.createRawTransaction, 3)({
		ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
		outs: [{ [changeAddress]: +change }],
	});

	let rawtx;
	if (payload.length <= 76)
		rawtx = await repeatAsync(API.createRawTxOpReturn, 5)(pretx, payload);
	else {
		const newAddress = await
			repeatAsync(API.getNewAddress, 5)(ACCOUNT_LABEL, "legacy");
		rawtx = await repeatAsync(API.createRawTxMultisig, 5)(pretx, payload,
			inUTXO.address, newAddress);
	}

	return rawtx;
}

export async function createRawSend(consts: PlatformConstants, client: typeof Client,
	recipient: string, propid: number, amount: N, inUTXO: UTXO, fee: N) {
	const API = api(client);

	const payload = await repeatAsync(API.createPayloadSend, 5)
		(propid, amount).catch(_ => {
			throw new Error("Could not create simple send payload");
		});

	return await createRawTxPayload(consts, client, payload, inUTXO, fee, recipient);
}

export async function createRawAccept(consts: PlatformConstants,
	client: typeof Client, seller: string, propid: number, amount: N, inUTXO: UTXO,
	fee: N) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	const payload = await repeatAsync(API.createPayloadAccept, 5)
		(propid, amount).catch(_ => {
			throw new Error("Could not create dex accept payload");
		});

	const change = new N(inUTXO.amount).sub(MIN_CHANGE).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error("Could not create raw accept transaction, fee too high");

	const pretx = await repeatAsync(API.createRawTransaction, 3)
		({
			ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
			outs: [{ [inUTXO.address]: +change }, { [seller]: +MIN_CHANGE }],
		});

	return await repeatAsync(API.createRawTxOpReturn, 3)(pretx, payload);
}

export async function createRawPay(consts: PlatformConstants, client: typeof Client,
	orders: { address: string, amount: Decimal }[], inUTXO: UTXO, fee: N) {
	const API = api(client);
	const { MIN_CHANGE, EXODUS_ADDRESS } = consts;

	const total = dsum(orders.map(v => v.amount));
	const change =
		new N(inUTXO.amount).sub(MIN_CHANGE).sub(total).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error(`UTXO not large enough input=${inUTXO.amount},`
			+ ` total=${total}, fee=${fee.add(MIN_CHANGE).toDP(8)}`);

	let outs: RawTxBlueprint["outs"] =
		[{ [inUTXO.address]: +change }, { [EXODUS_ADDRESS]: +MIN_CHANGE }];
	outs.push(...orders.map(order => ({ [order.address]: +order.amount.toDP(8) })));

	return await repeatAsync(API.createRawTransaction, 3)({
		ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }], outs: outs
	});
}

export async function createRawOrder(consts: PlatformConstants,
	client: typeof Client, propid: number, action: OrderAction, inUTXO: UTXO,
	fee = new N(0), quantity = new N(0), price = new N(0)) {
	const API = api(client);

	log().debug(`propid=${propid}, action=${action}, fee=${fee},`
		+ ` quantity=${quantity}, price=${price}`);

	const payload = await repeatAsync(API.createPayloadOrder, 5)
		(...[propid, quantity, price, action,
			...(action === OrderAction.ORDER_CANCEL ? [0, 0] : [])]);

	return await createRawTxPayload(consts, client, payload, inUTXO, fee);
}

export async function createRawIssuer(consts: PlatformConstants,
	client: typeof Client, newIssuer: string, propid: number, inUTXO: UTXO, fee: N) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	log().debug(`newIssuer=${newIssuer}`)

	const payload = await API.createPayloadIssuer(propid);

	const change = new N(inUTXO.amount).sub(fee).toDP(8);

	if (change.lt(MIN_CHANGE))
		throw new Error("Could not create raw issuer transaction, fee too high");

	log().debug("inUTXO")
	log().debug(inUTXO)
	log().debug(`change=${change}`)

	const pretx = await repeatAsync(API.createRawTransaction, 3)({
		ins: [{ txid: inUTXO.txid, vout: inUTXO.vout }],
		outs: [{ [newIssuer]: MIN_CHANGE }],
	});

	return await repeatAsync(API.createRawTxOpReturn, 5)(pretx, payload);
}

export async function createRawCreate(consts: PlatformConstants,
	client: typeof Client, assetType: "managed" | "fixed" | "nft", ecosystem: number,
	type: number, previousid: number, name: string, category: string,
	subcategory: string, url: string, data: string, inUTXO: UTXO, fee: N,
	amount?: N) {
	const API = api(client);

	const pre = Math.max(previousid, 0);

	log().debug(`assetType=${assetType}, ecosystem=${ecosystem}, type=${type}`
		+ ` pre=${pre}, name=${name}, category=${category},`
		+ ` subcategory=${subcategory}, url=${url}, data=${data}`);

	// dummy payload
	const payload = assetType === "fixed" ? await API.createPayloadFixed(ecosystem,
		type, pre, category, subcategory, name, url, data, amount) : await
		API.createPayloadManaged(ecosystem, type, pre, category, subcategory,
			name, url, data);

	return await createRawTxPayload(consts, client, payload, inUTXO, fee);
}

export async function createRawSetNFT(consts: PlatformConstants,
	client: typeof Client, address: string, propid: number, tokenStart: number,
	tokenEnd: number, isIssuer: boolean, data: string, inUTXO: UTXO, fee: N) {
	const API = api(client);

	log().debug(`address=${address}, propid=${propid},`
		+ ` tokenRange=[${tokenStart}, ${tokenEnd}], isIssuer=${isIssuer},`
		+ ` data=${data}`);

	const payload = await
		API.createPayloadSetNFT(propid, tokenStart, tokenEnd, isIssuer, data);

	return await createRawTxPayload(consts, client, payload, inUTXO, fee, address);
}

export async function createRawGrant(consts: PlatformConstants,
	client: typeof Client, propid: number, amount: N, inUTXO: UTXO, fee: N,
	recipient = inUTXO.address, grantData?: string) {
	const API = api(client);

	log().debug(`propid=${propid}, amount=${amount},`
		+ ` grantData=${grantData ?? "(none)"}`);

	const payload = await API.createPayloadGrant(propid, amount, grantData);

	return await createRawTxPayload(consts, client, payload, inUTXO, fee, recipient);
}

export async function createRawRevoke(consts: PlatformConstants,
	client: typeof Client, propid: number, amount: N, inUTXO: UTXO, fee: N,
	memo?: string) {
	const API = api(client);

	log().debug(`propid=${propid}, amount=${amount}, memo=${memo ?? "(none)"}`);

	const payload = await API.createPayloadRevoke(propid, amount, memo);

	return await createRawTxPayload(consts, client, payload, inUTXO, fee);
}