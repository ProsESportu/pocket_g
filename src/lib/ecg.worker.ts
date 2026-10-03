import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { parseLabels, validateWaveform, scoreLogits, type InferenceRequest, type InferenceMessage } from './ecg.ts';
import { prepareWaveform } from './ecg-preprocessing.ts';
import { createEcgSession } from './ecg-runtime.ts';

// The outer worker keeps inference off the UI thread. One WASM thread avoids requiring COOP/COEP.
// Runtime 1.30's /webgpu entry uses native WebGPU with Asyncify, not the JSEP build.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = {
	wasm: new URL(wasmUrl, self.location.href).href,
	mjs: new URL(wasmModuleUrl, self.location.href).href
};
let session: ort.InferenceSession | undefined;
let tensorRuntime = ort;
let labels: string[] | undefined;
let running = false;
const send = (message: InferenceMessage) => self.postMessage(message);

async function loadModel(url: string): Promise<Uint8Array> {
	const response = await fetch(url, { cache: 'force-cache' });
	if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}). Please retry.`);
	const length = Number(response.headers.get('content-length'));
	if (!response.body) return new Uint8Array(await response.arrayBuffer());
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	let previousPercent = -1;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		const progress = length > 0 ? Math.min(100, Math.floor(received / length * 100)) : undefined;
		if (progress !== previousPercent) {
			send({ type: 'status', text: 'Downloading ECGFounder (118 MiB)…', progress });
			previousPercent = progress ?? -1;
		}
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	return bytes;
}

self.onmessage = async (event: MessageEvent<InferenceRequest>) => {
	if (running) return;
	running = true;
	try {
		const { samples, modelUrl, labelsUrl } = event.data;
		send({ type: 'status', text: 'Checking waveform and preparing ECG…' });
		const prepared = prepareWaveform(validateWaveform(samples), 'raw');
		if (!labels) {
			const response = await fetch(labelsUrl);
			if (!response.ok) throw new Error('Could not load the ECGFounder labels. Please retry.');
			labels = parseLabels(await response.text());
		}
		if (!session) {
			const model = await loadModel(modelUrl);
			const initialized = await createEcgSession(
				model,
				(bytes, options) => ort.InferenceSession.create(bytes, options),
				'gpu' in navigator,
				(text) => send({ type: 'status', text }),
				async (bytes, options) => {
					// Keep WebGL separate: the /all bundle uses incompatible JSEP WASM assets.
					const webgl = await import('onnxruntime-web/webgl');
					const initialized = await webgl.InferenceSession.create(bytes, options);
					tensorRuntime = webgl;
					return initialized;
				}
			);
			if (initialized.inputNames[0] !== 'ecg' || initialized.outputNames[0] !== 'logits') {
				await initialized.release();
				throw new Error('Unexpected model input or output names.');
			}
			session = initialized;
		}
		send({ type: 'status', text: 'Analyzing the database ECG waveform…' });
		const started = performance.now();
		const input = new tensorRuntime.Tensor('float32', prepared, [1, 1, 5000]);
		let output: ort.InferenceSession.ReturnType | undefined;
		try {
			output = await session.run({ ecg: input });
			const logits = output.logits;
			if (logits.type !== 'float32' || logits.dims.join(',') !== '1,150') throw new Error('Unexpected model output shape.');
			send({ type: 'result', scores: scoreLogits(logits.data as Float32Array, labels), elapsedMs: performance.now() - started });
		} finally {
			input.dispose();
			if (output) for (const tensor of Object.values(output)) tensor.dispose();
		}
	} catch (error) {
		send({ type: 'error', text: error instanceof Error ? error.message : 'Model inference failed. Please retry.' });
	} finally { running = false; }
};
