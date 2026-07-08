"use client";

import { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import type { Layer, PathLayer, TextLayer } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { addEffect, batch, patchLayer, patchScene } from "@/state/commands";
import { findLayer } from "@/lib/layers";
import ColorPicker from "@/components/ColorPicker";
import MotionTab from "@/components/MotionTab";
import EffectsTab from "@/components/EffectsTab";
import FillControl from "@/components/FillControl";
import ShaderProps from "@/components/ShaderProps";
import { getEffectDef } from "@/effects/registry";

type Tab = "properties" | "effects" | "motion";

// ---------- small controls ----------

function NumberField({
  label,
  value,
  step = 1,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);

  const commit = () => {
    const v = parseFloat(draft);
    if (Number.isNaN(v)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (clamped !== value) onCommit(clamped);
    else setDraft(String(clamped));
  };

  return (
    <label className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-ink-faint">{label}</span>
      <input
        className="field"
        type="number"
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-xs text-ink-faint">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// ---------- properties tab ----------

function PathProps({ layer }: { layer: PathLayer }) {
  const dispatch = useAppStore((s) => s.dispatch);
  return (
    <Section title="fill + stroke">
      <FillControl
        label="fill"
        fill={layer.fill}
        allowNone
        onChange={(fill) => dispatch(patchLayer(layer.id, { fill }, "fill"))}
      />
      <ColorPicker
        label="stroke"
        value={layer.stroke}
        allowNone
        onChange={(stroke) =>
          dispatch(
            patchLayer(
              layer.id,
              { stroke, strokeWidth: layer.strokeWidth || 1 },
              "stroke",
            ),
          )
        }
      />
      {layer.stroke && (
        <NumberField
          label="width"
          value={layer.strokeWidth}
          min={0}
          onCommit={(strokeWidth) =>
            dispatch(patchLayer(layer.id, { strokeWidth }, "stroke width"))
          }
        />
      )}
    </Section>
  );
}

function TextProps({ layer }: { layer: TextLayer }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const [draft, setDraft] = useState(layer.text);
  useEffect(() => setDraft(layer.text), [layer.text]);

  return (
    <>
      <Section title="text">
        <textarea
          className="field min-h-16 resize-y"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== layer.text)
              dispatch(patchLayer(layer.id, { text: draft }, "edit text"));
          }}
          spellCheck={false}
        />
        <NumberField
          label="size"
          value={layer.fontSize}
          min={1}
          onCommit={(fontSize) =>
            dispatch(patchLayer(layer.id, { fontSize }, "font size"))
          }
        />
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-ink-faint">weight</span>
          <select
            className="field"
            value={layer.fontWeight}
            onChange={(e) =>
              dispatch(
                patchLayer(
                  layer.id,
                  { fontWeight: Number(e.target.value) },
                  "font weight",
                ),
              )
            }
          >
            <option value={400}>regular</option>
            <option value={700}>bold</option>
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-ink-faint">align</span>
          <div className="flex border border-hairline-soft">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                onClick={() =>
                  dispatch(patchLayer(layer.id, { align: a }, "align"))
                }
                className={`px-2 py-0.5 text-xs ${
                  layer.align === a ? "bg-ink text-paper" : "hover:text-accent"
                }`}
              >
                {a[0]}
              </button>
            ))}
          </div>
        </div>
        <FillControl
          label="fill"
          fill={layer.fill}
          onChange={(fill) =>
            fill && dispatch(patchLayer(layer.id, { fill }, "fill"))
          }
        />
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-ink-faint">tracking</span>
          <input
            className="field"
            type="number"
            step={0.5}
            value={layer.letterSpacing}
            onChange={(e) =>
              dispatch(
                patchLayer(
                  layer.id,
                  { letterSpacing: Number(e.target.value) || 0 },
                  "letter spacing",
                ),
              )
            }
          />
        </label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-xs text-ink-faint">outline</span>
            <button
              className={`h-4 w-4 border ${layer.strokeOnly ? "border-ink bg-ink" : "border-hairline"}`}
              aria-pressed={layer.strokeOnly}
              onClick={() =>
                dispatch(
                  patchLayer(
                    layer.id,
                    { strokeOnly: !layer.strokeOnly },
                    "outline type",
                  ),
                )
              }
            />
          </label>
          {getEffectDef("displace") && (
            <button
              className="border border-hairline px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
              title="attach a tuned displace effect (SPEC2 §12.4)"
              onClick={() => liquify(layer.id, dispatch)}
            >
              liquify
            </button>
          )}
        </div>
      </Section>
    </>
  );
}

/** one-click melted/warped editorial type — attaches a tuned displace fx */
function liquify(
  layerId: string,
  dispatch: ReturnType<typeof useAppStore.getState>["dispatch"],
): void {
  dispatch(
    addEffect(layerId, {
      id: nanoid(),
      kind: "displace",
      enabled: true,
      params: { amount: 18, scale: 0.008, speed: 0.3, mode: "simplex" },
    }),
  );
}

function SingleLayerProps({ layer }: { layer: Layer }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const t = layer.transform;
  const patchT = (patch: Partial<typeof t>, label: string) =>
    dispatch(patchLayer(layer.id, { transform: { ...t, ...patch } }, label));

  return (
    <>
      <Section title="transform">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="x" value={t.x} onCommit={(x) => patchT({ x }, "move")} />
          <NumberField label="y" value={t.y} onCommit={(y) => patchT({ y }, "move")} />
          <NumberField
            label="scale x"
            value={t.scaleX}
            step={0.05}
            onCommit={(scaleX) => patchT({ scaleX }, "scale")}
          />
          <NumberField
            label="scale y"
            value={t.scaleY}
            step={0.05}
            onCommit={(scaleY) => patchT({ scaleY }, "scale")}
          />
          <NumberField
            label="rotate"
            value={t.rotation}
            onCommit={(rotation) => patchT({ rotation }, "rotate")}
          />
          <NumberField
            label="opacity"
            value={layer.opacity}
            step={0.05}
            min={0}
            max={1}
            onCommit={(opacity) =>
              dispatch(patchLayer(layer.id, { opacity }, "opacity"))
            }
          />
        </div>
      </Section>
      {layer.type === "path" && <PathProps layer={layer} />}
      {layer.type === "text" && <TextProps layer={layer} />}
      {layer.type === "shader" && <ShaderProps layer={layer} />}
    </>
  );
}

function MultiLayerProps({ layers }: { layers: Layer[] }) {
  const dispatch = useAppStore((s) => s.dispatch);
  return (
    <>
      <div className="mb-4 text-xs text-ink-faint">{layers.length} selected</div>
      <Section title="shared">
        <NumberField
          label="opacity"
          value={layers[0].opacity}
          step={0.05}
          min={0}
          max={1}
          onCommit={(opacity) =>
            dispatch(
              batch(
                layers.map((l) => patchLayer(l.id, { opacity })),
                "opacity",
              ),
            )
          }
        />
        <FillControl
          label="fill"
          fill={
            layers[0].type === "path" || layers[0].type === "text"
              ? layers[0].fill
              : null
          }
          allowNone
          onChange={(fill) =>
            dispatch(
              batch(
                layers
                  .filter((l) => l.type === "path" || l.type === "text")
                  .map((l) =>
                    l.type === "text"
                      ? patchLayer(l.id, { fill: fill ?? "#0a0a0a" })
                      : patchLayer(l.id, { fill }),
                  ),
                "fill",
              ),
            )
          }
        />
      </Section>
    </>
  );
}

// ---------- scene (no selection) ----------

function SceneProps() {
  const scene = useAppStore((s) => s.scene);
  const dispatch = useAppStore((s) => s.dispatch);
  return (
    <Section title="artboard">
      <ColorPicker
        label="bg"
        value={scene.background}
        onChange={(background) => {
          if (background) dispatch(patchScene({ background }, "background"));
        }}
      />
    </Section>
  );
}

// ---------- the panel ----------

export default function Inspector() {
  const [tab, setTab] = useState<Tab>("properties");
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const scene = useAppStore((s) => s.scene);

  const selected = selectedIds
    .map((id) => findLayer(scene.layers, id))
    .filter((l): l is Layer => l !== null);

  return (
    <aside className="flex w-panel-r flex-col border-l border-hairline bg-paper">
      <div className="flex border-b border-hairline-soft">
        {(["properties", "effects", "motion"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs ${
              tab === t
                ? "border-b border-ink text-ink"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "properties" &&
          (selected.length === 0 ? (
            <SceneProps />
          ) : selected.length === 1 ? (
            <SingleLayerProps layer={selected[0]} />
          ) : (
            <MultiLayerProps layers={selected} />
          ))}
        {tab === "effects" && <EffectsTab layer={selected[0] ?? null} />}
        {tab === "motion" &&
          (selected.length >= 1 ? (
            <MotionTab layer={selected[0]} />
          ) : (
            <div className="mt-10 text-center text-xs text-ink-faint">
              select a layer to route motion
            </div>
          ))}
      </div>
      <div className="border-t border-hairline-soft px-3 py-2 text-xs text-ink-faint">
        {scene.width} × {scene.height}
      </div>
    </aside>
  );
}
