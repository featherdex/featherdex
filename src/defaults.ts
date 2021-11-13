"use strict";

import getAppDataPath from 'appdata-path';
import process from 'process';
import os from 'os';
import path from 'path';

import { US_NUMF, FCONF_NAME } from './constants';

export const defaultLayout = {
	global: {},
	layout: {
		"type": "row",
		"id": "#1",
		"children": [
			{
				"type": "row",
				"id": "#2",
				"children": [
					{
						"type": "row",
						"id": "#3",
						"weight": 62.5,
						"children": [
							{
								"type": "row",
								"id": "#19",
								"weight": 50,
								"children": [
									{
										"type": "tabset",
										"id": "#4",
										"weight": 35,
										"children": [
											{
												"type": "tab",
												"id": "#1001",
												"name": "Assets",
												"component": "assets"
											}
										]
									},
									{
										"type": "tabset",
										"id": "#18",
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
												"name": "Info",
												"component": "info"
											},
											{
												"type": "tab",
												"id": "#1012",
												"name": "Terminal",
												"component": "terminal"
											}
										]
									}
								]
							},
							{
								"type": "row",
								"id": "#7",
								"weight": 50,
								"children": [
									{
										"type": "tabset",
										"id": "#8",
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
										"id": "#10",
										"weight": 30,
										"children": [
											{
												"type": "tab",
												"id": "#11",
												"name": "Orders",
												"component": "orders"
											},
											{
												"type": "tab",
												"id": "#12",
												"name": "History",
												"component": "history"
											}
										]
									}
								]
							}
						]
					},
					{
						"type": "tabset",
						"id": "#13",
						"weight": 30,
						"children": [
							{
								"type": "tab",
								"id": "#2010",
								"name": "Trade",
								"component": "trade"
							}
						]
					},
					{
						"type": "tabset",
						"id": "#20",
						"weight": 7.5,
						"children": [
							{
								"type": "tab",
								"id": "#201",
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
		path.resolve(os.homedir(), '.feathercoin', FCONF_NAME) :
		path.resolve(getAppDataPath('Feathercoin'), FCONF_NAME),
	numformat: US_NUMF,
	apikey: "",
	apisecret: "",
};