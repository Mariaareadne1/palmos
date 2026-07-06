"use client";

import { useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import type { AudioFeature, Layer, ModRouting, ModTarget } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { addRouting, patchRouting, removeRouting } from "@/state/commands";
import { getAudioEngine } from "@/perform/audio";
import AudioSourcePicker from "@/perform/AudioSourcePicker";

const SOURCES: AudioFeature[] = ["rms", "low", "mid", "high", "onset"];
const TARGETS: ModTarget[] = [
  "x",
  "y",
  "scale",
  "rotation",
  "opacity",
  "hue",
  "blur",
];

/** Tiny live meter for one feature — canvas-drawn at 30 fps. */
function FeatureMeter({ source }: { source: AudioFeature }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const engine = getAudioEngine();
    const timer = setInterval(() => {
      const v = engine.frame[source] ?? 0;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = "rgba(10,10,10,0.14)";
      g.fillRect(0, canvas.height / 2, canvas.width, 1);
      g.fillStyle = "#ff5c1f";
      g.fillRect(0, 0, v * canvas.width, canvas.height);
    }, 33);
    return () => clearInterval(timer);
  }, [source]);
  return <canvas ref={ref} width={28} height={6} className="shrink-0" />;
}

function RoutingRow({ routing }: { routing: ModRouting }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const patch = (p: Partial<ModRouting>) =>
    dispatch(patchRouting(routing.id, p));

  return (
    <div className="flex flex-col gap-1.5 border border-hairline-soft p-2">
      <div className="flex items-center gap-1.5">
        <FeatureMeter source={routing.source} />
        <select
          className="field w-16"
          value={routing.source}
          onChange={(e) => patch({ source: e.target.value as AudioFeature })}
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-faint">→</span>
        <select
          className="field w-20"
          value={routing.target}
          onChange={(e) => patch({ target: e.target.value as ModTarget })}
        >
          {TARGETS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          title="remove"
          className="ml-auto px-1 text-xs text-ink-faint hover:text-accent"
          onClick={() => dispatch(removeRouting(routing.id))}
        >
          ×
        </button>
      </div>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-ink-faint">amount</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={routing.amount}
          className="flex-1"
          onChange={(e) => patch({ amount: Number(e.target.value) })}
        />
        <span className="w-9 text-right text-xs">
          {routing.amount.toFixed(2)}
        </span>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-ink-faint">smooth</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={routing.smoothing}
          className="flex-1"
          onChange={(e) => patch({ smoothing: Number(e.target.value) })}
        />
        <span className="w-9 text-right text-xs">
          {routing.smoothing.toFixed(2)}
        </span>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-ink-faint">invert</span>
        <button
          className={`h-4 w-4 border ${
            routing.invert ? "border-ink bg-ink" : "border-hairline"
          }`}
          onClick={() => patch({ invert: !routing.invert })}
          aria-pressed={routing.invert}
        />
      </label>
    </div>
  );
}

/**
 * The inspector `motion` tab: audio routings for the selected layer.
 * Routings live in SceneGraph.routings so they persist with the file.
 */
export default function MotionTab({ layer }: { layer: Layer }) {
  const routings = useAppStore((s) => s.scene.routings);
  const dispatch = useAppStore((s) => s.dispatch);
  const mine = routings.filter((r) => r.layerId === layer.id);

  return (
    <div className="flex flex-col gap-3">
      <AudioSourcePicker />
      <div className="border-t border-hairline-soft pt-3">
        <div className="mb-2 text-xs text-ink-faint">
          {layer.name} — {mine.length || "no"} routing{mine.length === 1 ? "" : "s"}
        </div>
        <div className="flex flex-col gap-2">
          {mine.map((r) => (
            <RoutingRow key={r.id} routing={r} />
          ))}
        </div>
        <button
          className="mt-2 w-full border border-hairline px-3 py-1 text-xs hover:bg-ink hover:text-paper"
          onClick={() =>
            dispatch(
              addRouting({
                id: nanoid(),
                layerId: layer.id,
                target: "scale",
                source: "rms",
                amount: 0.5,
                smoothing: 0.5,
                invert: false,
              }),
            )
          }
        >
          + add motion
        </button>
      </div>
    </div>
  );
}
