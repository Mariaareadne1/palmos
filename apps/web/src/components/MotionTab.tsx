"use client";

import { useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import type { AudioFeature, Layer, ModRouting } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { addRouting, batch, patchRouting, removeRouting } from "@/state/commands";
import { getAudioEngine } from "@/perform/audio";
import { modTargetsForLayer, targetLabel } from "@/effects/targets";
import { recipesFor, type MotionRecipe } from "@/audio/recipes";
import AudioSourcePicker from "@/perform/AudioSourcePicker";

const SOURCES: AudioFeature[] = ["rms", "low", "mid", "high", "onset"];

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

function RoutingRow({
  routing,
  layer,
}: {
  routing: ModRouting;
  layer: Layer;
}) {
  const postEffects = useAppStore((s) => s.scene.postEffects);
  const dispatch = useAppStore((s) => s.dispatch);
  const patch = (p: Partial<ModRouting>) =>
    dispatch(patchRouting(routing.id, p));
  const groups = modTargetsForLayer(layer, postEffects);

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
          className="field flex-1"
          value={routing.target}
          onChange={(e) => patch({ target: e.target.value })}
        >
          {/* stored target may reference a since-deleted effect */}
          {!groups.some((g) => g.options.some((o) => o.value === routing.target)) && (
            <option value={routing.target}>{targetLabel(routing.target)}</option>
          )}
          {groups.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          title="remove"
          className="px-1 text-xs text-ink-faint hover:text-accent"
          onClick={() => dispatch(removeRouting(routing.id))}
        >
          ×
        </button>
      </div>
      <Slider
        label="amount"
        min={-1}
        max={1}
        value={routing.amount}
        onChange={(amount) => patch({ amount })}
      />
      <Slider
        label="smooth"
        min={0}
        max={1}
        value={routing.smoothing}
        onChange={(smoothing) => patch({ smoothing })}
      />
      <Slider
        label="phase"
        min={0}
        max={1}
        value={routing.phaseOffset}
        onChange={(phaseOffset) => patch({ phaseOffset })}
      />
      <div className="flex items-center gap-4">
        <Toggle
          label="invert"
          on={routing.invert}
          onClick={() => patch({ invert: !routing.invert })}
        />
        <Toggle
          label="ratchet"
          on={routing.ratchet}
          onClick={() => patch({ ratchet: !routing.ratchet })}
        />
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-ink-faint">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        className="flex-1"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-9 text-right text-xs">{value.toFixed(2)}</span>
    </label>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-ink-faint">{label}</span>
      <button
        className={`h-4 w-4 border ${on ? "border-ink bg-ink" : "border-hairline"}`}
        onClick={onClick}
        aria-pressed={on}
      />
    </label>
  );
}

/** apply a recipe as real routings, with per-instance phase for groups. */
function applyRecipe(
  recipe: MotionRecipe,
  layer: Layer,
  dispatch: ReturnType<typeof useAppStore.getState>["dispatch"],
): void {
  // if the layer is a group of repeated elements, stagger each child's
  // phaseOffset so the cluster ripples instead of pulsing in unison
  const targets: { id: string; phase: number }[] =
    layer.type === "group" && layer.children.length > 1
      ? layer.children.map((c, i) => ({
          id: c.id,
          phase: i / layer.children.length,
        }))
      : [{ id: layer.id, phase: 0 }];

  const commands = targets.flatMap((t) =>
    recipe.routings.map((r) =>
      addRouting({
        ...r,
        id: nanoid(),
        layerId: t.id,
        phaseOffset: r.phaseOffset || t.phase,
      }),
    ),
  );
  if (commands.length) dispatch(batch(commands, `auto-route: ${recipe.name}`));
}

export default function MotionTab({ layer }: { layer: Layer }) {
  const routings = useAppStore((s) => s.scene.routings);
  const dispatch = useAppStore((s) => s.dispatch);
  const mine = routings.filter((r) => r.layerId === layer.id);
  const generator =
    layer.type === "group" ? layer.sourceGenerator : undefined;
  const recipes = recipesFor(generator);

  return (
    <div className="flex flex-col gap-3">
      <AudioSourcePicker />
      {recipes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline-soft pt-3">
          {recipes.map((rec) => (
            <button
              key={rec.id}
              className="border border-accent px-2 py-0.5 text-xs text-accent hover:bg-accent hover:text-paper"
              onClick={() => applyRecipe(rec, layer, dispatch)}
            >
              ✦ auto-route: {rec.name}
            </button>
          ))}
        </div>
      )}
      <div className="border-t border-hairline-soft pt-3">
        <div className="mb-2 text-xs text-ink-faint">
          {layer.name} — {mine.length || "no"} routing
          {mine.length === 1 ? "" : "s"}
        </div>
        <div className="flex flex-col gap-2">
          {mine.map((r) => (
            <RoutingRow key={r.id} routing={r} layer={layer} />
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
                phaseOffset: 0,
                ratchet: false,
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
