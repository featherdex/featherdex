import React from 'react';

import { Mutex } from 'async-mutex';

import { handleError, repeatAsync } from './util';

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

		if (trimData.length > 0)
			trimData = trimData.filter(v => {
				const t = timeifierCallback(v);
				return t >= timeStart && t <= timeEnd && !pruneCondition(v);
			});

		let newData: T[] = [];

		if (timeStart < state.timeLast.start) {
			const req: T[] = await repeatAsync(requestCallback, 5)(timeStart,
				Math.min(timeEnd, Math.max(state.timeLast.start - 1, timeStart)))
				.catch(e => {
					handleError(e, "error");
					return null;
				});

			if (req === null) {
				release();
				return state.data;
			}

			newData.push(...req);
		}

		newData.push(...trimData);

		if (timeEnd > state.timeLast.end) {
			const req: T[] = await repeatAsync(requestCallback, 5)
				(Math.max(Math.min(state.timeLast.end + 1, timeEnd), timeStart),
					timeEnd).catch(e => {
						handleError(e, "error");
						return null;
					});

			if (req === null) {
				release();
				return state.data;
			}

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

export default useTimeCache;