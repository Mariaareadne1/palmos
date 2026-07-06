import type { AudioFeature } from "@/types/scene";

/**
 * Pure DSP for the audio feature bus (SPEC §5 step 4). No WebAudio in
 * here — everything takes plain arrays so it is unit-testable with
 * synthetic buffers.
 */

export type FeatureFrame = Record<AudioFeature, number>;

export const ZERO_FRAME: FeatureFrame = {
  rms: 0,
  low: 0,
  mid: 0,
  high: 0,
  onset: 0,
};

/** Root-mean-square of time-domain samples (raw, unmapped). */
export function computeRms(time: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
  return Math.sqrt(sum / time.length);
}

/** Soft knee: compresses raw RMS (~0–0.7 for typical audio) into 0–1. */
export function softKnee(x: number): number {
  return Math.tanh(x * 6);
}

export interface BandEnergies {
  low: number;
  mid: number;
  high: number;
}

/**
 * Mean magnitude of FFT bins in <250 Hz / 250–2000 Hz / >2000 Hz.
 * `magnitudes[i]` covers frequency i * sampleRate / fftSize.
 */
export function bandEnergies(
  magnitudes: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
): BandEnergies {
  const hzPerBin = sampleRate / fftSize;
  let lowSum = 0;
  let lowN = 0;
  let midSum = 0;
  let midN = 0;
  let highSum = 0;
  let highN = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const hz = i * hzPerBin;
    const m = magnitudes[i];
    if (hz < 250) {
      lowSum += m;
      lowN++;
    } else if (hz < 2000) {
      midSum += m;
      midN++;
    } else {
      highSum += m;
      highN++;
    }
  }
  return {
    low: lowN ? lowSum / lowN : 0,
    mid: midN ? midSum / midN : 0,
    high: highN ? highSum / highN : 0,
  };
}

/**
 * Normalizes against a slow-decaying running max (half-life ~3 s) so the
 * visuals stay lively at any input level.
 */
export class AutoGain {
  private runningMax = 0;
  constructor(private halfLifeMs = 3000) {}

  process(x: number, dtMs: number): number {
    const decay = Math.pow(0.5, dtMs / this.halfLifeMs);
    this.runningMax = Math.max(x, this.runningMax * decay);
    if (this.runningMax < 1e-6) return 0;
    return Math.min(1, x / this.runningMax);
  }

  reset(): void {
    this.runningMax = 0;
  }
}

/**
 * Onset via spectral flux: half-wave-rectified frame-to-frame magnitude
 * increase, summed. When flux exceeds mean + 1.5σ of a 43-frame rolling
 * window, fire an impulse that jumps to 1 and decays exponentially
 * (~150 ms half-life). Debounce 100 ms.
 */
export class OnsetDetector {
  private prev: Float64Array | null = null;
  private window: number[] = [];
  private impulse = 0;
  private lastFireMs = -Infinity;
  private lastNowMs: number | null = null;

  constructor(
    private windowSize = 43,
    private thresholdSigma = 1.5,
    private halfLifeMs = 150,
    private debounceMs = 100,
  ) {}

  process(magnitudes: ArrayLike<number>, nowMs: number): number {
    // decay the running impulse
    if (this.lastNowMs !== null) {
      const dt = Math.max(0, nowMs - this.lastNowMs);
      this.impulse *= Math.pow(0.5, dt / this.halfLifeMs);
    }
    this.lastNowMs = nowMs;

    // spectral flux vs previous frame
    let flux = 0;
    if (this.prev) {
      for (let i = 0; i < magnitudes.length; i++) {
        const d = magnitudes[i] - this.prev[i];
        if (d > 0) flux += d;
      }
    }
    if (!this.prev || this.prev.length !== magnitudes.length) {
      this.prev = new Float64Array(magnitudes.length);
    }
    for (let i = 0; i < magnitudes.length; i++) this.prev[i] = magnitudes[i];

    // rolling stats (computed BEFORE pushing the current flux)
    if (this.window.length >= 4) {
      const mean =
        this.window.reduce((a, b) => a + b, 0) / this.window.length;
      const variance =
        this.window.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
        this.window.length;
      const threshold = mean + this.thresholdSigma * Math.sqrt(variance);
      if (
        flux > threshold &&
        nowMs - this.lastFireMs >= this.debounceMs
      ) {
        this.impulse = 1;
        this.lastFireMs = nowMs;
      }
    }
    this.window.push(flux);
    if (this.window.length > this.windowSize) this.window.shift();

    return this.impulse;
  }

  reset(): void {
    this.prev = null;
    this.window = [];
    this.impulse = 0;
    this.lastFireMs = -Infinity;
    this.lastNowMs = null;
  }
}

/** Per-routing EMA: y += (x − y) · (1 − smoothing · 0.95). */
export class Smoother {
  private y = 0;
  process(x: number, smoothing: number): number {
    this.y += (x - this.y) * (1 - smoothing * 0.95);
    return this.y;
  }
  reset(): void {
    this.y = 0;
  }
}
