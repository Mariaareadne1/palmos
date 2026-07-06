"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Application } from "pixi.js";
import { useAppStore } from "@/state/store";
import { getAudioEngine } from "@/perform/audio";
import { applyModulation, SmootherBank } from "@/perform/modulation";
import { PerformRenderer } from "@/perform/renderer";
import AudioSourcePicker from "@/perform/AudioSourcePicker";

const HUD_HIDE_MS = 2000;

/**
 * Perform mode: fullscreen PixiJS renderer over the SAME scene graph the
 * editor mutates — offsets are ephemeral, the graph is never written
 * (SPEC §2). Esc returns to edit with the graph unchanged; F toggles
 * browser fullscreen; D toggles the fps readout.
 */
export default function PerformOverlay() {
  const scene = useAppStore((s) => s.scene);
  const setMode = useAppStore((s) => s.setMode);

  const containerRef = useRef<HTMLDivElement>(null);
  const intensityRef = useRef(1);
  const [intensity, setIntensity] = useState(1);
  const [hudVisible, setHudVisible] = useState(true);
  const [showFps, setShowFps] = useState(false);
  const [fps, setFps] = useState(0);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- pixi app lifecycle: build once per scene identity ---
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let disposed = false;
    let initialized = false;
    let app: Application | null = null;
    let renderer: PerformRenderer | null = null;
    const bank = new SmootherBank();
    const engine = getAudioEngine();

    void (async () => {
      const candidate = new Application();
      await candidate.init({
        background: "#0a0a0a",
        resizeTo: host,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        autoDensity: true,
      });
      // React dev double-invokes effects: if cleanup already ran, tear
      // down the now-initialized app ourselves.
      if (disposed) {
        candidate.destroy(true, { children: true });
        return;
      }
      app = candidate;
      initialized = true;
      host.appendChild(app.canvas);
      renderer = new PerformRenderer(app, scene);

      let fpsAccum = 0;
      app.ticker.add(() => {
        if (!renderer || !app) return;
        renderer.layout(app.screen.width, app.screen.height);
        const offsets = applyModulation(
          scene,
          engine.frame,
          scene.routings,
          bank,
          intensityRef.current,
        );
        renderer.applyOffsets(offsets);
        fpsAccum++;
        if (fpsAccum >= 15) {
          fpsAccum = 0;
          setFps(Math.round(app.ticker.FPS));
        }
      });
    })();

    return () => {
      disposed = true;
      renderer?.destroy();
      // destroying a mid-init Application crashes its plugins — the
      // async branch above handles that case instead
      if (app && initialized) {
        app.destroy(true, { children: true });
      }
    };
  }, [scene]);

  // --- keys: Esc back to edit, F fullscreen, D fps readout ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMode("edit");
      } else if (e.key.toLowerCase() === "f") {
        const host = containerRef.current;
        if (!host) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void host.requestFullscreen();
      } else if (e.key.toLowerCase() === "d") {
        setShowFps((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  // --- HUD auto-hide after 2 s of no mouse ---
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
        <label className="ml-auto flex items-center gap-2 text-xs text-paper/60">
          intensity
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={intensity}
            className="w-36"
            onChange={(e) => {
              const v = Number(e.target.value);
              intensityRef.current = v;
              setIntensity(v);
            }}
          />
          <span className="w-8 text-paper">{intensity.toFixed(2)}</span>
        </label>
        <span className="text-xs text-paper/40">f fullscreen · d fps</span>
      </div>
    </div>
  );
}
