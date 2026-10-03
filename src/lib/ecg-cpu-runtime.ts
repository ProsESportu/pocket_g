import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

// A separate runtime keeps failed GPU initialization from poisoning CPU fallback.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = {
	wasm: new URL(wasmUrl, self.location.href).href,
	mjs: new URL(wasmModuleUrl, self.location.href).href
};

export { ort };
