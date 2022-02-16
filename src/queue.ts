import { Mutex } from 'async-mutex';

export class Queue<T> {
	queue = [] as T[];
	queueMap = new Map<T, number>();
	mutex = new Mutex();

	constructor(initialData = [] as T[]) {
		this.queue = [...initialData];
		this.queueMap = initialData.reduce((map, v) =>
			map.set(v, (map.get(v) || 0) + 1), new Map<T, number>());
	}

	push = (...x: T[]) => this.mutex.runExclusive(() => {
		this.queue = [...this.queue, ...x];
		this.queueMap = x.reduce((map, v) =>
			map.set(v, (map.get(v) || 0) + 1), this.queueMap);

		return this.queue.length;
	});

	pop = () => this.mutex.runExclusive(() => {
		let x = this.queue.shift();
		if (x !== undefined) {
			if (this.queueMap.get(x) === 1) this.queueMap.delete(x);
			else this.queueMap.set(x, this.queueMap.get(x) - 1);
		}
		return x;
	});

	clear = () => this.mutex.runExclusive(() => {
		const oQueue = [...this.queue];
		const oQueueMap = new Map(this.queueMap);

		this.queue = [];
		this.queueMap = new Map<T, number>();

		return { oldQueue: oQueue, oldQueueMap: oQueueMap };
	});

	has = (x: T) => this.queueMap.has(x);
}