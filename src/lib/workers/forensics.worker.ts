/*
 * RON (Real or Not) — forensic signal Web Worker.
 *
 * Runs at 60 FPS off the main thread. Automatically loads the compiled Rust
 * WASM engine (`/wasm/ron_forensics_bg.wasm`) when present, otherwise executes
 * the identical typed-array math in TypeScript — same outputs, zero blocking.
 *
 * Protocol: see `ForensicsWorkerIn` / `ForensicsWorkerOut` in `#lib/types/ron`.
 */

/// <reference lib="webworker" />

import type { ForensicsWorkerIn, ForensicsWorkerOut } from '#lib/types/ron';

const ctx = self as unknown as {
	postMessage: (msg: unknown, transfer?: Transferable[]) => void;
	onmessage: ((ev: MessageEvent<ForensicsWorkerIn>) => void) | null;
};

/* ─── Shared constants ─────────────────────────────────────────────────── */

const BAYER_8X8 = new Uint8Array([
	0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38,
	60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57,
	25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21
]);

function luminance(r: number, g: number, b: number): number {
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/* ─── TypeScript fallback: Boundary ΔELA ────────────────────────────────── */

function elaMapTs(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
	elaQ: number,
	out: Uint8ClampedArray
): void {
	const q = Math.min(95, Math.max(10, elaQ));
	const step = 255 / q;
	const blocksX = Math.ceil(width / 8);
	const blocksY = Math.ceil(height / 8);
	for (let by = 0; by < blocksY; by++) {
		for (let bx = 0; bx < blocksX; bx++) {
			let sum = 0;
			let n = 0;
			for (let dy = 0; dy < 8; dy++) {
				for (let dx = 0; dx < 8; dx++) {
					const x = bx * 8 + dx;
					const y = by * 8 + dy;
					if (x >= width || y >= height) continue;
					const i = (y * width + x) * 4;
					sum += luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
					n++;
				}
			}
			const mean = n > 0 ? sum / n : 0;
			const requant = Math.round(mean / step) * step;
			for (let dy = 0; dy < 8; dy++) {
				for (let dx = 0; dx < 8; dx++) {
					const x = bx * 8 + dx;
					const y = by * 8 + dy;
					if (x >= width || y >= height) continue;
					const i = (y * width + x) * 4;
					const lum = luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
					let residual = Math.abs(lum - requant);
					if (dx === 0 || dy === 0) residual *= 1.5;
					out[y * width + x] = Math.min(255, residual * 4);
				}
			}
		}
	}
}

/* ─── TypeScript fallback: 32-pt radix-2 FFT + 2D grid strength ─────────── */

function fft1d(re: Float32Array, im: Float32Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i]; re[i] = re[j]; re[j] = tr;
			const ti = im[i]; im[i] = im[j]; im[j] = ti;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let curR = 1;
			let curI = 0;
			for (let j = 0; j < len / 2; j++) {
				const ur = re[i + j];
				const ui = im[i + j];
				const vr = re[i + j + len / 2] * curR - im[i + j + len / 2] * curI;
				const vi = re[i + j + len / 2] * curI + im[i + j + len / 2] * curR;
				re[i + j] = ur + vr;
				im[i + j] = ui + vi;
				re[i + j + len / 2] = ur - vr;
				im[i + j + len / 2] = ui - vi;
				const nxtR = curR * wr - curI * wi;
				curI = curR * wi + curI * wr;
				curR = nxtR;
			}
		}
	}
}

const TILE = 32;
const tileBuf = new Float32Array(TILE * TILE);
const spectrum = new Float32Array(TILE * TILE);
const fftRe = new Float32Array(TILE);
const fftIm = new Float32Array(TILE);

function fftMapTs(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
	fftCutoff: number,
	out: Uint8ClampedArray
): void {
	const cutoff = Math.min(0.9, Math.max(0.05, fftCutoff));
	const center = TILE / 2;
	const tilesX = Math.ceil(width / TILE);
	const tilesY = Math.ceil(height / TILE);
	for (let ty = 0; ty < tilesY; ty++) {
		for (let tx = 0; tx < tilesX; tx++) {
			for (let dy = 0; dy < TILE; dy++) {
				for (let dx = 0; dx < TILE; dx++) {
					const x = Math.min(width - 1, tx * TILE + dx);
					const y = Math.min(height - 1, ty * TILE + dy);
					const i = (y * width + x) * 4;
					tileBuf[dy * TILE + dx] = luminance(rgba[i], rgba[i + 1], rgba[i + 2]) / 255;
				}
			}
			for (let r = 0; r < TILE; r++) {
				for (let c = 0; c < TILE; c++) {
					fftRe[c] = tileBuf[r * TILE + c];
					fftIm[c] = 0;
				}
				fft1d(fftRe, fftIm);
				for (let c = 0; c < TILE; c++) {
					spectrum[r * TILE + c] = Math.hypot(fftRe[c], fftIm[c]);
				}
			}
			for (let c = 0; c < TILE; c++) {
				for (let r = 0; r < TILE; r++) {
					fftRe[r] = spectrum[r * TILE + c];
					fftIm[r] = 0;
				}
				fft1d(fftRe, fftIm);
				for (let r = 0; r < TILE; r++) {
					spectrum[r * TILE + c] = Math.hypot(fftRe[r], fftIm[r]);
				}
			}
			let hi = 0;
			let total = 0;
			for (let r = 0; r < TILE; r++) {
				for (let c = 0; c < TILE; c++) {
					if (r === 0 && c === 0) continue;
					const mag = spectrum[r * TILE + c];
					total += mag;
					const dr = r - center;
					const dc = c - center;
					if (Math.hypot(dr, dc) / center >= cutoff) hi += mag;
				}
			}
			const ratio = total > 1e-6 ? hi / total : 0;
			const heat = Math.min(1, Math.max(0, (ratio - 0.15) / 0.5));
			const byte = Math.round(heat * 255);
			for (let dy = 0; dy < TILE; dy++) {
				for (let dx = 0; dx < TILE; dx++) {
					const x = tx * TILE + dx;
					const y = ty * TILE + dy;
					if (x < width && y < height) out[y * width + x] = byte;
				}
			}
		}
	}
}

/* ─── TypeScript fallback: 1-bit Bayer dither ────────────────────────────── */

function ditherMaskTs(
	ela: Uint8ClampedArray,
	width: number,
	height: number,
	out: Uint8ClampedArray
): void {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const threshold = BAYER_8X8[(y % 8) * 8 + (x % 8)] * 4;
			out[y * width + x] = ela[y * width + x] > threshold ? 255 : 0;
		}
	}
}

/* ─── Rust WASM fast path (lazy, best-effort) ────────────────────────────── */

type WasmModule = {
	default: (moduleOrPath?: unknown) => Promise<unknown>;
	forensic_maps_safe: (
		rgba: Uint8Array,
		width: number,
		height: number,
		elaQ: number,
		fftCutoff: number
	) => Uint8Array;
};

let wasm: WasmModule | null = null;
let wasmTried = false;

function ctxLocationOrigin(): string {
	try {
		return (self as unknown as { location: { origin: string } }).location.origin;
	} catch {
		return 'http://localhost';
	}
}

async function tryLoadWasm(): Promise<WasmModule | null> {
	if (wasmTried) return wasm;
	wasmTried = true;
	try {
		// wasm-pack --target web output lives in static/wasm/ (see rust-forensics/README.md).
		// Dynamic specifier (not a string literal) so TS/Vite leave it as a runtime URL.
		const glueUrl = new URL('/wasm/ron_forensics.js', ctxLocationOrigin()).href;
		const mod = (await import(/* @vite-ignore */ glueUrl)) as WasmModule;
		await mod.default();
		wasm = mod;
	} catch {
		wasm = null;
	}
	return wasm;
}

/* ─── Message loop ───────────────────────────────────────────────────────── */

ctx.onmessage = async (ev: MessageEvent<ForensicsWorkerIn>) => {
	const msg = ev.data;
	if (msg.type === 'ping') {
		const engine = (await tryLoadWasm()) ? 'rust-wasm' : 'typescript-worker';
		const out: ForensicsWorkerOut = { id: msg.id, type: 'pong', engine };
		ctx.postMessage(out);
		return;
	}

	if (msg.type !== 'analyze') return;
	const { id, rgba, width, height } = msg;
	const elaQ = msg.elaQuality ?? 90;
	const fftCutoff = msg.fftCutoff ?? 0.4;

	try {
		const t0 = performance.now();
		const engine = await tryLoadWasm();
		let ela: Uint8ClampedArray;
		let fft: Uint8ClampedArray;
		let dither: Uint8ClampedArray;
		let timings: { elaMs: number; fftMs: number; ditherMs: number; totalMs: number };

		if (engine) {
			const combined = engine.forensic_maps_safe(new Uint8Array(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), width, height, elaQ, fftCutoff);
			const px = width * height;
			ela = new Uint8ClampedArray(combined.buffer as ArrayBuffer, combined.byteOffset, px);
			fft = new Uint8ClampedArray(combined.buffer as ArrayBuffer, combined.byteOffset + px, px);
			dither = new Uint8ClampedArray(combined.buffer as ArrayBuffer, combined.byteOffset + px * 2, px);
			// Copy out of the WASM-owned buffer before transfer.
			ela = new Uint8ClampedArray(ela);
			fft = new Uint8ClampedArray(fft);
			dither = new Uint8ClampedArray(dither);
			const total = performance.now() - t0;
			timings = { elaMs: total / 3, fftMs: total / 3, ditherMs: total / 3, totalMs: total };
			const out: ForensicsWorkerOut = {
				id,
				type: 'result',
				elaMap: ela,
				fftMap: fft,
				ditherMask: dither,
				timings,
				engine: 'rust-wasm'
			};
			ctx.postMessage(out, [ela.buffer, fft.buffer, dither.buffer]);
			return;
		}

		// TypeScript fallback — identical math, still off the main thread.
		const px = width * height;
		ela = new Uint8ClampedArray(px);
		fft = new Uint8ClampedArray(px);
		dither = new Uint8ClampedArray(px);

		const tEla = performance.now();
		elaMapTs(rgba, width, height, elaQ, ela);
		const elaMs = performance.now() - tEla;

		const tFft = performance.now();
		fftMapTs(rgba, width, height, fftCutoff, fft);
		const fftMs = performance.now() - tFft;

		const tD = performance.now();
		ditherMaskTs(ela, width, height, dither);
		const ditherMs = performance.now() - tD;

		timings = { elaMs, fftMs, ditherMs, totalMs: performance.now() - t0 };
		const out: ForensicsWorkerOut = {
			id,
			type: 'result',
			elaMap: ela,
			fftMap: fft,
			ditherMask: dither,
			timings,
			engine: 'typescript-worker'
		};
		ctx.postMessage(out, [ela.buffer, fft.buffer, dither.buffer]);
	} catch (err) {
		const out: ForensicsWorkerOut = {
			id,
			type: 'error',
			message: err instanceof Error ? err.message : String(err)
		};
		ctx.postMessage(out);
	}
};

export {};
