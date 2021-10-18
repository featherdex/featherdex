import React from 'react';
import Client from 'bitcoin-core';

import { DateTime } from 'luxon';
import { UTCTimestamp } from 'lightweight-charts';

import api from './api';

import { Data } from './Orders';
import { sendTx, waitForTx } from './util';

export default class Order implements Cancellable {
	client: typeof Client = null;
	status = "PENDING";
	isCancel = false;
	isDone = false;
	buysell: string = null;
	orderType: string = null;
	id = 0;
	quantity = 0;
	remaining = 0;
	price = 0;
	fee = 0;
	address: string = null;
	paynohighfees = true;
	waitTXs = [] as string[];
	time = 0 as UTCTimestamp;
	finaltx: string = null;
	finalizing = false;

	constructor(client: typeof Client, buysell: "buy" | "sell",
		orderType: "market" | "limit", id: number, quantity: number,
		price: number, fee: number, address: string, paynohighfees: boolean,
		waitTXs = [] as string[], finaltx: string) {
		this.client = client;
		this.buysell = buysell;
		this.orderType = orderType;
		this.id = id;
		this.quantity = quantity;
		this.remaining = quantity;
		this.price = price;
		this.fee = fee;
		this.address = address;
		this.paynohighfees = paynohighfees;
		this.waitTXs = [...waitTXs];
		this.finaltx = finaltx;
		this.time = Math.floor(DateTime.now().toSeconds()) as UTCTimestamp;
	}

	cancel = () => {
		this.isCancel = true;
		this.status = "CANCELLING";
	};

	finish = (clean: boolean) => {
		this.isDone = true;
		return clean;
	};

	pollTx = async (tx: string) => {
		// Poll until the transaction confirms
		const txWait = await waitForTx(this.client, tx, this).catch(_ => null);
		if (txWait === null) return false; // cancelled

		return true; // passed
	};

	run = async (): Promise<boolean> => {
		if (this.isCancel) return this.finish(false); // cancel guard //

		// Wait for all pending transactions first
		// If the order has been cancelled, the promise rejects
		if (!await Promise.all(this.waitTXs.map(this.pollTx)).catch(_ => false))
			return this.finish(true);

		if (this.isCancel) return this.finish(false); // cancel guard //

		this.status = "CONFIRMING";

		const sendtx = await sendTx(this.client, this.finaltx, "Could not send final"
			+ ` ${this.buysell} transaction`);
		if (sendtx === null) return this.finish(false);
		
		this.finalizing = true;

		// If the order has been cancelled, poll returns false
		if (!await this.pollTx(sendtx)) return this.finish(true);

		return this.finish(true);
	}

	data = (): Data => {
		return {
			cancel: <a href="#" onClick={this.cancel}>Cancel</a>,
			time: this.time,
			status: this.status,
			idBuy: this.buysell === "buy" ? this.id : 1,
			idSell: this.buysell === "sell" ? this.id : 1,
			quantity: this.quantity,
			remaining: this.remaining,
			price: this.price,
			fee: this.fee,
			total: this.quantity * this.price + this.fee,
		};
	}
};