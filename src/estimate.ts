import N from 'decimal.js';
import Client from 'bitcoin-core';

import api from './api';

import {
	EMPTY_TX_VSIZE, IN_P2PKH_VSIZE, IN_P2WSH_VSIZE, OUT_P2PKH_VSIZE, OUT_P2WSH_VSIZE,
	OPRET_ACCEPT_VSIZE, OPRET_SEND_VSIZE, OPRET_ORDER_VSIZE, OPRET_EMPTY_VSIZE,
	OPRET_ISSUER_VSIZE, MULTISIG_ONE_VSIZE, MULTISIG_TWO_VSIZE, COIN_FEERATE
} from './constants';
import { repeatAsync, dsum, getAddressType, log } from './util';

function calcPayloadOuts(consts: PlatformConstants, payload: string) {
	const { MIN_CHANGE, MULTISIG_ONE_CHANGE, MULTISIG_TWO_CHANGE } = consts;

	// Pack into OP_RETURN
	if (payload.length <= 76 * 2)
		return { bytes: OPRET_EMPTY_VSIZE.add(payload.length), change: new N(0) };

	// 30 bytes max per omni packet
	const packets = new N(payload.length).div(2 * 30).ceil();

	// Can stick maximum two packets in one multisig txout
	const txout2 = packets.divToInt(2);
	const txout1 = packets.mod(2);

	// Add both multisig outs and exodus out
	return {
		bytes: MULTISIG_TWO_VSIZE.mul(txout2).add(MULTISIG_ONE_VSIZE.mul(txout1))
			.add(OUT_P2PKH_VSIZE),
		change: MULTISIG_TWO_CHANGE.mul(txout2).add(MULTISIG_ONE_CHANGE.mul(txout1))
			.add(MIN_CHANGE),
	};
}

export async function estimateTxFee(client: typeof Client, rawtx: string, size?: N,
	feerate?: N) {
	const API = api(client);
	const vsize = size ?? await
		repeatAsync(API.decodeTransaction, 3)(rawtx).then(v => {
			if (!v.vsize) throw new Error("Could not decode transaction");
			return new N(v.vsize);
		});

	const rate = feerate ?? await
		repeatAsync(API.estimateFee, 3)().catch(_ => COIN_FEERATE);

	return vsize.div(new N("1000")).mul(rate).toDP(8, N.ROUND_CEIL);
}

export async function estimateBuyFee(consts: PlatformConstants,
	client: typeof Client, orders: FillOrder[]) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	const feerate = await
		repeatAsync(API.estimateFee, 3)().then(r => new N(r), _ => COIN_FEERATE);

	// overhead + SW_in + SW_change_out + L_signal_out + OPRET_accept
	const legAcceptFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE
		.add(IN_P2WSH_VSIZE).add(OUT_P2WSH_VSIZE).add(OUT_P2PKH_VSIZE)
		.add(OPRET_ACCEPT_VSIZE), feerate);
	// overhead + SW_in + SW_change_out + SW_signal_out + OPRET_accept
	const segWAcceptFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE
		.add(IN_P2WSH_VSIZE).add(OUT_P2WSH_VSIZE.mul(2)).add(OPRET_ACCEPT_VSIZE),
		feerate);
	// overhead + SW_in + [SW_out | L_out : orders] + SW_change_out + L_exodus_out
	const payFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE.add(IN_P2WSH_VSIZE)
		.add(dsum(orders.map(o => getAddressType(consts, o.address) === "leg" ?
			OUT_P2PKH_VSIZE : OUT_P2WSH_VSIZE))).add(OUT_P2WSH_VSIZE), feerate);

	// max(L_accept | SW_accept, minfee) : orders
	let acceptFees = orders.reduce((map, o) =>
		map.set(o.address, N.max(getAddressType(consts, o.address) === "leg" ?
			legAcceptFee : segWAcceptFee, o.minFee)), new Map<string, Decimal>());

	log().debug("estimateBuyFee: acceptFees")
	log().debug(dsum([...acceptFees.values()]))

	log().debug("estimateBuyFee: payFee")
	log().debug(payFee)

	return {
		acceptFees, payFee,
		totalFee: dsum([...acceptFees.values()])
			.add(payFee).add(MIN_CHANGE.mul(2)).toDP(8),
	};
}

export async function estimateSellFee(consts: PlatformConstants,
	client: typeof Client, sends: FillSend[]) {
	const { MIN_CHANGE } = consts;

	const sendFee = await getSendFee(client);
	const postFee = await estimateTxFee(client, "", EMPTY_TX_VSIZE
		.add(IN_P2WSH_VSIZE).add(OUT_P2WSH_VSIZE).add(OPRET_ORDER_VSIZE));

	return {
		sendFee, postFee,
		totalFee: dsum(sends.map((send, i, arr) => {
			const fromType = getAddressType(consts, send.address);
			const toType = i === arr.length - 1 ?
				"sw" : getAddressType(consts, arr[i + 1].address);
			const fee = sendFee[`${fromType}_${toType}`];

			if (fee !== undefined) return fee;

			throw new Error("estimateSellFee: Logical error");
		})).add(postFee).add(MIN_CHANGE).toDP(8),
	};
}

async function getSendFee(client: typeof Client) {
	const API = api(client);
	const feerate = await
		repeatAsync(API.estimateFee, 3)().then(r => new N(r), _ => COIN_FEERATE);

	return {
		leg_leg: await estimateTxFee(client, "", EMPTY_TX_VSIZE.add(IN_P2PKH_VSIZE)
			.add(OUT_P2PKH_VSIZE).add(OPRET_SEND_VSIZE).sub(new N(0.5)), feerate),
		leg_sw: await estimateTxFee(client, "", EMPTY_TX_VSIZE.add(IN_P2PKH_VSIZE)
			.add(OUT_P2WSH_VSIZE).add(OPRET_SEND_VSIZE), feerate),
		sw_leg: await estimateTxFee(client, "", EMPTY_TX_VSIZE.add(IN_P2WSH_VSIZE)
			.add(OUT_P2PKH_VSIZE).add(OPRET_SEND_VSIZE), feerate),
		sw_sw: await estimateTxFee(client, "", EMPTY_TX_VSIZE.add(IN_P2WSH_VSIZE)
			.add(OUT_P2WSH_VSIZE).add(OPRET_SEND_VSIZE), feerate),
	};
}

export async function estimateSendFee(consts: PlatformConstants,
	client: typeof Client, sends: FillSend[], finalAddress: string) {
	const { MIN_CHANGE } = consts;

	let sendFee = await getSendFee(client);
	const finalType = getAddressType(consts, finalAddress);

	return {
		sendFee, totalFee: dsum(sends.map((send, i, arr) => {
			const fromType = getAddressType(consts, send.address);
			const toType = i === arr.length - 1 ?
				finalType : getAddressType(consts, arr[i + 1].address);
			const fee = sendFee[`${fromType}_${toType}`];

			if (fee !== undefined) return fee;

			throw new Error("estimateSendFee: Logical error");
		})).add(MIN_CHANGE).toDP(8),
	};
}

export async function estimateCreateFee(consts: PlatformConstants,
	client: typeof Client, assetType: "managed" | "fixed" | "nft", name: string,
	category: string, subcategory: string, url: string, data: string) {
	const API = api(client);
	const { MIN_CHANGE } = consts;

	// dummy payload
	const payload = assetType === "fixed" ? await API.createPayloadFixed(1, 2, 0,
		category, subcategory, name, url, data, new N(1)) : await
		API.createPayloadManaged(1, 2, 0, category, subcategory, name, url, data);

	let totalBytes = EMPTY_TX_VSIZE.add(IN_P2WSH_VSIZE).add(OUT_P2WSH_VSIZE);

	const outs = calcPayloadOuts(consts, payload);
	totalBytes = totalBytes.add(outs.bytes);
	const fee = outs.change.add(await estimateTxFee(client, "", totalBytes));

	// add reference change
	return { createFee: fee, totalFee: fee.add(MIN_CHANGE) };
}

export async function estimateIssuerFee(consts: PlatformConstants,
	client: typeof Client, issuer: string, newIssuer: string) {
	const { MIN_CHANGE } = consts;

	let totalBytes = EMPTY_TX_VSIZE.add(OPRET_ISSUER_VSIZE);
	totalBytes = totalBytes.add(getAddressType(consts, issuer) === "leg" ?
		IN_P2PKH_VSIZE : IN_P2WSH_VSIZE);
	totalBytes = totalBytes.add(getAddressType(consts, newIssuer) === "leg" ?
		OUT_P2PKH_VSIZE : OUT_P2WSH_VSIZE);

	const fee = await estimateTxFee(client, "", totalBytes);

	return { issuerFee: fee, totalFee: fee.add(MIN_CHANGE) };
}

export async function estimateNFTFee(consts: PlatformConstants,
	client: typeof Client, data: string, sender: string, reference = sender) {
	const { MIN_CHANGE } = consts;
	const API = api(client);

	// dummy payload
	const payload = await API.createPayloadSetNFT(255, 1, 1, true, data);

	let totalBytes = EMPTY_TX_VSIZE.add(getAddressType(consts, sender) === "leg" ?
		IN_P2PKH_VSIZE : IN_P2WSH_VSIZE);
	totalBytes = totalBytes.add(getAddressType(consts, reference) === "leg" ?
		OUT_P2PKH_VSIZE : OUT_P2WSH_VSIZE);

	const outs = calcPayloadOuts(consts, payload);
	totalBytes = totalBytes.add(outs.bytes);
	const fee = outs.change.add(await estimateTxFee(client, "", totalBytes));

	// add reference change
	return { nftFee: fee, totalFee: fee.add(MIN_CHANGE) };
}

export async function estimateGrantFee(consts: PlatformConstants,
	client: typeof Client, issuer: string, recipient = issuer, grantData?: string) {
	const { MIN_CHANGE } = consts;
	const API = api(client);

	// dummy payload
	const payload = await API.createPayloadGrant(255, new N(1), grantData);

	let totalBytes = EMPTY_TX_VSIZE.add(getAddressType(consts, issuer) === "leg" ?
		IN_P2PKH_VSIZE : IN_P2WSH_VSIZE);
	totalBytes = totalBytes.add(getAddressType(consts, recipient) === "leg" ?
		OUT_P2PKH_VSIZE : OUT_P2WSH_VSIZE);

	const outs = calcPayloadOuts(consts, payload);
	totalBytes = totalBytes.add(outs.bytes);
	const fee = outs.change.add(await estimateTxFee(client, "", totalBytes));

	// add reference change
	return { grantFee: fee, totalFee: fee.add(MIN_CHANGE) };
}

export async function estimateRevokeFee(consts: PlatformConstants,
	client: typeof Client, issuer: string, memo?: string) {
	const { MIN_CHANGE } = consts;
	const API = api(client);

	// dummy payload
	const payload = await API.createPayloadRevoke(255, new N(1), memo);

	let totalBytes = EMPTY_TX_VSIZE;
	totalBytes = totalBytes.add(getAddressType(consts, issuer) === "leg" ?
		IN_P2PKH_VSIZE.add(OUT_P2PKH_VSIZE) : IN_P2WSH_VSIZE.add(OUT_P2WSH_VSIZE));

	const outs = calcPayloadOuts(consts, payload);
	totalBytes = totalBytes.add(outs.bytes);
	const fee = outs.change.add(await estimateTxFee(client, "", totalBytes));

	// add reference change
	return { revokeFee: fee, totalFee: fee.add(MIN_CHANGE) };
}