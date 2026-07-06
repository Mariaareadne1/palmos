"use client";

import {
  AutoGain,
  bandEnergies,
  computeRms,
  OnsetDetector,
  softKnee,
  ZERO_FRAME,
  type FeatureFrame,
} from "@/perform/features";

export type AudioSourceKind = "mic" | "file" | "tab";

const FFT_SIZE = 2048;

/**
 * WebAudio wiring around the pure DSP in features.ts. Owns an internal
 * rAF loop while a source is active, so both the motion-tab meters and
 * the perform renderer can just read `frame`.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: AudioNode | null = null;
  private stream: MediaStream | null = null;

  // file playback
  private buffer: AudioBuffer | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private pausedAt = 0;
  private _playing = false;
  private _loop = true;

  private timeData = new Float32Array(FFT_SIZE);
  private freqData = new Uint8Array(FFT_SIZE / 2);
  private magnitudes = new Float64Array(FFT_SIZE / 2);

  private lowGain = new AutoGain();
  private midGain = new AutoGain();
  private highGain = new AutoGain();
  private onset = new OnsetDetector();
  private lastFrameMs: number | null = null;
  private rafId: number | null = null;

  /** Most recent feature frame — read by meters and the perform loop. */
  frame: FeatureFrame = { ...ZERO_FRAME };
  sourceKind: AudioSourceKind | null = null;
  fileName: string | null = null;

  static supportsTabAudio(): boolean {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      "getDisplayMedia" in navigator.mediaDevices
    );
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0; // we do our own smoothing
    }
    void this.ctx.resume();
    return this.ctx;
  }

  private attach(node: AudioNode, toDestination: boolean): void {
    this.detachSource();
    this.sourceNode = node;
    node.connect(this.analyser!);
    if (toDestination) node.connect(this.ctx!.destination);
    this.startLoop();
  }

  private detachSource(): void {
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
      } catch {
        // already stopped
      }
      this.bufferSource = null;
    }
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this._playing = false;
  }

  async useMic(): Promise<void> {
    const ctx = this.ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // mic never routes to speakers (feedback)
    this.attach(ctx.createMediaStreamSource(stream), false);
    this.stream = stream;
    this.sourceKind = "mic";
    this.fileName = null;
    this.resetAnalysis();
  }

  /** Tab/system audio via screen share — Chrome-family only. */
  async useTab(): Promise<void> {
    const ctx = this.ensureContext();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // required by the API; we only use the audio track
      audio: true,
    });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("no audio track — share a tab and tick 'share audio'");
    }
    // the source tab keeps playing audibly; analyser only
    this.attach(ctx.createMediaStreamSource(stream), false);
    this.stream = stream;
    this.sourceKind = "tab";
    this.fileName = null;
    this.resetAnalysis();
  }

  async useFile(file: File): Promise<void> {
    const ctx = this.ensureContext();
    const bytes = await file.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(bytes);
    this.detachSource();
    this.sourceKind = "file";
    this.fileName = file.name;
    this.pausedAt = 0;
    this.resetAnalysis();
    this.play();
  }

  get playing(): boolean {
    return this._playing;
  }

  get loop(): boolean {
    return this._loop;
  }

  setLoop(loop: boolean): void {
    this._loop = loop;
    if (this.bufferSource) this.bufferSource.loop = loop;
  }

  play(): void {
    if (this.sourceKind !== "file" || !this.buffer || this._playing) return;
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this._loop;
    src.connect(this.analyser!);
    src.connect(ctx.destination);
    const offset = this.pausedAt % this.buffer.duration;
    src.start(0, offset);
    this.startedAt = ctx.currentTime - offset;
    src.onended = () => {
      if (!this._loop && this.bufferSource === src) {
        this._playing = false;
        this.pausedAt = 0;
      }
    };
    this.bufferSource = src;
    this.sourceNode = src;
    this._playing = true;
    this.startLoop();
  }

  pause(): void {
    if (this.sourceKind !== "file" || !this._playing || !this.ctx) return;
    this.pausedAt = this.ctx.currentTime - this.startedAt;
    if (this.bufferSource) {
      this.bufferSource.onended = null;
      try {
        this.bufferSource.stop();
      } catch {
        // already stopped
      }
      this.bufferSource = null;
    }
    this._playing = false;
  }

  private resetAnalysis(): void {
    this.lowGain.reset();
    this.midGain.reset();
    this.highGain.reset();
    this.onset.reset();
    this.lastFrameMs = null;
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this.computeFrame(performance.now());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private computeFrame(nowMs: number): void {
    if (!this.analyser) return;
    const dt =
      this.lastFrameMs === null ? 16.7 : Math.max(1, nowMs - this.lastFrameMs);
    this.lastFrameMs = nowMs;

    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);
    for (let i = 0; i < this.freqData.length; i++) {
      this.magnitudes[i] = this.freqData[i] / 255;
    }

    const bands = bandEnergies(
      this.magnitudes,
      this.ctx?.sampleRate ?? 48000,
      FFT_SIZE,
    );
    this.frame = {
      rms: softKnee(computeRms(this.timeData)),
      low: this.lowGain.process(bands.low, dt),
      mid: this.midGain.process(bands.mid, dt),
      high: this.highGain.process(bands.high, dt),
      onset: this.onset.process(this.magnitudes, nowMs),
    };
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.detachSource();
    this.buffer = null;
    this.sourceKind = null;
    this.fileName = null;
    this.frame = { ...ZERO_FRAME };
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }
}

// ---- shared instance (audio state survives edit⇄perform toggles) ----

let engine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}
