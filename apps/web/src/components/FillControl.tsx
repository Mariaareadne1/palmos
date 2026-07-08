"use client";

import type { Fill, GradientFill, GradientStop } from "@/types/scene";
import { fillFallbackColor, isGradientFill } from "@/lib/fill";
import ColorPicker from "@/components/ColorPicker";

/**
 * Fill editor (SPEC2 §12.3): solid/gradient toggle, gradient type select,
 * angle dial, and a stop bar (add / move / recolor). Konva + Pixi render
 * linear/radial natively; conic bakes to a texture.
 */
export default function FillControl({
  label,
  fill,
  allowNone,
  onChange,
}: {
  label: string;
  fill: Fill;
  allowNone?: boolean;
  onChange: (fill: Fill) => void;
}) {
  const isGradient = isGradientFill(fill);

  const toGradient = () => {
    const base = fillFallbackColor(fill) ?? "#f6b8dc";
    const g: GradientFill = {
      type: "linear",
      stops: [
        { offset: 0, color: base },
        { offset: 1, color: "#b8c9f6" },
      ],
      angle: 90,
      cx: 0.5,
      cy: 0.5,
    };
    onChange(g);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-ink-faint">{label}</span>
        <div className="flex border border-hairline-soft">
          <button
            className={`px-2 py-0.5 text-xs ${!isGradient ? "bg-ink text-paper" : "hover:text-accent"}`}
            onClick={() => isGradient && onChange(fillFallbackColor(fill) ?? "#0a0a0a")}
          >
            solid
          </button>
          <button
            className={`px-2 py-0.5 text-xs ${isGradient ? "bg-ink text-paper" : "hover:text-accent"}`}
            onClick={() => !isGradient && toGradient()}
          >
            gradient
          </button>
        </div>
      </div>

      {!isGradient ? (
        <ColorPicker
          label=""
          value={fillFallbackColor(fill)}
          allowNone={allowNone}
          onChange={(c) => onChange(c)}
        />
      ) : (
        <GradientEditor g={fill} onChange={onChange} />
      )}
    </div>
  );
}

function GradientEditor({
  g,
  onChange,
}: {
  g: GradientFill;
  onChange: (fill: Fill) => void;
}) {
  const patch = (p: Partial<GradientFill>) => onChange({ ...g, ...p });
  const setStops = (stops: GradientStop[]) =>
    patch({ stops: [...stops].sort((a, b) => a.offset - b.offset) });

  const gradientCss = `${g.type === "linear" ? `linear-gradient(90deg` : g.type === "radial" ? "radial-gradient(circle" : "conic-gradient("}, ${g.stops
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(", ")})`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-4 w-full border border-hairline-soft" style={{ background: gradientCss }} />
      <div className="flex items-center gap-2">
        <select
          className="field w-24"
          value={g.type}
          onChange={(e) => patch({ type: e.target.value as GradientFill["type"] })}
        >
          <option value="linear">linear</option>
          <option value="radial">radial</option>
          <option value="conic">conic</option>
        </select>
        {g.type !== "radial" && (
          <label className="flex flex-1 items-center gap-1">
            <span className="text-xs text-ink-faint">angle</span>
            <input
              type="range"
              min={0}
              max={360}
              value={g.angle}
              className="flex-1"
              onChange={(e) => patch({ angle: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {g.stops.map((stop, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={stop.offset}
              className="w-16"
              onChange={(e) =>
                setStops(g.stops.map((s, j) => (j === i ? { ...s, offset: Number(e.target.value) } : s)))
              }
            />
            <div className="flex-1">
              <ColorPicker
                label=""
                value={stop.color}
                onChange={(c) =>
                  c && setStops(g.stops.map((s, j) => (j === i ? { ...s, color: c } : s)))
                }
              />
            </div>
            {g.stops.length > 2 && (
              <button
                className="px-1 text-xs text-ink-faint hover:text-accent"
                onClick={() => setStops(g.stops.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {g.stops.length < 8 && (
          <button
            className="border border-hairline-soft px-2 py-0.5 text-xs text-ink-faint hover:text-ink"
            onClick={() => setStops([...g.stops, { offset: 0.5, color: "#ffffff" }])}
          >
            + stop
          </button>
        )}
      </div>
    </div>
  );
}
