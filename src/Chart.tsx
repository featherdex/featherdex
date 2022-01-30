"use strict";

import React from 'react';
import useResizeAware from 'react-resize-aware';
import useInterval from 'use-interval';
import styled from 'styled-components';

import { DateTime } from 'luxon';
import {
	createChart, IChartApi, ISeriesApi, UTCTimestamp, WatermarkOptions,
	BarData, LineData, WhitespaceData
} from 'lightweight-charts';

import api from './api';
import AppContext from './contexts/AppContext';
import AssetSearch from './AssetSearch';

import {
	CHART_MINUTE_DAYS, CHART_HOUR_MONTHS, CHART_DAY_YEARS, API_RETRIES,
	PROPID_BITCOIN, PROPID_COIN
} from './constants';
import {
	handleError, uniqueId, repeatAsync, isBarData, isWhitespaceData,
	inverseOHLC, toLine, toCandle, tradeToLineData
} from './util';

const C = {
	ChartHeader: styled.div`
	display: block;
	min-width: 580px;
	& > * {
		display: inline-block;
	}
	& * {
		z-index: 2;
	}`,
	ChartSearch: styled.div`
	min-width: 150px;
	width: 45%;
	& > * {
		display: inline-block;
	}
	& > div:not(.chart-button) {
		width: calc(50% - 12px);
	}`,
	ChartButtons: styled.div`
	& > * {
		display: inline-block;
	}`,
};

const Chart = () => {
	const {
		getClient, getConstants, refreshTrades
	} = React.useContext(AppContext);

	const [idBuy, setIDBuy] = React.useState(-1);
	const [idSell, setIDSell] = React.useState(-1);
	const [chart, setChart] = React.useState<IChartApi>(null);
	const [series, setSeries] = React.useState<ISeriesApi<any>>(null);
	const [chartType, setChartType] = React.useState("candle");
	const [chartInt, setChartInt] = React.useState("D");
	const [ready, setReady] = React.useState(false);
	const [lastUpdate, setLastUpdate] = React.useState(DateTime.now().toUTC());

	const [resizeListener, size] = useResizeAware();

	const uid = React.useMemo(() => uniqueId("chart-"), []);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const target = event.target;
		var value = target.type === "radio" ? target.checked : target.value;
		var name = target.name;

		if (name.startsWith("chart-") && value)
			setChartType(name.substr("chart-".length));
		else if (name.startsWith("int-") && value)
			setChartInt(name.substr("int-".length));
	}

	const toggleChart = (display: boolean) =>
		document.getElementById(uid).style["display"] = display ? "block" : "none";

	const getInterval = () => ["5m", "15m", "30m"].includes(chartInt) ?
		"MINUTE_5" : (["1h", "4h"].includes(chartInt) ?
			"HOUR_1" : "DAY_1");

	const getTimeBoundary = (date: DateTime, interval: string) =>
		date.startOf(interval === "DAY_1" ? "year" :
			(interval === "HOUR_1" ? "month" : "day"));

	React.useEffect(() => {
		const c = createChart(document.getElementById(uid));
		c.applyOptions({
			layout: {
				backgroundColor: '#0E0E19',
				textColor: '#B2B5BE',
			},
			grid: {
				horzLines: { color: '#242733' },
				vertLines: { color: '#242733' },
			},
			crosshair: {
				vertLine: {
					color: '#6A5ACD',
					width: 1,
					style: 1,
					visible: true,
					labelVisible: true,
				},
				horzLine: {
					color: '#6A5ACD',
					width: 1,
					style: 0,
					visible: true,
					labelVisible: true,
				},
				mode: 1,
			},
		});

		document.querySelectorAll(".wrapper input").forEach(v =>
			v.addEventListener("blur", () => toggleChart(true)));

		setChart(c);
	}, []);

	React.useEffect(() => {
		if (!chart) return;

		if (series) chart.removeSeries(series);

		let newSeries;

		if (chartType === "candle")
			newSeries = chart.addCandlestickSeries();
		else if (chartType === "bar")
			newSeries = chart.addBarSeries();
		else if (chartType === "line")
			newSeries = chart.addLineSeries();
		else if (chartType === "area")
			newSeries = chart.addAreaSeries();

		newSeries.applyOptions({
			priceFormat: {
				precision: 8,
				minMove: 10e-8,
			}
		});

		setSeries(newSeries);
	}, [chart, chartType]);

	React.useEffect(() => {
		const errorMark = (msg: string): WatermarkOptions => {
			return {
				color: 'white',
				visible: true,
				text: msg,
				fontSize: 12,
				fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
				fontStyle: '',
				horzAlign: 'center',
				vertAlign: 'center'
			};
		}

		if (!chart || !series || idBuy === -1 || idSell === -1) {
			setReady(false);
			if (series) series.setData([]);
			if (chart)
				chart.applyOptions({
					watermark: errorMark("type in a trading pair"),
				});
			return;
		}

		if (idBuy === idSell) {
			setReady(false);
			series.setData([]);
			chart.applyOptions({
				watermark: errorMark("buy and sell assets cannot be the same"),
			});
			return;
		}

		// TODO
		if (idBuy > PROPID_COIN && idSell > PROPID_COIN) {
			setReady(false);
			series.setData([]);
			chart.applyOptions({
				watermark:
					errorMark("arbitrary token pairs are not yet supported"),
			});
			return;
		}

		(async function genData() {
			setReady(false);

			const API = api(getClient());
			const { COIN_MARKET } = getConstants();

			let data: (BarData | WhitespaceData)[] = [];

			let rawInterval;

			switch (chartInt) {
				case "5m":
					rawInterval = 5 * 60;
					break;
				case "15m":
					rawInterval = 15 * 60;
					break;
				case "30m":
					rawInterval = 30 * 60;
					break;
				case "1h":
					rawInterval = 60 * 60;
					break;
				case "4h":
					rawInterval = 4 * 60 * 60;
					break;
				case "D":
				default:
					rawInterval = 24 * 60 * 60;
					break;
				case "W":
					rawInterval = 7 * 24 * 60 * 60;
					break;
			}

			const interval = getInterval();
			const chunkCount = interval === "MINUTE_5" ?
				CHART_MINUTE_DAYS : (interval === "HOUR_1" ?
					CHART_HOUR_MONTHS : CHART_DAY_YEARS);

			const now = DateTime.now().toUTC();
			const timeBoundary = getTimeBoundary(now, interval);

			const subInt = (date: DateTime, inter: string, i: number) =>
				date.minus(inter === "DAY_1" ? { years: i } :
					(inter === "HOUR_1" ? { months: i } :
						(inter === "MINUTE_5" ? { days: i } : {})));

			let btcdata: BarData[] = null;
			if (idBuy === PROPID_BITCOIN || idSell === PROPID_BITCOIN) {
				let firstdata = await
					repeatAsync(API.getCoinOHLCRecent, API_RETRIES)
						(COIN_MARKET, interval).then(arr =>
							arr.filter(v =>
								v.time >= timeBoundary.toSeconds()), err => {
									handleError(err);
									return [] as BarData[];
								});

				let chunks: Promise<BarData[]>[] = [];

				for (var i = chunkCount; i > 0; i--) {
					const date = subInt(timeBoundary, interval, i);

					let args = [COIN_MARKET, interval, date.year];
					if (interval !== "DAY_1") args.push(date.month);
					if (interval === "MINUTE_5") args.push(date.day);

					chunks.push(repeatAsync(API.getCoinOHLC, API_RETRIES)
						(...args).catch(err => {
							handleError(err);
							return [];
						}));
				}

				btcdata = [
					...new Set([...(await Promise.all(chunks)).flat(),
					...firstdata])
				];

				if (idBuy === PROPID_BITCOIN) // BTC-(token)
					btcdata = btcdata.map(inverseOHLC);

				// BTC-(base coin) or (base coin)-BTC
				if (idBuy === PROPID_COIN || idSell === PROPID_COIN)
					data = Array.from(btcdata);
			}

			if (idBuy > PROPID_COIN || idSell > PROPID_COIN) {
				// not done yet, get asset-(base coin) data
				let assetdata: (BarData | WhitespaceData)[] = [];

				const firstDate = subInt(timeBoundary, interval, chunkCount);
				const trades: LineData[] = await refreshTrades().then(data =>
					data.filter(trade =>
						trade.time >= firstDate.toSeconds()
						&& trade.idBuy === (idBuy > PROPID_COIN ?
							idBuy : idSell)).sort((a, b) =>
								a.time - b.time).map(tradeToLineData), e => {
									handleError(e, "error");
									return null;
								});
				if (trades === null) return;

				// TODO change above when arbitrary token trades supported

				assetdata = toCandle(trades, rawInterval);

				// TODO change ...
				if (idSell > PROPID_COIN) assetdata = assetdata.map(inverseOHLC);

				// Now multiply if we need to
				if (btcdata) {
					var i = 0, j = 0;
					for (; i < btcdata.length &&
						btcdata[i].time < assetdata[0].time; i++);
					for (; j < assetdata.length &&
						assetdata[j].time < btcdata[0].time; j++);

					var multdata: BarData[] = [];
					for (var x = 0; i + x < btcdata.length &&
						j + x < assetdata.length; x++) {
						const bd = btcdata[i + x], ad = assetdata[j + x];
						if (isBarData(ad))
							multdata.push({
								time: bd.time,
								open: bd.open * ad.open,
								high: bd.high * ad.high,
								low: bd.low * ad.low,
								close: bd.close * ad.close
							});
					}

					data = Array.from(multdata);
				} else
					data = Array.from(assetdata);
			}

			// Rescale if not standard time interval
			if (!["5m", "1h", "D"].includes(chartInt)) {
				let interNum;

				switch (chartInt) {
					case "15m":
						interNum = 15 * 60;
						break;
					case "30m":
						interNum = 30 * 60;
						break;
					case "4h":
						interNum = 4 * 60 * 60;
						break;
					case "W":
					default:
						interNum = 7 * 24 * 60 * 60;
				}

				data = toCandle(data, interNum);
			}

			series.setData((chartType === "line" || chartType === "area") ?
				data.map(toLine) : data);

			chart.applyOptions({
				watermark: {
					color: 'rgba(11, 94, 29, 0.4)',
					visible: true,
					text: idBuy + "/" + idSell,
					fontSize: 24,
					horzAlign: 'left',
					vertAlign: 'bottom',
				},
			});

			setReady(true);
		})();
	}, [chart, series, chartType, chartInt, idBuy, idSell]);

	useInterval(() => {
		if (!ready) return;
		(async function() {
			const API = api(getClient());
			const { COIN_MARKET } = getConstants();

			const interval = getInterval();
			const rawInterval = interval === "DAY_1" ? 24 * 60 * 60 :
				(interval === "HOUR_1" ? 60 * 60 : 5 * 60);

			const now = DateTime.now().toUTC();

			let updateTime = lastUpdate.startOf(interval === "DAY_1" ?
				"day" : (interval === "HOUR_1" ? "hour" : "minute"));

			if (interval === "MINUTE_5") {
				const mins = updateTime.minute;
				updateTime = updateTime.set({ minute: mins - mins % 5 });
			}

			const updateNextTime = updateTime.plus(interval === "DAY_1" ?
				{ days: 1 } : (interval === "HOUR_1" ?
					{ hours: 1 } : { minutes: 5 }));

			const candleTime = Math.floor(updateTime.toSeconds()) as UTCTimestamp;
			const candleNextTime =
				Math.floor(updateNextTime.toSeconds()) as UTCTimestamp;

			let btcdata: BarData[];
			if (idBuy === PROPID_BITCOIN || idSell === PROPID_BITCOIN)
				btcdata = await
					API.getCoinOHLCRecent(COIN_MARKET, interval).catch(err => {
						handleError(err);
						return [];
					});

			let assetdata: (BarData | WhitespaceData)[];
			if (idBuy > PROPID_COIN || idSell > PROPID_COIN) {
				const trades: LineData[] = await refreshTrades().then(arr =>
					arr.filter(trade => trade.time >= candleTime
						&& trade.idSell === (idBuy > PROPID_COIN ?
							idBuy : idSell)).map(tradeToLineData), e => {
								handleError(e, "error");
								return null;
							});
				if (trades === null) return;

				assetdata = toCandle(trades, rawInterval);
			}

			const updateCandle = (offset: number, ctime: UTCTimestamp) => {
				let candle: BarData | WhitespaceData;
				if (btcdata && btcdata.length !== 0) {
					let btccandle = btcdata[btcdata.length - 1 - offset];

					if (idBuy === PROPID_BITCOIN) btccandle = inverseOHLC(btccandle);
					if (idBuy === PROPID_COIN || idSell === PROPID_COIN)
						candle = { ...btccandle };
				}

				if (assetdata && assetdata.length !== 0) {
					let assetcandle = assetdata.find(v =>
						v.time === ctime);

					if (!assetcandle || isWhitespaceData(assetcandle))
						candle = { time: ctime };
					else {
						if (idSell > PROPID_COIN)
							assetcandle = inverseOHLC(assetcandle);

						if (candle)
							candle = {
								time: ctime,
								open: (candle as BarData).open
									* (assetcandle as BarData).open,
								high: (candle as BarData).high
									* (assetcandle as BarData).high,
								low: (candle as BarData).low
									* (assetcandle as BarData).low,
								close: (candle as BarData).close
									* (assetcandle as BarData).close
							};
						else
							candle = { ...assetcandle };
					}
				}

				if (!candle)
					candle = { time: ctime };

				if (!((candle as BarData).open || (candle as LineData).value))
					series.update(candle);
				else
					series.update((chartType === "line"
						|| chartType === "area") ?
						toLine(candle as BarData) : candle);

			}

			// need to update two candles if overflow
			if (now >= updateNextTime) {
				updateCandle(1, candleTime);
				updateCandle(0, candleNextTime);
			} else
				updateCandle(0, candleTime);

			setLastUpdate(now);
		})();
	}, 1000);

	React.useEffect(() => {
		if (!chart) return;
		chart.resize(size.width, size.height);
	}, [chart, size]);

	return <>
		<C.ChartHeader>
			<C.ChartSearch>
				<AssetSearch setAssetCallback={setIDBuy}
					disableCallback={toggleChart} zIndex={2} />
				<div className="chart-button chart-swap">&harr;</div>
				<AssetSearch setAssetCallback={setIDSell}
					disableCallback={toggleChart} zIndex={2} />
			</C.ChartSearch>
			<C.ChartButtons>
				<div className="chart-hspace"></div>
				<label className="chart-button">
					<input type="radio" name="chart-candle"
						className="chart-candle"
						checked={chartType === "candle"}
						onChange={handleChange} />
					<span className="checkmark"></span>
				</label>
				<label className="chart-button">
					<input type="radio" name="chart-bar"
						className="chart-bar"
						checked={chartType === "bar"}
						onChange={handleChange} />
					<span className="checkmark"></span>
				</label>
				<label className="chart-button">
					<input type="radio" name="chart-line"
						className="chart-line"
						checked={chartType === "line"}
						onChange={handleChange} />
					<span className="checkmark"></span>
				</label>
				<label className="chart-button">
					<input type="radio" name="chart-area"
						className="chart-area"
						checked={chartType === "area"}
						onChange={handleChange} />
					<span className="checkmark"></span>
				</label>
				<div className="chart-hspace"></div>
				<label className="chart-button">
					<input type="radio" name="int-5m"
						checked={chartInt === "5m"}
						onChange={handleChange} />
					<span className="checkmark">5m</span>
				</label>
				<label className="chart-button">
					<input type="radio" name="int-15m"
						checked={chartInt === "15m"}
						onChange={handleChange} />
					<span className="checkmark">15m</span>
				</label>
				<label className="chart-button">
					<input type="radio" name="int-30m"
						checked={chartInt === "30m"}
						onChange={handleChange} />
					<span className="checkmark">30m</span>
				</label>
				<label className="chart-button">
					<input type="radio" name="int-1h"
						checked={chartInt === "1h"}
						onChange={handleChange} />
					<span className="checkmark">1h</span>
				</label>
				<label className="chart-button">
					<input type="radio" name="int-4h"
						checked={chartInt === "4h"}
						onChange={handleChange} />
					<span className="checkmark">4h</span>
				</label>
				<label className="chart-button">
					<input type="radio" name="int-D"
						checked={chartInt === "D"}
						onChange={handleChange} />
					<span className="checkmark">D</span>
				</label>
				<label className="chart-button">
					<input type="radio" name="int-W"
						checked={chartInt === "W"}
						onChange={handleChange} />
					<span className="checkmark">W</span>
				</label>
			</C.ChartButtons>
		</C.ChartHeader>
		<div id={uid} className="chart">{resizeListener}</div>
	</>;
};

export default Chart;