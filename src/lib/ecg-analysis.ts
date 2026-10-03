import { ECG_SAMPLES, validateWaveform, type EcgResult, type InferenceRequest, type InferenceMessage } from './ecg.ts';
import type { EcgWindow } from './ecg-database.ts';

export type EcgAnalysisState = {
	busy: boolean; status: string; error: string; progress?: number; result: EcgResult | null;
};
export const initialEcgAnalysisState = (): EcgAnalysisState => ({ busy: false, status: '', error: '', result: null });
type Dependencies = {
	worker: () => Pick<Worker, 'onmessage' | 'onerror' | 'postMessage' | 'terminate'>;
	urls: () => Pick<InferenceRequest, 'modelUrl' | 'labelsUrl'>;
	change: (state: EcgAnalysisState) => void;
	complete: (result: EcgResult) => void;
	settled?: (success: boolean) => void;
};

export class EcgAnalysisController {
	private dependencies: Dependencies;
	private state = initialEcgAnalysisState();
	private generation = 0;
	private worker: ReturnType<Dependencies['worker']> | undefined;
	constructor(dependencies: Dependencies) { this.dependencies = dependencies; }
	private update(patch: Partial<EcgAnalysisState>) {
		this.state = { ...this.state, ...patch };
		this.dependencies.change(this.state);
	}
	private finish(result: EcgResult) {
		this.update({ busy: false, error: '', progress: undefined, result,
			status: result.status === 'ready' ? 'Analysis complete. All 150 scores are available.' : result.reason });
		this.dependencies.complete(result);
		this.dependencies.settled?.(true);
	}
	private fail(cause: unknown) {
		this.worker?.terminate();
		this.worker = undefined;
		this.update({ busy: false, progress: undefined, status: 'Analysis failed.',
			error: cause instanceof Error ? cause.message : 'Could not analyze the database ECG values.' });
		this.dependencies.settled?.(false);
	}

	analyze(window: EcgWindow) {
		if (this.state.busy) return;
		const requestId = ++this.generation;
		this.update({ busy: true, error: '', progress: undefined, status: 'Preparing database ECG values…' });
		const { samples, error, ...info } = window;
		const result: EcgResult = { status: 'unavailable', reason: '', scores: [], window: { ...info }, elapsedMs: 0, analyzedAt: '' };
		const unavailable = (reason: string) => this.finish({ ...result, reason, analyzedAt: new Date().toISOString() });
		if (error) { this.fail(new Error(error)); return; }
		if (samples.length !== ECG_SAMPLES) {
			unavailable(`Needs 5,000 finite EKG samples. ${window.available.toLocaleString('en-GB')} so far.`);
			return;
		}
		try { validateWaveform(samples); }
		catch (cause) { unavailable(cause instanceof Error ? cause.message : 'ECG input is unavailable.'); return; }
		try {
			this.worker ??= this.dependencies.worker();
			this.worker.onmessage = (event: MessageEvent<InferenceMessage>) => {
				const message = event.data;
				if (requestId !== this.generation || message.requestId !== requestId || !this.state.busy) return;
				if (message.type === 'status') this.update({ status: message.text, progress: message.progress });
				else if (message.type === 'error') this.fail(new Error(message.text));
				else this.finish({ ...result, status: 'ready', scores: message.scores, elapsedMs: message.elapsedMs,
					analyzedAt: new Date().toISOString() });
			};
			this.worker.onerror = () => {
				if (requestId === this.generation && this.state.busy) this.fail(new Error('The browser could not run the ECG worker. Retrying with a fresh worker.'));
			};
			this.worker.postMessage({ requestId, samples: [...samples], ...this.dependencies.urls() } satisfies InferenceRequest);
		} catch (cause) { this.fail(cause); }
	}

	dispose() {
		++this.generation;
		this.worker?.terminate();
		this.worker = undefined;
	}
}
