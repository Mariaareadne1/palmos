"use client";

import { useEffect, useState } from "react";
import type { ParamDef, ParamValue } from "@/effects/registry";
import ColorPicker from "@/components/ColorPicker";

/**
 * One auto-generated effect-param control (SPEC2 §9.2 — the inspector
 * never hand-builds per-effect panels). `modulated` shows the pulse-dot
 * that links a param to the motion tab.
 */
export default function EffectParamField({
  def,
  value,
  modulated,
  onChange,
}: {
  def: ParamDef;
  value: ParamValue;
  modulated?: boolean;
  onChange: (value: ParamValue) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-ink-faint">
        {def.label}
        {modulated && (
          <span
            title="modulated — see motion tab"
            className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
          />
        )}
      </span>
      {def.type === "number" && (
        <NumberControl def={def} value={value as number} onChange={onChange} />
      )}
      {def.type === "boolean" && (
        <button
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
          className={`h-4 w-4 border ${
            value ? "border-ink bg-ink" : "border-hairline"
          }`}
        />
      )}
      {def.type === "select" && (
        <select
          className="field"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {def.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
      {def.type === "color" && (
        <div className="flex-1">
          <ColorPicker
            label=""
            value={String(value)}
            onChange={(c) => c && onChange(c)}
          />
        </div>
      )}
    </label>
  );
}

function NumberControl({
  def,
  value,
  onChange,
}: {
  def: ParamDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  const min = def.min ?? 0;
  const max = def.max ?? 1;
  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        type="range"
        className="flex-1"
        min={min}
        max={max}
        step={def.step ?? 0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        className="field w-12 text-right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          else setDraft(String(value));
        }}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
      />
    </div>
  );
}
