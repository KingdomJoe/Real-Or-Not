// src/lib/utils/audioWavEncoder.ts
// Converts any uploaded Video/Audio File or MediaStream chunk into 16kHz 16-bit Mono PCM WAV

const TARGET_SAMPLE_RATE = 16000;
const MAX_DURATION_SEC = 18; // Caps payload size to protect latency & credits

export interface WavSlicePayload {
	fullWavBase64: string;
	durationSec: number;
	slices: Array<{
		startSec: number;
		endSec: number;
		wavBase64: string;
	}>;
}

/**
 * Decodes any File/Blob (MP4, WebM, MOV, MP3, WAV) into 16kHz 16-bit Mono WAV
 * and produces 3-second rolling WAV chunks for Muse Voice Transcribe 1.0.
 */
export async function extract16kHzMonoWavFromBlob(
	blob: Blob,
	sliceWindowSec = 3
): Promise<WavSlicePayload | null> {
	try {
		const arrayBuffer = await blob.arrayBuffer();
		const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
		const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
		await audioCtx.close();

		const clampedDuration = Math.min(decodedBuffer.duration, MAX_DURATION_SEC);
		const targetLength = Math.floor(clampedDuration * TARGET_SAMPLE_RATE);
		if (targetLength <= 0) return null;

		const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
		const source = offlineCtx.createBufferSource();
		source.buffer = decodedBuffer;
		source.connect(offlineCtx.destination);
		source.start(0);

		const resampledBuffer = await offlineCtx.startRendering();
		const monoChannel = resampledBuffer.getChannelData(0);

		const fullWavBase64 = encodeFloat32To16BitWavBase64(monoChannel, TARGET_SAMPLE_RATE);

		const slices: Array<{ startSec: number; endSec: number; wavBase64: string }> = [];
		const samplesPerSlice = sliceWindowSec * TARGET_SAMPLE_RATE;

		for (let startSample = 0; startSample < monoChannel.length; startSample += samplesPerSlice) {
			const endSample = Math.min(monoChannel.length, startSample + samplesPerSlice);
			if (endSample - startSample < TARGET_SAMPLE_RATE * 0.5) break; // Skip tiny tail < 0.5s
			const sliceSamples = monoChannel.subarray(startSample, endSample);
			slices.push({
				startSec: Math.round(startSample / TARGET_SAMPLE_RATE),
				endSec: Math.round(endSample / TARGET_SAMPLE_RATE),
				wavBase64: encodeFloat32To16BitWavBase64(sliceSamples, TARGET_SAMPLE_RATE)
			});
		}

		return {
			fullWavBase64,
			durationSec: Number(clampedDuration.toFixed(1)),
			slices
		};
	} catch {
		// File has no audio track (e.g., silent MP4 or static image)
		return null;
	}
}

export interface LiveCaptureResult {
	/** 16kHz mono 16-bit PCM WAV, base64 (no data: prefix). */
	wavBase64: string;
	durationSec: number;
	/** Peak |sample| observed (0..1) — near-zero means digital silence. */
	peak: number;
}

/**
 * Capture raw PCM straight from a LIVE MediaStream (getDisplayMedia tab audio).
 * Never routes live audio through MediaRecorder + decodeAudioData (which fails
 * on live WebM chunks) — instead samples the stream in real time with the
 * WebAudio graph at 16kHz and encodes genuine PCM directly to WAV.
 */
export async function captureLiveStreamPcmWav(
	stream: MediaStream,
	durationMs = 3500
): Promise<LiveCaptureResult | null> {
	try {
		if (stream.getAudioTracks().length === 0) return null;
		const AudioCtor =
			window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		// Browser resamples the tab audio to 16kHz inside the graph.
		const audioCtx = new AudioCtor({ sampleRate: TARGET_SAMPLE_RATE });
		if (audioCtx.state === 'suspended') {
			await audioCtx.resume().catch(() => undefined);
		}
		const source = audioCtx.createMediaStreamSource(stream);
		// ScriptProcessor is legacy but universally available, including contexts
		// where AudioWorklet modules are blocked. Buffer size 4096 @16kHz ≈ 256ms.
		const processor = audioCtx.createScriptProcessor(4096, 1, 1);
		const chunks: Float32Array[] = [];
		let peak = 0;
		processor.onaudioprocess = (e) => {
			const input = e.inputBuffer.getChannelData(0);
			const copy = new Float32Array(input.length);
			copy.set(input);
			for (let i = 0; i < copy.length; i += 7) {
				const a = Math.abs(copy[i]);
				if (a > peak) peak = a;
			}
			chunks.push(copy);
		};
		// The processor only runs while connected; gain 0 keeps it silent.
		const mute = audioCtx.createGain();
		mute.gain.value = 0;
		source.connect(processor);
		processor.connect(mute);
		mute.connect(audioCtx.destination);
		await new Promise((r) => setTimeout(r, durationMs));
		try {
			source.disconnect();
			processor.disconnect();
			mute.disconnect();
		} catch {
			/* already torn down */
		}
		await audioCtx.close().catch(() => undefined);
		const totalLen = chunks.reduce((n, c) => n + c.length, 0);
		if (totalLen < TARGET_SAMPLE_RATE * 0.5) return null; // <0.5s — honestly empty
		const pcm = new Float32Array(totalLen);
		let off = 0;
		for (const c of chunks) {
			pcm.set(c, off);
			off += c.length;
		}
		return {
			wavBase64: encodeFloat32To16BitWavBase64(pcm, TARGET_SAMPLE_RATE),
			durationSec: pcm.length / TARGET_SAMPLE_RATE,
			peak
		};
	} catch {
		return null;
	}
}

/** Raw PCM volume tap for the avatar's reactive mouth (returns an RMS reader). */
export function createStreamVolumeTap(stream: MediaStream): { getLevel: () => number; dispose: () => void } {
	try {
		const AudioCtor =
			window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		const audioCtx = new AudioCtor();
		const source = audioCtx.createMediaStreamSource(stream);
		const analyser = audioCtx.createAnalyser();
		analyser.fftSize = 512;
		analyser.smoothingTimeConstant = 0.55;
		source.connect(analyser);
		const buf = new Uint8Array(analyser.fftSize);
		return {
			getLevel: () => {
				try {
					analyser.getByteTimeDomainData(buf);
					let sum = 0;
					for (let i = 0; i < buf.length; i++) {
						const v = (buf[i] - 128) / 128;
						sum += v * v;
					}
					return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
				} catch {
					return 0;
				}
			},
			dispose: () => {
				try {
					source.disconnect();
					analyser.disconnect();
				} catch {
					/* noop */
				}
				void audioCtx.close().catch(() => undefined);
			}
		};
	} catch {
		return { getLevel: () => 0, dispose: () => undefined };
	}
}

function encodeFloat32To16BitWavBase64(samples: Float32Array, sampleRate: number): string {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);

	writeAscii(view, 0, 'RIFF');
	view.setUint32(4, 36 + samples.length * 2, true);
	writeAscii(view, 8, 'WAVE');
	writeAscii(view, 12, 'fmt ');
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM format = 1
	view.setUint16(22, 1, true); // Mono = 1 channel
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // Byte rate (sampleRate * 1 channel * 2 bytes)
	view.setUint16(32, 2, true); // Block align
	view.setUint16(34, 16, true); // 16-bit
	writeAscii(view, 36, 'data');
	view.setUint32(40, samples.length * 2, true);

	let offset = 44;
	for (let i = 0; i < samples.length; i++, offset += 2) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	}

	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function writeAscii(view: DataView, offset: number, text: string) {
	for (let i = 0; i < text.length; i++) {
		view.setUint8(offset + i, text.charCodeAt(i));
	}
}
