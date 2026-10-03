import type { InferenceSession } from 'onnxruntime-web';

type CreateSession = (model: Uint8Array, options: InferenceSession.SessionOptions) => Promise<InferenceSession>;

/** Prefer WebGPU, then WebGL, with WASM as the final fallback. */
export async function createEcgSession(
	model: Uint8Array,
	createSession: CreateSession,
	hasWebGpu: boolean,
	status: (text: string) => void,
	createWebGlSession: CreateSession
): Promise<InferenceSession> {
	if (hasWebGpu) {
		status('Initializing the model with WebGPU preferred…');
		try {
			return await createSession(model, { executionProviders: ['webgpu', 'wasm'] });
		} catch {
			// A usable API does not guarantee that this adapter can load the model.
			status('WebGPU initialization failed. Trying WebGL…');
		}
	} else {
		status('WebGPU is unavailable. Trying WebGL…');
	}
	try {
		return await createWebGlSession(model, { executionProviders: ['webgl'] });
	} catch {
		// WebGL needs a worker-compatible canvas and support for every model operator.
		status('WebGL initialization failed. Initializing the model on CPU…');
	}
	return createSession(model, { executionProviders: ['wasm'] });
}
