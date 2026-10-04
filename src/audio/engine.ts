/**
 * Synthesized engine audio (design doc §14.10: "gesture-gated start; zero bytes added").
 *
 * The engine sound is generated entirely by the Web Audio API at runtime — no
 * audio files, no network requests, no dependencies beyond the DOM types.
 *
 * Graph, built once on the first `start()` — 12 nodes, 12 connections:
 *
 *   sawtooth osc (fundamental 1x) -> mix gain 0.60 -+
 *   square   osc (0.5x)           -> mix gain 0.25 -+-o waveshaper -> lowpass -> master -> destination
 *   sawtooth osc (2x)             -> mix gain 0.18 -+   (drive)      (700..2400 Hz)
 *   noise buffer (looped 2 s) -> highpass (1.8..3.9 kHz) -> air gain (0..0.08) -> master
 *
 * `setSpeed()` is the per-frame entry point: it only writes existing
 * `AudioParam`s via `setTargetAtTime` (indexed loops, no object construction).
 *
 * Gesture gating: no `AudioContext` is created at import time or before `start()`.
 * Browsers keep a pre-gesture context suspended and refuse to resume it (reject or
 * pending promise); the master gain is never raised until a resume settles, so
 * nothing becomes audible before a real user gesture triggers `start()`. If
 * `window.AudioContext` is unavailable every method is a silent no-op.
 */

/** Reference top speed (m/s) of the mapping; higher speeds are clamped. */
const SPEED_TOP_MS = 30;

/** Pitch mapping: f(s) = PITCH_BASE_HZ + PITCH_PER_MS * s -> 30 / 70 / 150 Hz at 0 / 10 / 30 m/s. */
const PITCH_BASE_HZ = 30;
const PITCH_PER_MS = 4;

/** Loudness mapping: level(s) = LEVEL_IDLE + (LEVEL_FULL - LEVEL_IDLE) * s / 30. */
const LEVEL_IDLE = 0.3;
const LEVEL_FULL = 1;

/** Lowpass (body of the engine) mapping: 700 Hz at rest -> 2400 Hz at top speed. */
const LOWPASS_IDLE_HZ = 700;
const LOWPASS_FULL_HZ = 2400;
const LOWPASS_Q = 0.9;

/** Air/tyre whine: highpassed looped noise, silent at standstill. */
const AIR_FULL_GAIN = 0.08;
const AIR_HIGHPASS_IDLE_HZ = 1800;
const AIR_HIGHPASS_PER_MS = 70;
const AIR_HIGHPASS_Q = 0.7;

/** Drive curve y = ((1 + k) * x) / (1 + k * |x|), sampled over [-1, 1]. */
const DRIVE_K = 3;
const DRIVE_SAMPLES = 1024;

/** Length in seconds of the looping white-noise buffer. */
const NOISE_SECONDS = 2;

/** Output level reached while running, and the transition time constants (s). */
const MASTER_LEVEL = 0.5;
const MASTER_TAU = 0.05;
const SMOOTH_TAU = 0.05;

interface LayerSpec {
	readonly type: OscillatorType;
	/** Frequency multiple of the engine fundamental. */
	readonly ratio: number;
	/** Contribution to the pre-drive mix. */
	readonly mix: number;
}

/** Three partials: dominant rumble, sub thump, metallic top end. */
const LAYERS: readonly LayerSpec[] = [
	{ type: 'sawtooth', ratio: 1, mix: 0.6 },
	{ type: 'square', ratio: 0.5, mix: 0.25 },
	{ type: 'sawtooth', ratio: 2, mix: 0.18 },
];

export interface EngineAudio {
	/**
	 * Creates/resumes the `AudioContext` and fades the engine in. Call this from a
	 * user gesture. Safe (silent no-op) before a gesture or without Web Audio, and
	 * safe to call repeatedly.
	 */
	start(): void;
	/** Fades the engine out; the graph stays alive so a later `start()` resumes it. */
	stop(): void;
	/**
	 * Per-frame speed input in m/s (clamped to 0..30; negative/NaN treated as 0).
	 * Drives pitch, loudness, lowpass cutoff and air-noise level. Allocates nothing.
	 */
	setSpeed(metersPerSecond: number): void;
	/**
	 * Stops the sources, disconnects every node and closes the context (immediate
	 * cut; call `stop()` first if a fade is wanted). Idempotent; all methods become
	 * no-ops afterwards.
	 */
	dispose(): void;
}

interface LayerVoice {
	readonly osc: OscillatorNode;
	readonly gain: GainNode;
	readonly spec: LayerSpec;
}

/** Live node graph; created once per successful `start()` and released by `dispose()`. */
interface Voice {
	readonly ctx: AudioContext;
	readonly master: GainNode;
	readonly shaper: WaveShaperNode;
	readonly lowpass: BiquadFilterNode;
	readonly layers: readonly LayerVoice[];
	readonly noise: AudioBufferSourceNode;
	readonly noiseFilter: BiquadFilterNode;
	readonly noiseGain: GainNode;
}

type AudioContextCtor = new () => AudioContext;

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** `window.AudioContext` or `null` — the single availability check of the module. */
function audioContextConstructor(): AudioContextCtor | null {
	if (typeof window === 'undefined') return null;
	const ctor = window.AudioContext as AudioContextCtor | undefined;
	return typeof ctor === 'function' ? ctor : null;
}

function makeDriveCurve(samples: number): Float32Array<ArrayBuffer> {
	const curve = new Float32Array(samples);
	for (let i = 0; i < samples; i += 1) {
		const x = (i / (samples - 1)) * 2 - 1;
		curve[i] = ((1 + DRIVE_K) * x) / (1 + DRIVE_K * Math.abs(x));
	}
	return curve;
}

/** Deterministic white noise (xorshift32), so the buffer is reproducible and dependency-free. */
function makeNoise(length: number): Float32Array<ArrayBuffer> {
	const data = new Float32Array(length);
	let seed = 0x1f123bb5;
	for (let i = 0; i < length; i += 1) {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		seed >>>= 0;
		data[i] = (seed / 0xffffffff) * 2 - 1;
	}
	return data;
}

/** Writes all speed-derived `AudioParam` targets of a live voice. No allocation. */
function applySpeed(voice: Voice, speed: number): void {
	const time = voice.ctx.currentTime;
	const s = speed < 0 ? 0 : speed > SPEED_TOP_MS ? SPEED_TOP_MS : speed;
	const fraction = clamp01(s / SPEED_TOP_MS);
	const pitch = PITCH_BASE_HZ + PITCH_PER_MS * s;
	const level = LEVEL_IDLE + (LEVEL_FULL - LEVEL_IDLE) * fraction;

	const layers = voice.layers;
	for (let i = 0; i < layers.length; i += 1) {
		const layer = layers[i];
		layer.osc.frequency.setTargetAtTime(pitch * layer.spec.ratio, time, SMOOTH_TAU);
		layer.gain.gain.setTargetAtTime(layer.spec.mix * level, time, SMOOTH_TAU);
	}
	voice.lowpass.frequency.setTargetAtTime(LOWPASS_IDLE_HZ + (LOWPASS_FULL_HZ - LOWPASS_IDLE_HZ) * fraction, time, SMOOTH_TAU);
	voice.noiseFilter.frequency.setTargetAtTime(AIR_HIGHPASS_IDLE_HZ + AIR_HIGHPASS_PER_MS * s, time, SMOOTH_TAU);
	voice.noiseGain.gain.setTargetAtTime(AIR_FULL_GAIN * fraction, time, SMOOTH_TAU);
}

export function createEngineAudio(): EngineAudio {
	let voice: Voice | null = null;
	let disposed = false;
	let speed = 0;

	function build(): Voice | null {
		const Ctor = audioContextConstructor();
		if (!Ctor) return null;
		try {
			const ctx = new Ctor();

			const master = ctx.createGain();
			master.gain.value = 0;

			const shaper = ctx.createWaveShaper();
			shaper.curve = makeDriveCurve(DRIVE_SAMPLES);
			shaper.oversample = '4x';

			const lowpass = ctx.createBiquadFilter();
			lowpass.type = 'lowpass';
			lowpass.frequency.value = LOWPASS_IDLE_HZ;
			lowpass.Q.value = LOWPASS_Q;

			const layers: LayerVoice[] = [];
			for (let i = 0; i < LAYERS.length; i += 1) {
				const spec = LAYERS[i];
				const osc = ctx.createOscillator();
				osc.type = spec.type;
				osc.frequency.value = PITCH_BASE_HZ * spec.ratio;
				const gain = ctx.createGain();
				gain.gain.value = 0;
				osc.connect(gain).connect(shaper);
				osc.start();
				layers.push({ osc, gain, spec });
			}
			shaper.connect(lowpass).connect(master).connect(ctx.destination);

			const noiseLength = Math.floor(NOISE_SECONDS * ctx.sampleRate);
			const noiseBuffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
			noiseBuffer.copyToChannel(makeNoise(noiseLength), 0);
			const noise = ctx.createBufferSource();
			noise.buffer = noiseBuffer;
			noise.loop = true;

			const noiseFilter = ctx.createBiquadFilter();
			noiseFilter.type = 'highpass';
			noiseFilter.frequency.value = AIR_HIGHPASS_IDLE_HZ;
			noiseFilter.Q.value = AIR_HIGHPASS_Q;

			const noiseGain = ctx.createGain();
			noiseGain.gain.value = 0;

			noise.connect(noiseFilter).connect(noiseGain).connect(master);
			noise.start();

			const built: Voice = { ctx, master, shaper, lowpass, layers, noise, noiseFilter, noiseGain };
			applySpeed(built, speed);
			return built;
		} catch {
			return null; // Web Audio construction blocked: stay a silent no-op.
		}
	}

	function engage(target: Voice): void {
		if (disposed || voice !== target) return;
		target.master.gain.setTargetAtTime(MASTER_LEVEL, target.ctx.currentTime, MASTER_TAU);
	}

	return {
		start(): void {
			if (disposed) return;
			const v = voice ?? (voice = build());
			if (!v) return;
			if (v.ctx.state === 'running') {
				engage(v);
				return;
			}
			try {
				void v.ctx.resume().then(
					() => {
						engage(v);
					},
					() => {
						/* No gesture yet: the context stays suspended and the master gain is
						   never raised, so the engine is silent until the next `start()`. */
					},
				);
			} catch {
				/* resume() threw synchronously: stay silent. */
			}
		},
		stop(): void {
			if (disposed || !voice) return;
			voice.master.gain.setTargetAtTime(0, voice.ctx.currentTime, MASTER_TAU);
		},
		setSpeed(metersPerSecond: number): void {
			if (disposed) return;
			speed = Number.isFinite(metersPerSecond) ? Math.max(0, metersPerSecond) : 0;
			if (!voice) return;
			applySpeed(voice, speed);
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			const v = voice;
			voice = null;
			if (!v) return;
			const time = v.ctx.currentTime;
			const layers = v.layers;
			for (let i = 0; i < layers.length; i += 1) {
				layers[i].osc.stop(time);
				layers[i].osc.disconnect();
				layers[i].gain.disconnect();
			}
			v.noise.stop(time);
			v.noise.disconnect();
			v.noiseFilter.disconnect();
			v.noiseGain.disconnect();
			v.shaper.disconnect();
			v.lowpass.disconnect();
			v.master.disconnect();
			try {
				void v.ctx.close().catch(() => {
					/* already closed */
				});
			} catch {
				/* already closed */
			}
		},
	};
}
