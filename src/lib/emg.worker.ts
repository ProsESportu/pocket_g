import type { InferenceSession } from 'onnxruntime-web';
import { ort } from './ecg-cpu-runtime.ts';
import { EMG, type EmgInferenceRequest, type EmgInferenceMessage, type EmgMetadata, type EmgProfile } from './emg.ts';
import { processSignal } from './emg-preprocessing.ts';
import { predictRows, validateMetadata, validateProfile } from './emg-prediction.ts';

let configuration: Promise<{ metadata: EmgMetadata; profile: EmgProfile }> | undefined;
let session: Promise<InferenceSession> | undefined;

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Could not load EMG configuration (HTTP ${response.status}).`);
	return response.json();
}

function loadConfiguration(request: EmgInferenceRequest) {
	return configuration ??= Promise.all([fetchJson(request.metadataUrl), fetchJson(request.profileUrl)])
		.then(([metadata, profile]) => ({ metadata: validateMetadata(metadata), profile: validateProfile(profile) }));
}

async function createSession(modelUrl: string, metadata: EmgMetadata): Promise<InferenceSession> {
	const response = await fetch(modelUrl);
	if (!response.ok) throw new Error(`Could not load the EMG model (HTTP ${response.status}).`);
	const model = await response.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', model);
	const hash = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
	if (hash !== metadata.model_sha256) throw new Error('The EMG model and metadata do not match.');
	return ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
}

self.onmessage = async (event: MessageEvent<EmgInferenceRequest>) => {
	const request = event.data;
	const started = performance.now();
	const post = (message: EmgInferenceMessage) => self.postMessage(message);
	try {
		if (!Array.isArray(request.samples) || request.samples.length < EMG.minSamples || request.samples.length > EMG.maxSamples) {
			throw new Error('EMG analysis requires 10–60 seconds of samples at 125 Hz.');
		}
		post({ requestId: request.requestId, type: 'status', text: 'Filtering EMG and detecting repetitions…' });
		const { metadata, profile } = await loadConfiguration(request);
		const processed = processSignal(Float64Array.from(request.samples), profile);
		if (processed.rows.length < EMG.minReps) {
			post({ requestId: request.requestId, type: 'unavailable',
				reason: `Need at least three detected repetitions for the baseline. Found ${processed.rows.length}.`, elapsedMs: performance.now() - started });
			return;
		}
		post({ requestId: request.requestId, type: 'status', text: session ? 'Scoring repetitions…' : 'Loading the EMG model on CPU…' });
		const loaded = await (session ??= createSession(request.modelUrl, metadata));
		const prediction = await predictRows(ort, loaded, processed.rows, metadata);
		post({ requestId: request.requestId, type: 'result', ...prediction,
			elapsedMs: performance.now() - started, modelSha256: metadata.model_sha256 });
	} catch (error) {
		post({ requestId: request.requestId, type: 'error', text: error instanceof Error ? error.message : 'Could not analyze EMG.' });
	}
};
