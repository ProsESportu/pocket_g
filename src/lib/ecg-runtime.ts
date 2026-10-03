import type { InferenceSession } from 'onnxruntime-web';

type CreateSession = (model: Uint8Array, options: InferenceSession.SessionOptions) => Promise<InferenceSession>;

/** WebGL cannot execute this model's 1D convolutions. Use WASM as the fallback. */
export async function createEcgSession(
	model: Uint8Array,
	createSession: CreateSession,
	hasWebGpu: boolean,
	status: (text: string) => void,
	createCpuSession: CreateSession
): Promise<InferenceSession> {
	if (hasWebGpu) {
		status('Initializing the model with WebGPU preferred…');
		try {
			return await createSession(model, { executionProviders: ['webgpu', 'wasm'] });
		} catch {
			// A usable API does not guarantee that this adapter can load the model.
			status('WebGPU initialization failed. Initializing the model on CPU…');
		}
	} else {
		status('WebGPU is unavailable. Initializing the model on CPU…');
	}
	return createCpuSession(model, { executionProviders: ['wasm'] });
}

/** GPU sessions can fail at execution even after successful initialization. */
export async function runEcgSession(
	session: InferenceSession,
	run: (session: InferenceSession) => Promise<InferenceSession.ReturnType>,
	createCpuSession: () => Promise<InferenceSession>,
	canRetry: boolean,
	status: (text: string) => void
): Promise<{ session: InferenceSession; output: InferenceSession.ReturnType }> {
	try {
		return { session, output: await run(session) };
	} catch (error) {
		if (!canRetry) throw error;
		status('WebGPU inference failed. Retrying analysis on CPU…');
		await session.release().catch(() => {});
		const cpuSession = await createCpuSession();
		try {
			return { session: cpuSession, output: await run(cpuSession) };
		} catch (cpuError) {
			await cpuSession.release().catch(() => {});
			throw cpuError;
		}
	}
}
