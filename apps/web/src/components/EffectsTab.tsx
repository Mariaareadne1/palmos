"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import type { Effect, Layer } from "@/types/scene";
import { useAppStore } from "@/state/store";
import {
  addEffect,
  addPostEffect,
  patchEffectParams,
  patchPostEffectParams,
  removeEffect,
  removePostEffect,
  reorderEffect,
  reorderPostEffect,
  toggleEffect,
  togglePostEffect,
} from "@/state/commands";
import {
  allEffectDefs,
  bakeEffectDefs,
  defaultParams,
  gpuEffectDefs,
  getEffectDef,
} from "@/effects/registry";
import { requestBake } from "@/effects/bake/bakeBus";
import EffectParamField from "@/components/EffectParamField";

/** Which of this layer's effect params are currently modulated. */
function modulatedParams(
  routings: { target: string }[],
  scope: "effect" | "post",
): Set<string> {
  const set = new Set<string>();
  for (const r of routings) {
    if (r.target.startsWith(`${scope}:`)) {
      const [, effectId, param] = r.target.split(":");
      set.add(`${effectId}:${param}`);
    }
  }
  return set;
}

function EffectRow({
  effect,
  index,
  count,
  modulated,
  onToggle,
  onRemove,
  onReorder,
  onParam,
}: {
  effect: Effect;
  index: number;
  count: number;
  modulated: Set<string>;
  onToggle: () => void;
  onRemove: () => void;
  onReorder: (to: number) => void;
  onParam: (param: string, value: number | string | boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const def = getEffectDef(effect.kind);
  if (!def) return null;

  return (
    <div
      className="border border-hairline-soft"
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/palmos-effect", String(index))
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/palmos-effect"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        const from = Number(e.dataTransfer.getData("text/palmos-effect"));
        if (!Number.isNaN(from) && from !== index) onReorder(index);
      }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          role="switch"
          aria-checked={effect.enabled}
          title={effect.enabled ? "disable" : "enable"}
          onClick={onToggle}
          className={`h-3 w-3 shrink-0 border ${
            effect.enabled ? "border-ink bg-ink" : "border-hairline"
          }`}
        />
        <button
          className="flex-1 text-left text-xs"
          onClick={() => setOpen((o) => !o)}
        >
          {def.name}
        </button>
        <span className="text-xs text-ink-faint">{index + 1}/{count}</span>
        <button
          title="remove"
          className="px-1 text-xs text-ink-faint hover:text-accent"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-hairline-soft p-2">
          {def.params.map((p) => (
            <EffectParamField
              key={p.name}
              def={p}
              value={effect.params[p.name] ?? p.default}
              modulated={modulated.has(`${effect.id}:${p.name}`)}
              onChange={(v) => onParam(p.name, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Add dropdown + bake launcher shared by layer and post stacks. */
function AddEffect({
  gpuOnly,
  onAddGpu,
  onBake,
}: {
  gpuOnly: boolean;
  onAddGpu: (kind: string) => void;
  onBake?: (kind: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const defs = useMemo(() => {
    const pool = gpuOnly ? gpuEffectDefs() : allEffectDefs();
    const q = query.trim().toLowerCase();
    return pool.filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [gpuOnly, query]);

  return (
    <div className="relative">
      <input
        className="field"
        placeholder="+ add effect…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && defs.length > 0 && (
        <div className="absolute left-0 right-0 top-8 z-30 max-h-56 overflow-y-auto border border-hairline bg-paper">
          {defs.map((d) => {
            const isBake = d.class === "bake";
            return (
              <button
                key={d.kind}
                className="flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-ink hover:text-paper"
                onClick={() => {
                  if (isBake) onBake?.(d.kind);
                  else onAddGpu(d.kind);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span>{d.name}</span>
                <span className="text-ink-faint">{isBake ? "bake →" : "gpu"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function makeEffect(kind: string): Effect {
  const def = getEffectDef(kind)!;
  return { id: nanoid(), kind, enabled: true, params: defaultParams(def) };
}

/** Bake configurator: params + a seeded "bake to layers" action. */
function BakePanel({ layerId, kind }: { layerId: string; kind: string }) {
  const def = getEffectDef(kind)!;
  const [params, setParams] = useState(() => defaultParams(def));
  return (
    <div className="mt-2 border border-hairline-soft p-2">
      <div className="mb-1.5 text-xs">{def.name} — bake</div>
      <div className="flex flex-col gap-1.5">
        {def.params.map((p) => (
          <EffectParamField
            key={p.name}
            def={p}
            value={params[p.name] ?? p.default}
            onChange={(v) => setParams((prev) => ({ ...prev, [p.name]: v }))}
          />
        ))}
      </div>
      <button
        className="mt-2 w-full border border-hairline px-3 py-1 text-xs hover:bg-ink hover:text-paper"
        onClick={() =>
          requestBake({
            layerId,
            kind,
            params,
            seed:
              typeof params.seed === "number" ? (params.seed as number) : 1,
          })
        }
      >
        bake to layers
      </button>
    </div>
  );
}

export default function EffectsTab({ layer }: { layer: Layer | null }) {
  const routings = useAppStore((s) => s.scene.routings);
  const postEffects = useAppStore((s) => s.scene.postEffects);
  const dispatch = useAppStore((s) => s.dispatch);
  const [bakeKind, setBakeKind] = useState<string | null>(null);

  if (!layer) {
    // document post-fx stack (SPEC2 §9.2 / §11.1)
    const modP = modulatedParams(routings, "post");
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs text-ink-faint">document post-fx</div>
        {postEffects.map((e, i) => (
          <EffectRow
            key={e.id}
            effect={e}
            index={i}
            count={postEffects.length}
            modulated={modP}
            onToggle={() => dispatch(togglePostEffect(e.id))}
            onRemove={() => dispatch(removePostEffect(e.id))}
            onReorder={(to) => dispatch(reorderPostEffect(e.id, to))}
            onParam={(param, value) =>
              dispatch(patchPostEffectParams(e.id, { [param]: value }))
            }
          />
        ))}
        <AddEffect
          gpuOnly
          onAddGpu={(kind) => dispatch(addPostEffect(makeEffect(kind)))}
        />
      </div>
    );
  }

  const modE = modulatedParams(routings, "effect");
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-ink-faint">{layer.name} — effects</div>
      {layer.effects.map((e, i) => (
        <EffectRow
          key={e.id}
          effect={e}
          index={i}
          count={layer.effects.length}
          modulated={modE}
          onToggle={() => dispatch(toggleEffect(layer.id, e.id))}
          onRemove={() => dispatch(removeEffect(layer.id, e.id))}
          onReorder={(to) => dispatch(reorderEffect(layer.id, e.id, to))}
          onParam={(param, value) =>
            dispatch(patchEffectParams(layer.id, e.id, { [param]: value }))
          }
        />
      ))}
      <AddEffect
        gpuOnly={false}
        onAddGpu={(kind) => dispatch(addEffect(layer.id, makeEffect(kind)))}
        onBake={(kind) => setBakeKind(kind)}
      />
      {bakeKind && bakeEffectDefs().some((d) => d.kind === bakeKind) && (
        <BakePanel layerId={layer.id} kind={bakeKind} />
      )}
    </div>
  );
}
