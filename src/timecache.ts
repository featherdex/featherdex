import React from 'react';

import { Mutex } from 'async-mutex';

import { repeatAsync } from './util';

const useTimeCache = <T>(requestCallback: (timeStart: number,
	timeEnd: number) => Promise<T[]>, timeifierCallback: (t: T) => number) => {
	const [state, setState] = React.useState({
		data: [] as T[], // from oldest to newest
		timeLast: { start: -1, end: -1 }, // last refresh's range
		mutexRelease: null,
	});

	// Refresh one at a time
	const mutex = React.useMemo(() => new Mutex(), []);

	React.useEffect(() => {
		if (!!state.mutexRelease) state.mutexRelease();
	}, [state]);

	const refresh = async (timeStart: number, timeEnd: number,
		pruneCondition = (_: T) => false): Promise<T[]> => {
		const release = await mutex.acquire();

		if (timeStart < 0 || timeStart < 0 || timeStart > timeEnd) {
			release();
			throw new Error("TimeCache.refresh(): Invalid times "
				+ `timeStart=${timeStart}, timeEnd=${timeEnd}`);
		}

		let trimData = state.data;

		// Prune prunable data and outside of time range
		if (trimData.length > 0)
			trimData = trimData.filter(v => {
				const t = timeifierCallback(v);
				return t >= timeStart && t <= timeEnd && !pruneCondition(v);
			});

		let newData: T[] = [];

		// Append data before time range
		if (timeStart < state.timeLast.start) {
			const req: T[] = await repeatAsync(requestCallback, 5)(timeStart,
				Math.min(timeEnd, state.timeLast.start - 1)).catch(e => {
					release();
					throw e;
				});

			newData.push(...req);
		}

		newData.push(...trimData);

		// Append data after time range
		if (timeEnd > state.timeLast.end) {
			const req: T[] = await repeatAsync(requestCallback, 5)
				(Math.max(state.timeLast.end + 1, timeStart), timeEnd).catch(e => {
					release();
					throw e;
				});

			newData.push(...req);
		}

		setState({
			data: newData,
			timeLast: { start: timeStart, end: timeEnd },
			mutexRelease: release,
		});
		return newData;
	}

	return { state, refresh };
};

export class TimeCache<T> {
	requestCallback;
	timeifierCallback;
	data: T[] = [];
	timeLast = { start: -1, end: -1 };
	mutex;

	constructor(requestCallback: (timeStart: number,
		timeEnd: number) => Promise<T[]>, timeifierCallback: (t: T) => number) {
		this.requestCallback = requestCallback;
		this.timeifierCallback = timeifierCallback;
		this.mutex = new Mutex();
	}

	refresh = async (timeStart: number, timeEnd: number,
		pruneCondition = (_: T) => false): Promise<T[]> => {
		const release = await this.mutex.acquire();

		if (timeStart < 0 || timeStart < 0 || timeStart > timeEnd) {
			release();
			throw new Error("TimeCache.refresh(): Invalid times "
				+ `timeStart=${timeStart}, timeEnd=${timeEnd}`);
		}

		let trimData = this.data;

		// Prune prunable data and outside of time range
		if (trimData.length > 0)
			trimData = trimData.filter(v => {
				const t = this.timeifierCallback(v);
				return t >= timeStart && t <= timeEnd && !pruneCondition(v);
			});

		let newData: T[] = [];

		// Append data before time range
		if (timeStart < this.timeLast.start) {
			const req: T[] = await repeatAsync(this.requestCallback, 5)(timeStart,
				Math.min(timeEnd, this.timeLast.start - 1)).catch(e => {
					release();
					throw e;
				});

			newData.push(...req);
		}

		newData.push(...trimData);

		// Append data after time range
		if (timeEnd > this.timeLast.end) {
			const req: T[] = await repeatAsync(this.requestCallback, 5)
				(Math.max(this.timeLast.end + 1, timeStart), timeEnd).catch(e => {
					release();
					throw e;
				});

			newData.push(...req);
		}

		this.data = [...newData];
		this.timeLast = { start: timeStart, end: timeEnd };

		release();
		return newData;
	}
};

export default useTimeCache;