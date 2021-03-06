import N from 'decimal.js';

const Platforms: Record<string, PlatformConstants> = {
	FEATHERCOIN: {
		COIN_NAME: "Feathercoin",
		COIN_TICKER: "FTC",
		COIN_BASE_TICKER: "BTC",
		COIN_BASE_TICKER_ALT: "USD",
		COIN_BASE_TICKER_ALT2: "EUR",
		COIN_OMNI_NAME: "Omnifeather",
		COIN_LOGO_PATH: "../img/logo-ftc-256px.png",
		COIN_URL: "https://feathercoin.com/",
		COIN_SUPPLY: 336000000,
		COIN_FOLDER: "Feathercoin",
		COIN_FOLDER_LINUX: ".feathercoin",
		COIN_MARKET: `FTC-BTC`,
		COIN_MARKET_ALT: `FTC-USD`,
		COIN_MARKET_ALT2: `FTC-EUR`,
		COIN_EXPLORER_ENDPOINT: "https://explorer.feathercoin.com",
		MIN_FEE: new N("0.50000000"),
		FEE_ADDRESS: "34sGcLqfNK83RHdNPiVjkbxRHgNPSD7kzT",
		EXODUS_ADDRESS: "6eXoDUSUV7yrAxKVNPEeKAHMY8San5Z37V",
		GENESIS_TIME: 1366147060,
		OMNI_START_HEIGHT: 3454000,
		OMNI_START_TIME: 1607663639,
		OMNI_EXPLORER_ENDPOINT: "https://dt45325.omniexplorer.info/ftc",
		MIN_CHANGE: new N("0.00000546"),
		MULTISIG_ONE_CHANGE: new N("0.00000684"),
		MULTISIG_TWO_CHANGE: new N("0.00000786"),
		ADDR_LEGACY_PREFIXES: /^(6|7).*/,
		ADDR_SEGWIT_PREFIXES: /^(3|fc1).*/,
	},
	LITECOIN: {
		COIN_NAME: "Litecoin",
		COIN_TICKER: "LTC",
		COIN_BASE_TICKER: "BTC",
		COIN_BASE_TICKER_ALT: "USD",
		COIN_BASE_TICKER_ALT2: "EUR",
		COIN_OMNI_NAME: "OmniLite",
		COIN_LOGO_PATH: "../img/logo-ltc-256px.png",
		COIN_URL: "https://litecoin.com/",
		COIN_SUPPLY: 84000000,
		COIN_FOLDER: "Litecoin",
		COIN_FOLDER_LINUX: ".litecoin",
		COIN_MARKET: `LTC-BTC`,
		COIN_MARKET_ALT: `LTC-USD`,
		COIN_MARKET_ALT2: `LTC-EUR`,
		COIN_EXPLORER_ENDPOINT: "https://insight.litecore.io",
		MIN_FEE: new N("0.00500000"),
		FEE_ADDRESS: "MWTwSHMmif2qckh7pQjcp6DrH4AUgFtoiv",
		EXODUS_ADDRESS: "LTceXoduS2cetpWJSe47M25i5oKjEccN1h",
		GENESIS_TIME: 1317972660,
		OMNI_START_HEIGHT: 2093636,
		OMNI_START_TIME: 1627314304,
		OMNI_EXPLORER_ENDPOINT: "https://dt45325.omniexplorer.info/ltc",
		MIN_CHANGE: new N("0.00005460"),
		MULTISIG_ONE_CHANGE: new N("0.00006840"),
		MULTISIG_TWO_CHANGE: new N("0.00007860"),
		ADDR_LEGACY_PREFIXES: /^L.*/,
		ADDR_SEGWIT_PREFIXES: /^(3|M).*/,
	},
	BITCOIN: {
		COIN_NAME: "Bitcoin",
		COIN_TICKER: "BTC",
		COIN_BASE_TICKER: "USD",
		COIN_BASE_TICKER_ALT: "USDT",
		COIN_BASE_TICKER_ALT2: "EUR",
		COIN_OMNI_NAME: "Omni",
		COIN_LOGO_PATH: "../img/logo-btc-256px.png",
		COIN_URL: "https://bitcoin.org/",
		COIN_SUPPLY: 21000000,
		COIN_FOLDER: "Bitcoin",
		COIN_FOLDER_LINUX: ".bitcoin",
		COIN_MARKET: `BTC-USD`,
		COIN_MARKET_ALT: `BTC-USDT`,
		COIN_MARKET_ALT2: `BTC-EUR`,
		COIN_EXPLORER_ENDPOINT: "https://bitpay.com/insight/#/BTC/mainnet",
		MIN_FEE: new N("0.00001960"),
		FEE_ADDRESS: "3AvttmdH8zrNb7TavwRomkbXJ4SqseJxa8",
		EXODUS_ADDRESS: "1EXoDusjGwvnjZUyKkxZ4UHEf77z6A5S4P",
		GENESIS_TIME: 1317972660,
		OMNI_START_HEIGHT: 2093636,
		OMNI_START_TIME: 1627314304,
		OMNI_EXPLORER_ENDPOINT: "https://dt45325.omniexplorer.info",
		MIN_CHANGE: new N("0.00000546"),
		MULTISIG_ONE_CHANGE: new N("0.00000684"),
		MULTISIG_TWO_CHANGE: new N("0.00000786"),
		ADDR_LEGACY_PREFIXES: /^1.*/,
		ADDR_SEGWIT_PREFIXES: /^(3|bc1).*/,
	},
}

export default Platforms;