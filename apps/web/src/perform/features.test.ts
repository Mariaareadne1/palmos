import { describe, expect, it } from "vitest";
import {
  AutoGain,
  bandEnergies,
  computeRms,
  OnsetDetector,
  Smoother,
  softKnee,
} from "./features";
import { applyModulation, SmootherBank } from "./modulation";
import type { ModRouting } from "@/types/scene";

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;

/**
 * Naive Hann-windowed DFT magnitudes (bins 0..fftSize/2) — slow but fine
 * for tests. The window kills spectral leakage from non-bin-aligned test
 * frequencies (an AnalyserNode applies a Blackman window similarly).
 */
function dftMagnitudes(samples: Float32Array): Float64Array {
  const n = samples.length;
  const bins = n / 2;
  const windowed = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * t) / (n - 1)));
    windowed[t] = samples[t] * w;
  }
  const out = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const phi = (-2 * Math.PI * k * t) / n;
      re += windowed[t] * Math.cos(phi);
      im += windowed[t] * Math.sin(phi);
    }
    out[k] = Math.sqrt(re * re + im * im) / (n / 2);
  }
  return out;
}

function sine(freq: number, amplitude = 1, n = FFT_SIZE): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  }
  return out;
}

describe("rms", () => {
  it("is ~a/√2 for a sine of amplitude a", () => {
    expect(computeRms(sine(440, 0.8))).toBeCloseTo(0.8 / Math.SQRT2, 2);
  });

  it("soft knee maps into 0–1 monotonically", () => {
    expect(softKnee(0)).toBe(0);
    expect(softKnee(0.3)).toBeGreaterThan(0.5);
    expect(softKnee(2)).toBeLessThanOrEqual(1);
    expect(softKnee(0.5)).toBeGreaterThan(softKnee(0.2));
  });
});

describe("band energies (synthetic buffers)", () => {
  it("a 100 Hz sine drives `low` toward 1 and leaves `high` near 0", () => {
    const mags = dftMagnitudes(sine(100));
    const bands = bandEnergies(mags, SAMPLE_RATE, FFT_SIZE);
    expect(bands.low).toBeGreaterThan(bands.high * 20);
    expect(bands.low).toBeGreaterThan(bands.mid * 20);

    // through auto-gain, low normalizes toward 1
    const gain = new AutoGain();
    const low = gain.process(bands.low, 16.7);
    const highGain = new AutoGain();
    const high = highGain.process(bands.high, 16.7);
    expect(low).toBeCloseTo(1, 5);
    // high's running max is its own tiny leakage; the raw energy is what
    // matters — near zero relative to low
    expect(bands.high).toBeLessThan(0.001);
    expect(high).toBeLessThanOrEqual(1);
  });

  it("a 5 kHz sine lands in `high`", () => {
    const bands = bandEnergies(dftMagnitudes(sine(5000)), SAMPLE_RATE, FFT_SIZE);
    expect(bands.high).toBeGreaterThan(bands.low * 20);
  });

  it("auto-gain decays with ~3 s half-life", () => {
    const gain = new AutoGain(3000);
    gain.process(1, 16.7); // running max = 1
    // 3 s later, a 0.5 input should read as ~1 (max decayed to 0.5)
    expect(gain.process(0.5, 3000)).toBeCloseTo(1, 2);
  });
});

describe("onset detector (amplitude step)", () => {
  it("a step in amplitude fires exactly one onset", () => {
    const det = new OnsetDetector();
    const quiet = dftMagnitudes(sine(200, 0.05));
    const loud = dftMagnitudes(sine(200, 1));

    let fires = 0;
    let prev = 0;
    let now = 0;
    const step = (mags: Float64Array) => {
      const v = det.process(mags, now);
      if (v === 1 && prev !== 1) fires++;
      prev = v;
      now += 16.7;
    };

    for (let i = 0; i < 30; i++) step(quiet); // settle the rolling window
    step(loud); // the step
    for (let i = 0; i < 30; i++) step(loud); // sustained loud — no re-fire

    expect(fires).toBe(1);
  });

  it("impulse decays exponentially (~150 ms half-life)", () => {
    const det = new OnsetDetector();
    const quiet = dftMagnitudes(sine(200, 0.05));
    const loud = dftMagnitudes(sine(200, 1));
    let now = 0;
    for (let i = 0; i < 30; i++) {
      det.process(quiet, now);
      now += 16.7;
    }
    const atFire = det.process(loud, now);
    expect(atFire).toBe(1);
    const later = det.process(loud, now + 150);
    expect(later).toBeGreaterThan(0.4);
    expect(later).toBeLessThan(0.6);
  });

  it("debounces within 100 ms", () => {
    const det = new OnsetDetector();
    const quiet = dftMagnitudes(sine(200, 0.05));
    const loud = dftMagnitudes(sine(200, 1));
    const louder = dftMagnitudes(sine(200, 2));
    let now = 0;
    for (let i = 0; i < 30; i++) {
      det.process(quiet, now);
      now += 16.7;
    }
    det.process(loud, now);
    // 50 ms later an even bigger flux must NOT re-fire to full 1
    const v = det.process(louder, now + 50);
    expect(v).toBeLessThan(1);
  });
});

describe("smoother", () => {
  it("smoothing=0 passes through instantly", () => {
    const s = new Smoother();
    expect(s.process(1, 0)).toBeCloseTo(1, 5);
  });

  it("higher smoothing responds slower", () => {
    const fast = new Smoother();
    const slow = new Smoother();
    let f = 0;
    let sl = 0;
    for (let i = 0; i < 5; i++) {
      f = fast.process(1, 0.2);
      sl = slow.process(1, 0.9);
    }
    expect(f).toBeGreaterThan(sl);
  });
});

describe("applyModulation scaling table", () => {
  const graph = {
    width: 800,
    height: 1000,
    postEffects: [],
    layers: [],
  };
  const features = { rms: 1, low: 1, mid: 1, high: 1, onset: 1 };

  const route = (target: ModRouting["target"], amount = 1): ModRouting => ({
    id: `r-${target}`,
    layerId: "L",
    target,
    source: "rms",
    amount,
    smoothing: 0, // instant for assertions
    invert: false,
    phaseOffset: 0,
    ratchet: false,
  });

  it("matches the per-target scaling at |amount| = 1", () => {
    const bank = new SmootherBank();
    const result = applyModulation(
      graph,
      features,
      [
        route("x"),
        route("y"),
        route("scale"),
        route("rotation"),
        route("opacity"),
        route("hue"),
        route("blur"),
      ],
      bank,
    );
    const o = result.transform.get("L")!;
    expect(o.dx).toBeCloseTo(0.15 * 800, 5);
    expect(o.dy).toBeCloseTo(0.15 * 1000, 5);
    expect(o.scale).toBeCloseTo(1.5, 5);
    expect(o.rotation).toBeCloseTo(45, 5);
    expect(o.opacity).toBeCloseTo(1, 5);
    expect(o.hue).toBeCloseTo(180, 5);
    expect(o.blur).toBeCloseTo(24, 5);
  });

  it("invert flips sign; blur clamps at 0", () => {
    const bank = new SmootherBank();
    const inverted: ModRouting = { ...route("x"), invert: true };
    const blurInv: ModRouting = { ...route("blur"), invert: true, id: "r-b2" };
    const result = applyModulation(graph, features, [inverted, blurInv], bank);
    const o = result.transform.get("L")!;
    expect(o.dx).toBeCloseTo(-0.15 * 800, 5);
    expect(o.blur).toBe(0);
  });

  it("offsets are ephemeral — repeated calls don't accumulate", () => {
    const bank = new SmootherBank();
    const r = [route("rotation")];
    applyModulation(graph, features, r, bank);
    const second = applyModulation(graph, features, r, bank);
    expect(second.transform.get("L")!.rotation).toBeCloseTo(45, 5);
  });

  it("master intensity scales all routings", () => {
    const bank = new SmootherBank();
    const result = applyModulation(graph, features, [route("x")], bank, 2);
    expect(result.transform.get("L")!.dx).toBeCloseTo(0.3 * 800, 5);
  });

  it("ratchet: value only ever increases across a falling feature", () => {
    const bank = new SmootherBank();
    const routing: ModRouting = {
      ...route("growthProgress"),
      smoothing: 0,
      ratchet: true,
    };
    const rising = applyModulation(graph, { ...features, rms: 0.8 }, [routing], bank);
    const first = rising.growth.get("L")!;
    const falling = applyModulation(graph, { ...features, rms: 0.1 }, [routing], bank);
    const second = falling.growth.get("L")!;
    expect(second).toBeGreaterThanOrEqual(first);
  });
});
