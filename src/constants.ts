"use strict";

export const APP_NAME = "FeatherDeX Trader";
export const LAYOUT_NAME = "layout.json";
export const CONF_NAME = "config.json";
export const FCONF_NAME = "feathercoin.conf";

export const US_NUMF = "en-US";
export const EU_NUMF = "de-DE";
export const IN_NUMF = "en-IN";
export const FR_NUMF = "fr-FR";

export const OMNI_VERSION = 1;
export const VERSION_STRING = "v0.0.5a";
export const ACCOUNT_LABEL = "featherdex";

export const TYPE_SIMPLE_SEND = 0;
export const TYPE_UNIQUE_SEND = 5;
export const TYPE_SELL_OFFER = 20;
export const TYPE_ACCEPT_OFFER = 22;
export const TYPE_CREATE_PROPERTY_FIXED = 50;
export const TYPE_CREATE_PROPERTY_MANUAL = 54;
export const TYPE_GRANT_PROPERTY = 55;

export const BITTREX_API_ENDPOINT = "https://api.bittrex.com/v3";
export const COINBASE_API_ENDPOINT = "https://api.coinbase.com/v2";
export const OMNI_EXPLORER_ENDPOINT = "https://dt45325.omniexplorer.info/ftc";
export const COIN_EXPLORER_ENDPOINT = "https://explorer.feathercoin.com";
export const COIN_MARKET = "FTC-BTC";

export const BITCOIN_SYMBOL = "\u20bf";
export const EURO_SYMBOL = "\u20ac";
export const X_SYMBOL = "\u2715";
export const UP_SYMBOL = "\u25b2";
export const DOWN_SYMBOL = "\u25bc";

export const PROPID_BITCOIN = 0;
export const PROPID_FEATHERCOIN = 1;

export const GENESIS_TIME = 1366147060;
export const OMNI_START_HEIGHT = 3454000;
export const OMNI_START_TIME = 1607663639;
export const SATOSHI = 0.00000001;
export const BLOCK_TIME = 60;

export const EMPTY_TX_VSIZE = 12;
export const TX_I_VSIZE = 90;
export const TX_O_VSIZE = 32;
export const OPRETURN_ACCEPT_VSIZE = 31;
export const OPRETURN_SEND_VSIZE = 31;
export const OPRETURN_ORDER_VSIZE = 49;

export const API_RETRIES = 5;

export const CHART_MINUTE_DAYS = 10;
export const CHART_HOUR_MONTHS = 6;
export const CHART_DAY_YEARS = 8;

export enum OrderAction {
	ORDER_NEW = 1,
	ORDER_UPDATE,
	ORDER_CANCEL,
};

export const MIN_ACCEPT_FEE = 0.0001;
export const MAX_ACCEPT_FEE = 0.1;
export const COIN_FEERATE = 0.02;
export const MIN_TRADE_FEE = 0.008;
export const TRADE_FEERATE = 0.001;
export const BLOCK_WAIT = 3;
export const PAY_BLOCK_LIMIT = 50;
export const FEE_ADDRESS = "34sGcLqfNK83RHdNPiVjkbxRHgNPSD7kzT";
export const EXODUS_ADDRESS = "6eXoDUSUV7yrAxKVNPEeKAHMY8San5Z37V";
export const EXODUS_CHANGE = 0.00000546;
export const MIN_CHANGE = 0.00000546;