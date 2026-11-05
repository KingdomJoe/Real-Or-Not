/*
 * RON (Real or Not) — Forensics worker client (main-thread side).
 *
 * Spawns `forensics.worker.ts` once (singleton), posts ImageData RGBA with
 * transferable buffers, and resolves typed results. Browser-only; SSR-safe
 * (all methods no-op / throw a clear error when `!browser`).
 */

import { browser } from '$app/env';
import type {
	ForensicsAnalyzeResponse,
	ForensicsWorkerIn,
	ForensicsWorkerOut
} from '#lib/types/ron';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
	number,
	{ resolve: (r: ForensicsAnalyzeResponse) => void; reject: (e: Error) => void }
>();
let engineCache: 'rust-wasm' | 'typescript-worker' | null = null;

function getWorker(): Worker {
	if (!browser) throw new Error('ForensicsClient is browser-only.');
	if (!worker) {
		worker = new Worker(new URL('./forensics.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (ev: MessageEvent<ForensicsWorkerOut>) => {
			const msg = ev.data;
			const slot = pending.get(msg.id);
			if (!slot) return;
			pending.delete(msg.id);
			if (msg.type === 'result') {
				engineCache = msg.engine;
				slot.resolve(msg);
			} else if (msg.type === 'pong') {
				engineCache = msg.engine;
				slot.reject(new Error('Unexpected pong for analyze()'));
			} else {
				slot.reject(new Error(msg.message));
			}
		};
		worker.onerror = (ev) => {
			for (const [, slot] of pending) slot.reject(new Error(ev.message || 'Worker error'));
			pending.clear();
		};
	}
	return worker;
}

function post<T extends ForensicsWorkerOut>(msg: ForensicsWorkerIn, transfer?: Transferable[]): Promise<T> {
	const w = getWorker();
	return new Promise<T>((resolve, reject) => {
		pending.set(msg.id, { resolve: resolve as (r: ForensicsAnalyzeResponse) => void, reject });
		w.postMessage(msg, transfer ?? []);
	});
}

/** Analyze one frame. `rgba` is transferred (neutered) — clone first if you need it. */
export async function analyzeFrame(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
	opts: { elaQuality?: number; fftCutoff?: number } = {}
): Promise<ForensicsAnalyzeResponse> {
	const id = nextId++;
	return post<ForensicsAnalyzeResponse>(
		{ id, type: 'analyze', rgba, width, height, elaQuality: opts.elaQuality, fftCutoff: opts.fftCutoff },
		[rgba.buffer as Transferable]
	);
}

/** Convenience: analyze an ImageData object (clones pixels so the input stays usable). */
export async function analyzeImageData(
	image: ImageData,
	opts: { elaQuality?: number; fftCutoff?: number } = {}
): Promise<ForensicsAnalyzeResponse> {
	const clone = new Uint8ClampedArray(image.data);
	return analyzeFrame(clone, image.width, image.height, opts);
}

/** Which engine is active? Resolves after a ping round-trip (cached afterwards). */
export async function forensicsEngine(): Promise<'rust-wasm' | 'typescript-worker'> {
	if (engineCache) return engineCache;
	if (!browser) return 'typescript-worker';
	const id = nextId++;
	const w = getWorker();
	const engine = await new Promise<'rust-wasm' | 'typescript-worker'>((resolve, reject) => {
		const onMsg = (ev: MessageEvent<ForensicsWorkerOut>) => {
			const msg = ev.data;
			if (msg.id !== id) return;
			w.removeEventListener('message', onMsg);
			if (msg.type === 'pong') {
				engineCache = msg.engine;
				resolve(msg.engine);
			} else if (msg.type === 'error') {
				reject(new Error(msg.message));
			} else {
				reject(new Error('Unexpected worker message'));
			}
		};
		w.addEventListener('message', onMsg);
		w.postMessage({ id, type: 'ping' });
	});
	return engine;
}

/** Tear down the singleton worker (e.g. on route destroy in tests). */
export function terminateForensicsWorker(): void {
	worker?.terminate();
	worker = null;
	pending.clear();
	engineCache = null;
}
