"use client";

import { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import type { Layer, PathLayer, TextLayer } from "@/types/scene";
import { useAppStore } from "@/state/store";
import {
  addEffect,
  applyStyle,
  batch,
  patchLayer,
  patchScene,
  saveStyle,
} from "@/state/commands";
import { findLayer } from "@/lib/layers";
import ColorPicker from "@/components/ColorPicker";
import MotionTab from "@/components/MotionTab";
import EffectsTab from "@/components/EffectsTab";
import FillControl from "@/components/FillControl";
import ShaderProps from "@/components/ShaderProps";
import EffectParamField from "@/components/EffectParamField";
import { getEffectDef, type ParamValue } from "@/effects/registry";
import { getGenerator } from "@/design/generators";
import { DESIGN_FONTS } from "@/design/fonts";
import { SHIPPED_STYLES } from "@/design/styles";
import { SHIPPED_PALETTES, PAPER_GROUNDS, harmonize } from "@/design/palettes";
import type { GroupLayer } from "@/types/scene";

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
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-ink-faint">font</span>
          <select
            className="field"
            value={layer.fontFamily}
            onChange={(e) =>
              dispatch(patchLayer(layer.id, { fontFamily: e.target.value }, "font"))
            }
          >
            {!DESIGN_FONTS.includes(layer.fontFamily as (typeof DESIGN_FONTS)[number]) && (
              <option value={layer.fontFamily}>{layer.fontFamily}</option>
            )}
            {DESIGN_FONTS.map((fnt) => (
              <option key={fnt} value={fnt}>
                {fnt}
              </option>
            ))}
          </select>
        </label>
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
      {layer.type === "group" && layer.sourceGenerator && layer.generatorParams && (
        <GeneratorControls layer={layer} />
      )}
      {(layer.type === "path" || layer.type === "text") && (
        <StylesSection layer={layer} />
      )}
    </>
  );
}

/** Shipped + saved styles (SPEC2 §12.4), applied as one undoable command. */
function StylesSection({ layer }: { layer: PathLayer | TextLayer }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const savedStyles = useAppStore((s) => s.scene.styles);
  const all = [...SHIPPED_STYLES, ...savedStyles];
  return (
    <Section title="styles">
      <div className="flex flex-wrap gap-1.5">
        {all.map((style) => (
          <button
            key={style.id}
            onClick={() => dispatch(applyStyle(layer.id, style))}
            className="border border-hairline px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
          >
            {style.name}
          </button>
        ))}
      </div>
      <button
        className="mt-1 border border-hairline-soft px-2 py-0.5 text-xs text-ink-faint hover:text-ink"
        onClick={() =>
          dispatch(
            saveStyle({
              id: nanoid(),
              name: `style ${savedStyles.length + 1}`,
              fill: layer.fill,
              stroke: layer.type === "path" ? layer.stroke : undefined,
              strokeWidth: layer.type === "path" ? layer.strokeWidth : undefined,
              effects: layer.effects.map((e) => ({ ...e })),
            }),
          )
        }
      >
        + save this as a style
      </button>
    </Section>
  );
}

/**
 * Live generator params (SPEC2 §12.1): editing regenerates the group's
 * geometry in place, keeping its id/transform — until the user ungroups,
 * which freezes it to plain paths.
 */
function GeneratorControls({ layer }: { layer: GroupLayer }) {
  const scene = useAppStore((s) => s.scene);
  const dispatch = useAppStore((s) => s.dispatch);
  const gen = getGenerator(layer.sourceGenerator!);
  if (!gen) return null;

  const regenerate = (params: Record<string, ParamValue>) => {
    const next = gen.generate(params, scene.palette);
    dispatch(
      patchLayer(
        layer.id,
        {
          children: next.children,
          effects: next.effects,
          generatorParams: params,
          growthSteps: next.growthSteps,
        } as Partial<GroupLayer>,
        `edit ${gen.name}`,
      ),
    );
  };

  return (
    <Section title={`${gen.name} params`}>
      {gen.params.map((p) => (
        <EffectParamField
          key={p.name}
          def={p}
          value={layer.generatorParams![p.name] ?? p.default}
          onChange={(v) =>
            regenerate({ ...layer.generatorParams!, [p.name]: v })
          }
        />
      ))}
      <div className="text-xs text-ink-faint">
        ungroup (⇧⌘g) to freeze to editable paths
      </div>
    </Section>
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
  const [locks, setLocks] = useState<boolean[]>([]);

  const lockOf = (i: number) => locks[i] ?? false;
  const toggleLock = (i: number) =>
    setLocks((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });

  return (
    <>
      <Section title="artboard">
        <ColorPicker
          label="bg"
          value={scene.background}
          onChange={(background) => {
            if (background) dispatch(patchScene({ background }, "background"));
          }}
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PAPER_GROUNDS.map((g) => (
            <button
              key={g.name}
              title={g.name}
              onClick={() => dispatch(patchScene({ background: g.color }, "paper ground"))}
              className="flex items-center gap-1 border border-hairline-soft px-1.5 py-0.5 text-xs hover:border-ink"
            >
              <span className="h-3 w-3 border border-hairline-soft" style={{ background: g.color }} />
              {g.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="palette">
        <div className="flex flex-wrap items-center gap-1">
          {scene.palette.map((c, i) => (
            <button
              key={`${c}-${i}`}
              title={`${c}${lockOf(i) ? " (locked)" : ""}`}
              onClick={() => toggleLock(i)}
              className={`h-6 w-6 border ${lockOf(i) ? "border-accent" : "border-hairline-soft"}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <button
          className="border border-hairline-soft px-2 py-0.5 text-xs text-ink-faint hover:text-ink"
          onClick={() =>
            dispatch(
              patchScene(
                { palette: harmonize(scene.palette, scene.palette.map((_, i) => lockOf(i))) },
                "harmonize",
              ),
            )
          }
        >
          harmonize (locked stay)
        </button>
        <div className="mt-1 text-xs text-ink-faint">board palettes</div>
        <div className="flex flex-col gap-1">
          {SHIPPED_PALETTES.map((p) => (
            <button
              key={p.name}
              onClick={() => dispatch(patchScene({ palette: p.colors }, "palette"))}
              className="flex items-center gap-2 border border-hairline-soft px-1.5 py-1 text-xs hover:border-ink"
            >
              <span className="flex">
                {p.colors.map((c) => (
                  <span key={c} className="h-4 w-4" style={{ background: c }} />
                ))}
              </span>
              {p.name}
            </button>
          ))}
        </div>
      </Section>
    </>
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
