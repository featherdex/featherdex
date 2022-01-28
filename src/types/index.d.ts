type DateTime = import('luxon').DateTime;
type BlockTree = import('functional-red-black-tree').Tree<number, number>;
type UTCTimestamp = import('lightweight-charts').UTCTimestamp;
type Decimal = import('decimal.js').Decimal;

/**
 * From https://github.com/microsoft/TypeScript/blob/feac9eb126e56837d16acb61cd019ce8520db76c/src/lib/es5.d.ts#L1492-L1501
 * TODO Remove when TypeScript 4.5 is stable!
 * Recursively unwraps the "awaited type" of a type. Non-promise "thenables" should resolve to `never`. This emulates the behavior of `await`.
 */
declare type Awaited<T> =
	T extends null | undefined ? T : // special case for `null | undefined` when not in `--strictNullChecks` mode
	T extends object & { then(onfulfilled: infer F): any } ? // `await` only unwraps object types with a callable `then`. Non-object types are not unwrapped
	F extends ((value: infer V) => any) ? // if the argument to `then` is callable, extracts the argument
	Awaited<V> : // recursively unwrap the value
	never : // the argument to `then` was not callable
	T; // non-object or non-thenable

declare type Undefined<N, T, V> = N extends undefined ? T : V;

declare interface Window {
	api: {
		quit: () => void,
	}
}

declare interface Cancellable {
	isCancel: boolean,
}

declare interface Stringable {
	toString: () => string,
}

declare type DownloadOpts = {
	url: string,
	path: string,
};

declare type DownloadProgress = {
	downBytes: number,
	totalBytes: number,
};

declare type BlockTimeStruct = {
	cache: BlockTree,
	push: (time: number, height: number) => void,
}

declare type Settings = Record<string, any>;
declare type RPCSettings = Record<string, any>;

declare type PlatformConstants = {
	COIN_NAME: string,
	COIN_TICKER: string,
	COIN_BASE_TICKER: string,
	COIN_BASE_TICKER_ALT: string,
	COIN_BASE_TICKER_ALT2: string,
	COIN_OMNI_NAME: string,
	COIN_LOGO_PATH: string,
	COIN_URL: string,
	COIN_SUPPLY: number,
	COIN_FOLDER: string,
	COIN_FOLDER_LINUX: string,
	COIN_MARKET: string,
	COIN_MARKET_ALT: string,
	COIN_MARKET_ALT2: string,
	FEE_ADDRESS: string,
	EXODUS_ADDRESS: string,
	GENESIS_TIME: number,
	OMNI_START_HEIGHT: number,
	OMNI_START_TIME: number,
	MIN_CHANGE: Decimal,
};

declare type Property = {
	id: number,
	name: string,
};

declare type PropertyList = Property[];

declare type BittrexBookEntry = {
	quantity: string,
	rate: string,
	orders?: number,
};

declare type BittrexBook = {
	bid: BittrexBookEntry[],
	ask: BittrexBookEntry[],
};

declare type AssetBalance = {
	propertyid: number,
	name: string,
	balance: string,
	reserved: string,
	frozen: string,
};

declare type AssetTrade = {
	time: UTCTimestamp,
	txid: string,
	block: number,
	status: string,
	idBuy: number,
	idSell: number,
	quantity: Decimal,
	remaining: Decimal,
	amount: Decimal,
	fee: Decimal,
	address?: string,
};

declare type DexSell = {
	txid: string,
	propertyid: string,
	seller: string,
	amountavailable: string,
	unitprice: string,
	timelimit: number,
	minimumfee: string,
	amountaccepted: string,
	accepts: any[],
} & { [desired: string]: string };

declare type DexAccept = OmniTx & {
	referenceaddress: string,
	propertyid: number,
	divisible: boolean,
	amount: string,
};

declare type DexOrder = OmniTx & {
	propertyid: number,
	divisible: boolean,
	amount: string,
	timelimit: number,
	feerequired: string,
	action: "new" | "update" | "cancel",
} & { [desired: string]: string };

declare type DexPurchase = OmniTx & {
	purchases: Purchase[],
};

declare type Purchase = {
	vout: number,
	amountpaid: string,
	ismine: boolean,
	referenceaddress: string,
	propertyid: number,
	amountbought: string,
	valid: boolean,
}

declare type FillOrder = {
	address: string,
	quantity: Decimal,
	payAmount: Decimal,
	minFee: Decimal,
}

declare type RawTxBlueprint = {
	ins: { txid: string, vout: number, sequence?: number }[],
	outs: ({ [address: string]: number } | { data: string })[],
};

declare type RawTx = {
	in_active_chain?: boolean,
	hex?: string,
	txid: string,
	hash: string,
	size: number,
	vsize: number,
	weight: number,
	version: number,
	locktime: number,
	vin: {
		txid: string,
		vout: number,
		scriptSig: {
			asm: string,
			hex: string,
		},
		sequence: number,
		txinwitness: string[],
	}[],
	vout: {
		value: number,
		n: number,
		scriptPubKey: {
			asm: string,
			hex: string,
			reqSigs: number,
			type: string,
			addresses: string[],
		},
	}[],
	blockhash?: string,
	confirmations?: number,
	blocktime?: number,
	time?: number,
};

declare type OmniTx = {
	txid: string,
	sendingaddress: string,
	referenceaddress?: string,
	ismine: boolean,
	fee: string,
	version: number,
	type_int: number,
	type: string,
	valid: boolean,
	confirmations: number,
};

declare type BlockInfo = {
	blockhash: string,
	blocktime: number,
	positioninblock: number,
	block: number,
}

declare type Tx = {
	amount: number,
	fee: number,
	confirmations: number,
	blockhash: string,
	blockindex: number,
	blocktime: number,
	txid: string,
	time: number,
	timereceived: number,
	"bip125-replaceable": string,
	details: {
		address?: string,
		category: "send" | "receive" | "generate" | "immature" | "orphan",
		amount: number,
		label?: string,
		vout: number,
		fee: number,
		abandoned?: boolean,
	}[],
	hex: string,
};

declare type Block = {
	hash: string,
	confirmations: number,
	strippedsize: number,
	size: number,
	weight: number,
	height: number,
	version: number,
	versionHex: string,
	merkleroot: string,
	tx: string[],
	time: number,
	mediantime: number,
	nonce: number,
	bits: string,
	difficulty: number,
	nTx: number,
	previousblockhash: string,
};

declare type BookData = {
	price: Decimal,
	quantity: Decimal,
	value: Decimal,
	total: Decimal,
};

declare type FundRawOptions = {
	changeAddress?: string,
	changePosition?: number,
	change_type?: string,
	includeWatching?: boolean,
	lockUnspents?: boolean,
	feeRate?: number | string,
	subtractFeeFromOutputs?: number[],
	replaceable?: boolean,
	conf_target?: number,
	estimate_mode?: "UNSET" | "ECONOMICAL" | "CONSERVATIVE",
};

declare type RequestOptions = {
	method: "GET" | "POST" | "DELETE",
	headers: Record<string, any>,
	body?: string,
};

declare type Ticker = {
	market: string,
	last: { time: DateTime, price: number },
	chg: number,
	chgp: number,
	bid: number,
	ask: number,
	vol: number,
};

declare type BittrexErrorType = {
	code: string,
	detail: string,
	data: object,
};

declare type BittrexBalance = {
	currencySymbol: string,
	total: string,
	available: string,
	updatedAt: string,
};

declare type BittrexTicker = {
	symbol: string,
	lastTradeRate: string,
	bidRate: string,
	askRate: string,
};

declare type BittrexSummary = {
	symbol: string,
	high: string,
	low: string,
	volume: string,
	quoteVolume: string,
	percentChange: string,
	updatedAt: string,
}

declare type BittrexTrade = {
	id: string,
	executedAt: string,
	quantity: string,
	rate: string,
	takerSide: string,
};

declare type BittrexNewOrder = {
	marketSymbol: string,
	direction: "BUY" | "SELL",
	type: "LIMIT" | "MARKET" | "CEILING_LIMIT" | "CEILING_MARKET",
	timeInForce: "GOOD_TIL_CANCELLED" | "IMMEDIATE_OR_CANCEL" | "FILL_OR_KILL"
	| "POST_ONLY_GOOD_TIL_CANCELLED" | "BUY_NOW" | "INSTANT",
	quantity?: string,
	ceiling?: string,
	limit?: string,
	clientOrderId?: string,
	useAwards?: boolean,
};

declare type BittrexOrder = {
	id: string,
	marketSymbol: string,
	direction: "BUY" | "SELL",
	type: "LIMIT" | "MARKET" | "CEILING_LIMIT" | "CEILING_MARKET",
	timeInForce: "GOOD_TIL_CANCELLED" | "IMMEDIATE_OR_CANCEL" | "FILL_OR_KILL"
	| "POST_ONLY_GOOD_TIL_CANCELLED" | "BUY_NOW" | "INSTANT",
	fillQuantity: string,
	commission: string,
	proceeds: string,
	status: "OPEN" | "CLOSED",
	createdAt: string,
	quantity?: string,
	limit?: string,
	ceiling?: string,
	clientOrderId?: string,
	updatedAt?: string,
	closedAt?: string,
	orderToCancel?: {
		type: string,
		id: string
	}
};

declare type BittrexCandle = {
	startsAt: string,
	open: string,
	high: string,
	low: string,
	close: string,
	volume: string,
	quoteVolume: string,
};

declare type CoinbaseRate = {
	data: {
		currency: string,
		rates: Record<string, string>,
	}
};

declare type UTXO = {
	txid: string,
	vout: number,
	address: string,
	label: string,
	redeemScript: string,
	scriptPubKey: string,
	amount: number,
	confirmations: number,
	spendable: boolean,
	solvable: boolean,
	desc: string,
	safe: boolean,
};

declare type AddressBalance = {
	address: string,
	balances: {
		propertyid: number,
		name: string,
		balance: string,
		reserved: string,
		frozen: string,
	}[],
};

declare type AssetInfo = {
	propertyid: number,
	name: string,
	category: string,
	subcategory: string,
	data: string,
	url: string,
	divisible: boolean,
	issuer: string,
	creationtxid: string,
	fixedissuance: boolean,
	managedissuance: boolean,
	"non-fungibletoken": boolean,
	freezingenabled?: boolean,
	totaltokens?: string
};

declare type NFTInfo = {
	index: number,
	owner: string,
	grantdata: string,
	issuerdata: string,
	holderdata: string,
};

declare type BlockchainInfo = {
	chain: string,
	blocks: number,
	headers: number,
	bestblockhash: string,
	difficulty: number,
	mediantime: number,
	verificationprogress: number,
	initialblockdownload?: boolean,
	chainwork: string,
	size_on_disk: number,
	pruned: boolean,
	pruneheight: number,
	automatic_pruning: boolean,
	prune_target_size: number,
	softforks: {
		id: string,
		version: number,
		reject: { status: boolean },
	}[],
	bip9_softforks: {
		[name: string]: {
			status: string,
			bit: number,
			startTime: number,
			timeout: number,
			since: number,
			statistics: {
				period: number,
				threshold: number,
				elapsed: number,
				count: number,
				possible: boolean,
			}
		}
	}
};

declare type NetworkInfo = {
	version: number,
	subversion: string,
	protocolversion: number,
	localservices: string,
	localrelay: boolean,
	timeoffset: number,
	connections: number,
	networkactive: boolean,
	networks: {
		name: string,
		limited: boolean,
		reachable: boolean,
		proxy: string
		proxy_randomize_credentials: boolean,
	}[],
	relayfee: number,
	incrementalfee: number,
	localaddresses: {
		address: string,
		port: number,
		score: number,
	}[],
	warnings: string,
};

declare type FeeEstimate = {
	feerate?: number,
	errors?: string[],
	blocks: number,
};