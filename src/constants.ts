"use strict";

import N from 'decimal.js';

export const APP_NAME = "FeatherDeX Trader";
export const LAYOUT_NAME = "layout.json";
export const CONF_NAME = "config.json";
export const FCONF_NAME = "feathercoin.conf";

export const US_NUMF = "en-US";
export const EU_NUMF = "de-DE";
export const IN_NUMF = "en-IN";
export const FR_NUMF = "fr-FR";

export const OMNI_VERSION = 1;
export const VERSION_STRING = "v0.7.0b";
export const ACCOUNT_LABEL = "featherdex";

export const TYPE_SIMPLE_SEND = 0;
export const TYPE_UNIQUE_SEND = 5;
export const TYPE_SELL_OFFER = 20;
export const TYPE_ACCEPT_OFFER = 22;
export const TYPE_CREATE_PROPERTY_FIXED = 50;
export const TYPE_CREATE_PROPERTY_MANUAL = 54;
export const TYPE_GRANT_PROPERTY = 55;
export const TYPE_PURCHASE = 255;

export const BITTREX_API_ENDPOINT = "https://api.bittrex.com/v3";
export const COINBASE_API_ENDPOINT = "https://api.coinbase.com/v2";

export const SYMBOL_BITCOIN = "\u20bf";
export const SYMBOL_EURO = "\u20ac";
export const SYMBOL_X = "\u2715";
export const SYMBOL_UP = "\u25b2";
export const SYMBOL_DOWN = "\u25bc";
export const SYMBOL_CHECK_BUTTON = "\u2705";
export const SYMBOL_CROSS_MARK = "\u274c";
export const SYMBOL_WARNING = "\u26a0";
export const SYMBOL_REFRESH = "\u1f5d8";

export const PROPID_BITCOIN = 0;
export const PROPID_COIN = 1;

export const SATOSHI = new N("0.00000001");
export const BLOCK_TIME = 60;

export const EMPTY_TX_VSIZE = new N("10.5");
export const IN_P2PKH_VSIZE = new N(148);
export const IN_P2WSH_VSIZE = new N(91);
export const OUT_P2PKH_VSIZE = new N(34);
export const OUT_P2WSH_VSIZE = new N(32);
export const OPRET_EMPTY_VSIZE = new N(15);
export const OPRET_ISSUER_VSIZE = new N(23);
export const OPRET_ACCEPT_VSIZE = new N(31);
export const OPRET_SEND_VSIZE = new N(31);
export const OPRET_ORDER_VSIZE = new N(49);
export const OPRET_CREATE_VSIZE = new N(74);
export const MULTISIG_ONE_VSIZE = new N(81);
export const MULTISIG_TWO_VSIZE = new N(115);

export const API_RETRIES = 5;
export const API_RETRIES_LARGE = 3;

export const BATCH_SIZE = 1000;

export const CHART_MINUTE_DAYS = 10;
export const CHART_HOUR_MONTHS = 6;
export const CHART_DAY_YEARS = 8;

export enum OrderAction {
	ORDER_NEW = 1,
	ORDER_UPDATE,
	ORDER_CANCEL,
};

export const BITTREX_TRADE_FEERATE = new N("0.003");
export const MIN_ACCEPT_FEE = new N("0.0001");
export const MAX_ACCEPT_FEE = new N("0.1");
export const COIN_FEERATE = new N("0.02");
export const MIN_TRADE_FEE = new N("0.008");
export const TRADE_FEERATE = new N("0.001");
export const BLOCK_WAIT = 3;
export const PAY_BLOCK_LIMIT = 50;

export const ECOSYSTEM_MAIN = 1;
export const ECOSYSTEM_TEST = 2;

export const TYPE_INDIVISIBLE = 1;
export const TYPE_DIVISIBLE = 2;
export const TYPE_NFT = 5;