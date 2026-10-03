import type { GyroReading } from './gyro-energy.ts';
import type { GyroSnapshot } from './gyro-readings.ts';

export type GyroSessionState = {
	readings: GyroReading[]; throughId: number; baselineId: number | null;
	busy: boolean; resetting: boolean; error: string; loadedAt: string; hasLoaded: boolean;
};
export const initialGyroSession = (baselineId: number | null = null): GyroSessionState => ({
	readings: [], throughId: baselineId ?? 0, baselineId, busy: false, resetting: false, error: '', loadedAt: '', hasLoaded: false
});

type Dependencies = {
	load: (afterId: number, signal: AbortSignal) => Promise<GyroSnapshot>;
	latest: (signal: AbortSignal) => Promise<number>;
	change: (state: GyroSessionState) => void;
};

/** One request plus a coalesced pending refresh; generation checks also protect against ignored aborts. */
export class GyroSession {
	state: GyroSessionState;
	private dependencies: Dependencies;
	private enabled = true;
	private disposed = false;
	private generation = 0;
	private aborter: AbortController | null = null;
	private pending: 'auto' | 'manual' | null = null;

	constructor(dependencies: Dependencies, baselineId: number | null = null) {
		this.dependencies = dependencies;
		this.state = initialGyroSession(baselineId);
	}
	private publish(update: Partial<GyroSessionState>) {
		this.state = { ...this.state, ...update };
		this.dependencies.change(this.state);
	}
	setMonitoring(enabled: boolean) {
		this.enabled = enabled;
		if (!enabled && this.pending === 'auto') this.pending = null;
	}
	async refresh(manual = false): Promise<void> {
		if (this.disposed || (!this.enabled && !manual)) return;
		if (this.state.busy) {
			if (manual || this.pending !== 'manual') this.pending = manual ? 'manual' : 'auto';
			return;
		}
		const generation = ++this.generation;
		const aborter = this.aborter = new AbortController();
		this.publish({ busy: true });
		try {
			const snapshot = await this.dependencies.load(this.state.throughId, aborter.signal);
			if (generation !== this.generation || this.disposed) return;
			this.publish({ readings: snapshot.readings.length ? [...this.state.readings, ...snapshot.readings] : this.state.readings,
				throughId: snapshot.throughId, loadedAt: new Date().toISOString(), hasLoaded: true, error: '' });
		} catch (error) {
			if (generation === this.generation && !this.disposed) this.publish({ error: error instanceof Error ? error.message : 'Could not reach Supabase for gyro readings.' });
		} finally {
			this.finish(generation);
		}
	}
	async reset(): Promise<void> {
		if (this.disposed || this.state.resetting) return;
		this.aborter?.abort();
		this.pending = null;
		const generation = ++this.generation;
		const aborter = this.aborter = new AbortController();
		this.publish({ busy: true, resetting: true });
		try {
			const boundary = await this.dependencies.latest(aborter.signal);
			if (generation !== this.generation || this.disposed) return;
			this.publish({ readings: [], throughId: boundary, baselineId: boundary,
				loadedAt: new Date().toISOString(), hasLoaded: true, error: '' });
		} catch (error) {
			if (generation === this.generation && !this.disposed) this.publish({ error: `Reset failed. ${error instanceof Error ? error.message : 'Could not reach Supabase.'} Your session was kept.` });
		} finally {
			this.finish(generation);
		}
	}
	private finish(generation: number) {
		if (generation !== this.generation || this.disposed) return;
		this.aborter = null;
		this.publish({ busy: false, resetting: false });
		const pending = this.pending;
		this.pending = null;
		if (pending) void this.refresh(pending === 'manual');
	}
	dispose() {
		this.disposed = true;
		this.generation++;
		this.pending = null;
		this.aborter?.abort();
	}
}
