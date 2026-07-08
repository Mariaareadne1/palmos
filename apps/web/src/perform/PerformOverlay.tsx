"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Container } from "pixi.js";
import { useAppStore } from "@/state/store";
import { getAudioEngine } from "@/perform/audio";
import {
  applyModulation,
  SmootherBank,
  type ReactivityFocus,
} from "@/perform/modulation";
import { PerformRenderer } from "@/perform/renderer";
import { FeedbackPass } from "@/perform/FeedbackPass";
import { gpuContext } from "@/effects/GpuContext";
import AudioSourcePicker from "@/perform/AudioSourcePicker";

const HUD_HIDE_MS = 2000;
const FOCUSES: ReactivityFocus[] = ["calm", "pulse", "chaos", "strobe"];

/**
 * Perform mode: fullscreen renderer over the SAME scene graph the editor
 * mutates — offsets are ephemeral, the graph is never written (SPEC.md §2).
 * Uses the single shared WebGL context (SPEC2 §12.5). Esc → edit, F →
 * fullscreen, D → fps.
 */
export default function PerformOverlay() {
  const scene = useAppStore((s) => s.scene);
  const setMode = useAppStore((s) => s.setMode);

  const containerRef = useRef<HTMLDivElement>(null);
  const intensityRef = useRef(1);
  const focusRef = useRef<ReactivityFocus>("pulse");
  const [intensity, setIntensity] = useState(1);
  const [focus, setFocus] = useState<ReactivityFocus>("pulse");
  const [hudVisible, setHudVisible] = useState(true);
  const [showFps, setShowFps] = useState(false);
  const [fps, setFps] = useState(0);
  const [gpuNotice, setGpuNotice] = useState<string | null>(null);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: PerformRenderer | null = null;
    let feedback: FeedbackPass | null = null;
    let rafId: number | null = null;
    let stage: Container | null = null;
    const bank = new SmootherBank();
    const engine = getAudioEngine();
    const startMs = performance.now();

    const feedbackEffect = scene.postEffects.find(
      (e) => e.kind === "feedback" && e.enabled,
    );

    const stopLoop = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    };

    let offContextLost: (() => void) | null = null;
    let offContextRestored: (() => void) | null = null;

    void (async () => {
      const app = await gpuContext.init();
      if (disposed) return;
      if (!app || !gpuContext.available) {
        setGpuNotice(
          "webgl2 unavailable — perform mode needs it (bake effects still work in edit)",
        );
        return;
      }

      const canvas = gpuContext.canvas!;
      host.appendChild(canvas);
      const resize = () => {
        app.renderer.resize(host.clientWidth, host.clientHeight);
      };
      resize();
      window.addEventListener("resize", resize);

      stage = new Container();
      renderer = new PerformRenderer(scene);
      stage.addChild(renderer.root);
      if (feedbackEffect) feedback = new FeedbackPass(app, feedbackEffect);

      let last = performance.now();
      let frames = 0;
      let acc = 0;
      const loop = () => {
        if (disposed || !renderer || !stage) return;
        if (gpuContext.contextLost) {
          rafId = requestAnimationFrame(loop);
          return;
        }
        const now = performance.now();
        acc += now - last;
        last = now;
        frames++;
        if (acc >= 500) {
          setFps(Math.round((frames * 1000) / acc));
          frames = 0;
          acc = 0;
        }
        const timeSec = (now - startMs) / 1000;
        renderer.layout(app.renderer.width, app.renderer.height);
        const mod = applyModulation(
          scene,
          engine.frame,
          scene.routings,
          bank,
          intensityRef.current,
          focusRef.current,
        );
        renderer.applyFrame(mod, timeSec, engine.frame);
        if (feedback && feedbackEffect) {
          const fo: Record<string, number> = {};
          for (const key of Object.keys(mod.post)) {
            const [id, param] = key.split(":");
            if (id === feedbackEffect.id) fo[param] = mod.post[key];
          }
          feedback.render(stage, fo, timeSec);
        } else {
          app.renderer.render({ container: stage });
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);

      // context loss/restore (SPEC2 §12.5)
      offContextLost = gpuContext.onContextLost(() => {
        setGpuNotice("graphics context lost, recovering…");
        stopLoop();
      });
      offContextRestored = gpuContext.onContextRestored(() => {
        setGpuNotice(null);
        renderer?.destroy();
        feedback?.dispose();
        renderer = new PerformRenderer(scene);
        stage = new Container();
        stage.addChild(renderer.root);
        feedback = feedbackEffect ? new FeedbackPass(app, feedbackEffect) : null;
        last = performance.now();
        rafId = requestAnimationFrame(loop);
      });

      // clean detach
      offContextLost = ((prev) => () => {
        prev?.();
        window.removeEventListener("resize", resize);
      })(offContextLost);
    })();

    return () => {
      disposed = true;
      stopLoop();
      offContextLost?.();
      offContextRestored?.();
      renderer?.destroy();
      feedback?.dispose();
      // return the shared canvas to the offscreen pool (SPEC2 §12.5:
      // one context for the whole app — never destroy it here)
      const canvas = gpuContext.canvas;
      if (canvas && canvas.parentElement === host) {
        host.removeChild(canvas);
      }
      gpuContext.renderer?.resize(1, 1);
    };
  }, [scene]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("edit");
      else if (e.key.toLowerCase() === "f") {
        const host = containerRef.current;
        if (!host) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void host.requestFullscreen();
      } else if (e.key.toLowerCase() === "d") setShowFps((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  const pokeHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHudVisible(false), HUD_HIDE_MS);
  }, []);

  useEffect(() => {
    pokeHud();
    return () => {
      if (hudTimer.current) clearTimeout(hudTimer.current);
    };
  }, [pokeHud]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-ink"
      onMouseMove={pokeHud}
      style={{ cursor: hudVisible ? "default" : "none" }}
    >
      {gpuNotice && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 border border-paper/40 bg-ink/90 px-3 py-1 text-xs text-paper">
          {gpuNotice}
        </div>
      )}
      {showFps && (
        <div className="absolute right-3 top-3 z-10 border border-paper/40 px-2 py-0.5 font-mono text-xs text-paper">
          {fps} fps
        </div>
      )}
      <div
        className={`absolute bottom-0 left-0 right-0 z-10 flex items-center gap-4 border-t border-paper/20 bg-ink/90 px-4 py-3 transition-opacity duration-300 ${
          hudVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          onClick={() => setMode("edit")}
          className="border border-paper/40 px-3 py-1 text-xs text-paper hover:bg-paper hover:text-ink"
        >
          ← edit (esc)
        </button>
        <div className="[&_button]:border-paper/40 [&_button]:text-paper [&_span]:text-paper/60 text-paper">
          <AudioSourcePicker />
        </div>
        {/* reactivity focus — the single most-used live control (SPEC2 §9.3) */}
        <div className="flex items-center border border-paper/40">
          {FOCUSES.map((f) => (
            <button
              key={f}
              onClick={() => {
                focusRef.current = f;
                setFocus(f);
              }}
              className={`px-2 py-1 text-xs ${
                focus === f ? "bg-paper text-ink" : "text-paper"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-paper/60">
          intensity
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={intensity}
            className="w-32"
            onChange={(e) => {
              const v = Number(e.target.value);
              intensityRef.current = v;
              setIntensity(v);
            }}
          />
          <span className="w-8 text-paper">{intensity.toFixed(2)}</span>
        </label>
        <span className="text-xs text-paper/40">f · d</span>
      </div>
    </div>
  );
}
