export type MonitoringSnapshot<T> = {
	snapshot: T | null; key: string; enabled: boolean; manualRequest?: number;
};
type Timer = ReturnType<typeof setTimeout> | number;
type Dependencies<T> = {
	run: (snapshot: T) => void;
	change?: (retryAt: number) => void;
	now?: () => number;
	setTimer?: (callback: () => void, delay: number) => Timer;
	clearTimer?: (timer: Timer) => void;
};

/** One active run and one replaceable latest snapshot, independently per model. */
export class AnalysisMonitor<T> {
	private dependencies: Dependencies<T>;
	private latest: { snapshot: T; key: string } | null = null;
	private active: { snapshot: T; key: string } | null = null;
	private completedKey: string | null = null;
	private enabled = false;
	private manualRequest = 0;
	private manualPending = false;
	private failures = 0;
	private retryAt = 0;
	private timer: Timer | undefined;
	private disposed = false;

	constructor(dependencies: Dependencies<T>) { this.dependencies = dependencies; }
	private now() { return (this.dependencies.now ?? Date.now)(); }
	private clearTimer() {
		if (this.timer !== undefined) (this.dependencies.clearTimer ?? clearTimeout)(this.timer);
		this.timer = undefined;
	}

	observe({ snapshot, key, enabled, manualRequest = 0 }: MonitoringSnapshot<T>) {
		if (this.disposed) return;
		this.latest = snapshot === null ? null : { snapshot, key };
		this.enabled = enabled;
		if (manualRequest !== this.manualRequest) {
			this.manualRequest = manualRequest;
			this.manualPending = snapshot !== null;
		}
		this.start();
	}

	private start() {
		this.clearTimer();
		if (this.disposed || this.active || !this.latest || (!this.enabled && !this.manualPending)) return;
		if (this.latest.key === this.completedKey && !this.manualPending) return;
		const delay = this.retryAt - this.now();
		if (delay > 0 && !this.manualPending) {
			this.timer = (this.dependencies.setTimer ?? setTimeout)(() => {
				this.timer = undefined;
				this.start();
			}, delay);
			return;
		}
		this.active = this.latest;
		this.manualPending = false;
		try { this.dependencies.run(this.active.snapshot); }
		catch { this.complete(false); }
	}

	complete(success: boolean) {
		if (this.disposed || !this.active) return;
		if (success) {
			this.completedKey = this.active.key;
			this.failures = 0;
			this.retryAt = 0;
		} else {
			if (this.completedKey === this.active.key) this.completedKey = null;
			this.failures++;
			this.retryAt = this.now() + Math.min(60000, 5000 * 2 ** Math.min(this.failures - 1, 4));
		}
		this.active = null;
		this.dependencies.change?.(this.retryAt);
		this.start();
	}

	dispose() {
		this.disposed = true;
		this.clearTimer();
		this.latest = this.active = null;
	}
}
