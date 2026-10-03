import type { InferenceSession } from 'onnxruntime-web';

type CreateSession = (model: Uint8Array, options: InferenceSession.SessionOptions) => Promise<InferenceSession>;

/** Prefer GPU kernels, with WASM for unsupported operators and unavailable GPUs. */
export async function createEcgSession(
	model: Uint8Array,
	createSession: CreateSession,
	hasWebGpu: boolean,
	status: (text: string) => void
): Promise<InferenceSession> {
	if (hasWebGpu) {
		status('Initializing the model with WebGPU preferred…');
		try {
			return await createSession(model, { executionProviders: ['webgpu', 'wasm'] });
		} catch {
			// A usable API does not guarantee that this adapter can load the model.
			status('GPU initialization failed. Initializing the model on CPU…');
		}
	} else {
		status('WebGPU is unavailable. Initializing the model on CPU…');
	}
	return createSession(model, { executionProviders: ['wasm'] });
}
