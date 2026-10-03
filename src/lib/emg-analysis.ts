import { emgResult, type EmgResult, type EmgWindow, type EmgInferenceMessage, type EmgInferenceRequest } from './emg.ts';

export type EmgAnalysisState = { busy: boolean; status: string; error: string; result: EmgResult | null };
export const initialEmgAnalysisState = (): EmgAnalysisState => ({ busy: false, status: '', error: '', result: null });
type AnalysisWorker = Pick<Worker, 'onmessage' | 'onerror' | 'postMessage' | 'terminate'>;
type Dependencies = {
	load: (throughId: number | undefined, signal: AbortSignal) => Promise<EmgWindow>;
	worker: () => AnalysisWorker;
	urls: () => Pick<EmgInferenceRequest, 'modelUrl' | 'metadataUrl' | 'profileUrl'>;
	change: (state: EmgAnalysisState) => void;
	complete: (result: EmgResult) => void;
};

/** Owns cancellation and result provenance independently of dashboard refreshes. */
export class EmgAnalysisController {
	private state = initialEmgAnalysisState();
	private dependencies: Dependencies;
	private generation = 0;
	private abort: AbortController | undefined;
	private worker: AnalysisWorker | undefined;

	constructor(dependencies: Dependencies) { this.dependencies = dependencies; }

	private update(patch: Partial<EmgAnalysisState>) {
		this.state = { ...this.state, ...patch };
		this.dependencies.change(this.state);
	}

	private finish(result: EmgResult) {
		this.update({ busy: false, error: '', result, status: result.status === 'ready' ? 'Analysis complete.' : result.reason });
		this.dependencies.complete(result);
	}

	private fail(error: unknown) {
		this.worker?.terminate();
		this.worker = undefined;
		this.update({ busy: false, status: 'Analysis failed.', error: error instanceof Error ? error.message : 'Could not analyze EMG. Retry analysis.' });
	}

	async analyze(throughId: number | undefined) {
		if (this.state.busy) return;
		const requestId = ++this.generation;
		this.abort = new AbortController();
		this.update({ busy: true, status: 'Loading the latest continuous EMG recording…', error: '' });
		try {
			const window = await this.dependencies.load(throughId, this.abort.signal);
			if (requestId !== this.generation) return;
			const { samples, reason, ...info } = window;
			if (reason) { this.finish(emgResult(info, { reason })); return; }
			this.worker ??= this.dependencies.worker();
			this.worker.onmessage = (event: MessageEvent<EmgInferenceMessage>) => {
				const message = event.data;
				if (requestId !== this.generation || message.requestId !== requestId || !this.state.busy) return;
				if (message.type === 'status') this.update({ status: message.text });
				else if (message.type === 'error') this.fail(new Error(message.text));
				else if (message.type === 'unavailable') this.finish(emgResult(info, { reason: message.reason, elapsedMs: message.elapsedMs }));
				else this.finish(emgResult(info, { status: 'ready', rows: message.rows, triggerRep: message.triggerRep,
					elapsedMs: message.elapsedMs, modelSha256: message.modelSha256 }));
			};
			this.worker.onerror = () => {
				if (requestId === this.generation && this.state.busy) this.fail(new Error('The browser could not run the EMG worker. Retry in a browser with WebAssembly support.'));
			};
			this.worker.postMessage({ requestId, samples, ...this.dependencies.urls() } satisfies EmgInferenceRequest);
		} catch (error) {
			if (requestId === this.generation) this.fail(error);
		}
	}

	cancel() {
		this.dispose();
		this.update({ busy: false, error: '', status: 'Analysis canceled. You can try again.' });
	}

	dispose() {
		++this.generation;
		this.abort?.abort();
		this.worker?.terminate();
		this.worker = undefined;
	}
}
