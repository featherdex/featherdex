"use strict";

import getAppDataPath from 'appdata-path';
import process from 'process';
import os from 'os';
import path from 'path';

import Platforms from './platforms';

import { US_NUMF, FCONF_NAME } from './constants';

export const defaultLayout = {
	global: {},
	layout: {
		"type": "row",
		"id": "parent",
		"children": [
			{
				"type": "row",
				"id": "body",
				"children": [
					{
						"type": "row",
						"id": "#1",
						"weight": 61.5,
						"children": [
							{
								"type": "row",
								"id": "#10",
								"weight": 50,
								"children": [
									{
										"type": "tabset",
										"id": "#100",
										"weight": 35,
										"children": [
											{
												"type": "tab",
												"id": "#1000",
												"name": "Assets",
												"component": "assets"
											}
										]
									},
									{
										"type": "tabset",
										"id": "#101",
										"weight": 65,
										"children": [
											{
												"type": "tab",
												"id": "#1010",
												"name": "Top Markets",
												"component": "markets"
											},
											{
												"type": "tab",
												"id": "#1011",
												"name": "Time & Sales",
												"component": "sales"
											},
											{
												"type": "tab",
												"id": "#1012",
												"name": "Info",
												"component": "info"
											},
											{
												"type": "tab",
												"id": "#1013",
												"name": "Terminal",
												"component": "terminal"
											}
										]
									}
								]
							},
							{
								"type": "row",
								"id": "#11",
								"weight": 50,
								"children": [
									{
										"type": "tabset",
										"id": "#110",
										"weight": 70,
										"children": [
											{
												"type": "tab",
												"id": "#9",
												"name": "Chart",
												"component": "chart"
											}
										],
										"active": true,
									},
									{
										"type": "tabset",
										"id": "#111",
										"weight": 30,
										"children": [
											{
												"type": "tab",
												"id": "#1110",
												"name": "Orders",
												"component": "orders"
											},
											{
												"type": "tab",
												"id": "#1111",
												"name": "History",
												"component": "history"
											},
										]
									}
								]
							}
						]
					},
					{
						"type": "tabset",
						"id": "#2",
						"weight": 31,
						"children": [
							{
								"type": "tab",
								"id": "#20",
								"name": "Trade",
								"component": "trade"
							},
							{
								"type": "tab",
								"id": "#21",
								"name": "Transfer Assets",
								"component": "transfer"
							},
						]
					},
					{
						"type": "tabset",
						"id": "#3",
						"weight": 7.5,
						"children": [
							{
								"type": "tab",
								"id": "#30",
								"name": "Ticker",
								"component": "ticker"
							}
						]
					}
				]
			}
		]
	},
	borders: [] as any[]
};

export const defaultRPCSettings: RPCSettings = {
	rpchost: "localhost",
	rpcport: 8332,
	rpcuser: "",
	rpcpassword: "",
}

export const defaultSettings: Settings = {
	dconfpath: process.platform === "linux" ?
		path.resolve(os.homedir(), Platforms.FEATHERCOIN.COIN_FOLDER_LINUX,
			FCONF_NAME) :
		path.resolve(getAppDataPath(Platforms.FEATHERCOIN.COIN_FOLDER), FCONF_NAME),
	numformat: US_NUMF,
	apikey: "",
	apisecret: "",
	receiveAddress: null,
};