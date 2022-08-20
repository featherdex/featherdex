import Client from 'bitcoin-core';
import Database from 'better-sqlite3';
import N from 'decimal.js';

import api from './api';

import {
	SATOSHI, API_RETRIES_LARGE, BATCH_SIZE, TYPE_SELL_OFFER, PROPID_COIN, API_RETRIES
} from './constants';
import { commandBatch, repeatAsync, notify, log } from './util';

type DBCol = { name: string, type: string };
type DBTrade = {
	txid: Buffer,
	unixtime: number,
	block: number,
	is_mine: number,
	id_buy: number,
	id_sell: number,
	quantity: number,
	amount: number,
	fee: number,
};

export default class TradesDB {
	bestBlock = -1;
	path = ":memory:";
	db: Database.Database = null;
	progressMsg: string = null;

	cols: DBCol[] =
		[{ name: "txid", type: "BLOB PRIMARY KEY" },
		{ name: "unixtime", type: "INTEGER" },
		{ name: "block", type: "INTEGER" },
		{ name: "is_mine", type: "INTEGER" },
		{ name: "id_buy", type: "INTEGER" },
		{ name: "id_sell", type: "INTEGER" },
		{ name: "quantity", type: "INTEGER" },
		{ name: "amount", type: "INTEGER" },
		{ name: "fee", type: "INTEGER" }];

	constructor(path: string) {
		this.path = path;
	}

	ready = () => this.db !== null && this.db !== undefined;

	init = (consts: PlatformConstants) => {
		this.db = new Database(this.path,
			{ verbose: log().getLevel() === "debug" ? log().debug : null });

		this.db.prepare("CREATE TABLE IF NOT EXISTS Variables"
			+ " (coin STRING PRIMARY_KEY, best_height INTEGER)").run();
		this.db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_name"
			+ " ON Variables (coin)").run();

		this.db.prepare(`CREATE TABLE IF NOT EXISTS ${consts.COIN_NAME}`
			+ `(${this.cols.map(col =>
				`${col.name} ${col.type}`).join(", ")})`).run();
		this.db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_txid"
			+ ` ON ${consts.COIN_NAME} (txid)`).run();
	}

	finish = () => { this.db.close(); }

	listAssetTrades = async (client: typeof Client, startblock: number,
		endblock: number): Promise<AssetTrade[]> => {
		log().debug(`listAssetTrades startblock=${startblock} endblock=${endblock}`);

		const allTXids: string[] = await
			client.command("omni_listblockstransactions", startblock, endblock);

		let allTXFees: { [k: string]: N } = {};
		{
			const iter = commandBatch(client, allTXids.map(txid =>
				({ method: "gettransaction", parameters: [txid] })), BATCH_SIZE);

			let value: Tx[], done = false, count = 0;
			while (({ value, done } = await iter.next()) && !done) {
				allTXFees = Object.assign(allTXFees, value.filter(tx =>
					!!tx).map(tx => ({ [tx.txid]: new N(tx.fee || 0) })));
				this.progressMsg = `Querying ${Math.min(count += BATCH_SIZE,
					allTXids.length)}/${allTXids.length} transaction fees`;
			}
		}

		let allOmniTXs: (OmniTx & BlockInfo)[] = [];
		{
			const iter = commandBatch(client, allTXids.map(hash =>
				({ method: "omni_gettransaction", parameters: [hash] })),
				BATCH_SIZE);

			let value: (OmniTx & BlockInfo)[], done = false, count = 0;
			while (({ value, done } = await iter.next()) && !done) {
				allOmniTXs.push(...value);
				this.progressMsg = `Querying ${Math.min(count += BATCH_SIZE,
					allTXids.length)}/${allTXids.length} transactions`;
			}
		}

		this.progressMsg = "Processing transactions";

		const buyTXs = allOmniTXs.filter(v =>
			v.type === "DEx Purchase") as (DexPurchase & BlockInfo)[];
		const sellTXs = allOmniTXs.filter(v =>
			v.type_int === TYPE_SELL_OFFER && v.valid) as (DexOrder & BlockInfo)[];

		const buys: AssetTrade[] = buyTXs.flatMap(v => v.purchases.filter(p =>
			p.valid).map(p => ({
				time: v.blocktime as UTCTimestamp,
				txid: v.txid,
				block: v.block,
				isMine: p.ismine,
				status: "CLOSED",
				idBuy: p.propertyid,
				idSell: PROPID_COIN, // currently only accept base coin
				quantity: new N(p.amountbought),
				remaining: new N(0),
				amount: new N(p.amountpaid),
				fee: allTXFees[v.txid]?.neg() ?? new N(0),
			})));

		const sells: AssetTrade[] = sellTXs.map(tx => ({
			address: tx.sendingaddress,
			time: tx.blocktime as UTCTimestamp,
			txid: tx.txid,
			block: tx.block,
			isMine: tx.ismine,
			status: tx.action === "cancel" ? "CANCELED" : "CLOSED",
			idBuy: PROPID_COIN,
			idSell: tx.propertyid,
			quantity: tx.action === "cancel" ? new N(0) : new N(tx.amount),
			remaining: new N(0),
			amount: tx.action === "cancel" ?
				new N(0) : new N(Object.entries(tx).filter(([k, _]) =>
					k.endsWith("desired"))[0][1] as string ?? 0),
			fee: allTXFees[tx.txid] ?? new N(0),
		}));

		return buys.concat(sells).sort((txa, txb) => txa.time - txb.time);
	};

	refresh = async (consts: PlatformConstants, client: typeof Client,
		startblock: number, endblock: number): Promise<AssetTrade[]> => {
		if (consts === null || client === null || !this.ready())
			throw new Error("Client not initialized");

		const { COIN_NAME, OMNI_START_HEIGHT } = consts;

		if (startblock > endblock) throw new Error("start > end");
		if (startblock < OMNI_START_HEIGHT) throw new Error("height out of range");

		let bestHeight: number =
			this.db.prepare("SELECT best_height FROM Variables WHERE coin = ?")
				.get(COIN_NAME)?.best_height;
		if (!bestHeight) bestHeight = OMNI_START_HEIGHT;
		const height = await repeatAsync(api(client).getBlockchainInfo, API_RETRIES)
			().then(v => v.blocks);

		const fromDBVal = (n: number) => new N(n).mul(SATOSHI).toDP(8);
		const toDBVal = (n: N) => n.toDP(8).divToInt(SATOSHI).toNumber();

		// a zero-value tx is a cancel order
		const fromDBCols = (dbTrade: DBTrade): AssetTrade => ({
			txid: (dbTrade.txid as Buffer).toString("hex"),
			time: dbTrade.unixtime as UTCTimestamp,
			block: dbTrade.block,
			isMine: dbTrade.is_mine === 1,
			idBuy: dbTrade.id_buy,
			idSell: dbTrade.id_sell,
			quantity: fromDBVal(dbTrade.quantity),
			amount: fromDBVal(dbTrade.amount),
			fee: fromDBVal(dbTrade.fee),
			status: dbTrade.quantity === 0 ? "CANCELED" : "CLOSED",
			remaining: new N(0),
		});
		const toDBCols = (trade: AssetTrade): DBTrade => ({
			txid: Buffer.from(trade.txid, "hex"),
			unixtime: trade.time as number,
			block: trade.block,
			is_mine: trade.isMine ? 1 : 0,
			id_buy: trade.idBuy,
			id_sell: trade.idSell,
			quantity: toDBVal(trade.quantity),
			amount: toDBVal(trade.amount),
			fee: toDBVal(trade.fee),
		});

		const notifier = setInterval(() => {
			if (this.progressMsg !== null)
				notify("info", "Updating Trades Database", this.progressMsg);
		}, 5000);

		const cachedTrades = this.db.prepare(`SELECT * FROM ${COIN_NAME}`
			+ ` WHERE block BETWEEN ${startblock} AND ${endblock}`
			+ " ORDER BY unixtime ASC").all().map(fromDBCols);
		const newTrades = await repeatAsync(this.listAssetTrades, API_RETRIES_LARGE)
			(client, bestHeight, height).then(trades =>
				trades.filter(trade => trade.block >= startblock
					&& trade.block <= endblock)).finally(() =>
						this.progressMsg = null);
		if (newTrades === null) return [];

		clearInterval(notifier);

		// Update the DB (note: replaces conflicts)
		this.db.transaction((trades: AssetTrade[]) => {
			trades.forEach(trade =>
				this.db.prepare(`INSERT OR REPLACE INTO ${COIN_NAME} VALUES (`
					+ Array(this.cols.length).fill("?").join(", ") + ")")
					.run(...Object.values(toDBCols(trade))));
			this.db.prepare("INSERT OR REPLACE INTO Variables VALUES (?, ?)")
				.run(COIN_NAME, endblock);
		})(newTrades);

		// Coalesce the cached trades and fresh trades
		const txidTradeEntry = (trade: AssetTrade): [string, AssetTrade] =>
			[trade.txid, trade];
		return [...new Map([...new Map(cachedTrades.map(txidTradeEntry)),
		...new Map(newTrades.map(txidTradeEntry))]).values()].sort((a, b) =>
			a.time - b.time);
	}
}