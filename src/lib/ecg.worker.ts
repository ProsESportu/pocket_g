import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { parseLabels, validateWaveform, scoreLogits, type InferenceRequest, type InferenceMessage } from './ecg.ts';
import { prepareWaveform } from './ecg-preprocessing.ts';
import { createEcgSession, runEcgSession } from './ecg-runtime.ts';

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
let usingCpu = false;
let modelBytes: Uint8Array | undefined;
let labels: string[] | undefined;
let running = false;
type WorkerUpdate = InferenceMessage extends infer Message ? Message extends InferenceMessage ? Omit<Message, 'requestId'> : never : never;

async function createCpuSession(bytes: Uint8Array, options: ort.InferenceSession.SessionOptions) {
	const cpu = await import('./ecg-cpu-runtime.ts');
	const initialized = await cpu.ort.InferenceSession.create(bytes, options);
	tensorRuntime = cpu.ort;
	usingCpu = true;
	return initialized;
}

async function runSession(current: ort.InferenceSession, prepared: Float32Array) {
	const input = new tensorRuntime.Tensor('float32', prepared, [1, 1, 5000]);
	try {
		return await current.run({ ecg: input });
	} finally {
		input.dispose();
	}
}

async function loadModel(url: string, send: (message: WorkerUpdate) => void): Promise<Uint8Array> {
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
	const { requestId } = event.data;
	const send = (message: WorkerUpdate) => self.postMessage({ ...message, requestId } satisfies InferenceMessage);
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
			tensorRuntime = ort;
			usingCpu = false;
			const model = modelBytes = await loadModel(modelUrl, send);
			const initialized = await createEcgSession(
				model,
				(bytes, options) => ort.InferenceSession.create(bytes, options),
				'gpu' in navigator,
				(text) => send({ type: 'status', text }),
				createCpuSession
			);
			if (initialized.inputNames[0] !== 'ecg' || initialized.outputNames[0] !== 'logits') {
				await initialized.release();
				throw new Error('Unexpected model input or output names.');
			}
			session = initialized;
		}
		send({ type: 'status', text: 'Analyzing the database ECG waveform…' });
		const started = performance.now();
		let output: ort.InferenceSession.ReturnType | undefined;
		try {
			const result = await runEcgSession(
				session,
				(current) => runSession(current, prepared),
				async () => {
					const bytes = modelBytes ?? await loadModel(modelUrl, send);
					return createCpuSession(bytes, { executionProviders: ['wasm'] });
				},
				!usingCpu,
				(text) => send({ type: 'status', text })
			);
			session = result.session;
			output = result.output;
			modelBytes = undefined;
			const logits = output.logits;
			if (logits.type !== 'float32' || logits.dims.join(',') !== '1,150') throw new Error('Unexpected model output shape.');
			send({ type: 'result', scores: scoreLogits(logits.data as Float32Array, labels), elapsedMs: performance.now() - started });
		} finally {
			if (output) for (const tensor of Object.values(output)) tensor.dispose();
		}
	} catch (error) {
		await session?.release().catch(() => {});
		session = undefined;
		modelBytes = undefined;
		send({ type: 'error', text: error instanceof Error ? error.message : 'Model inference failed. Please retry.' });
	} finally { running = false; }
};
