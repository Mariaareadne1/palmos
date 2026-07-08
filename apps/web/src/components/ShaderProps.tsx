"use client";

import { useEffect, useState } from "react";
import type { ShaderLayer } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { patchLayer } from "@/state/commands";
import { validateFragment } from "@/effects/shaderCompile";

/**
 * Custom GLSL layer editor (SPEC2 §11.2): a light monospace textarea with
 * compile-on-blur. Errors render inline in red mono; a broken shader
 * falls back to transparent passthrough and never crashes the app. Each
 * customParam gets a 0–1 slider (modulatable like any effect param).
 */
export default function ShaderProps({ layer }: { layer: ShaderLayer }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const [draft, setDraft] = useState(layer.fragmentSource);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => setDraft(layer.fragmentSource), [layer.fragmentSource]);

  const compile = () => {
    const result = validateFragment(draft, layer.customParams);
    if (!result.ok) {
      setError(result.error ?? "compile error");
      return;
    }
    setError(null);
    if (draft !== layer.fragmentSource) {
      dispatch(patchLayer(layer.id, { fragmentSource: draft }, "edit shader"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumField label="width" value={layer.width} onCommit={(v) => dispatch(patchLayer(layer.id, { width: v }, "shader size"))} />
        <NumField label="height" value={layer.height} onCommit={(v) => dispatch(patchLayer(layer.id, { height: v }, "shader size"))} />
      </div>

      {Object.keys(layer.customParams).length > 0 && (
        <div className="flex flex-col gap-2 border-t border-hairline-soft pt-3">
          <div className="text-xs text-ink-faint">params</div>
          {Object.entries(layer.customParams).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs">{k}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={v}
                className="flex-1"
                onChange={(e) =>
                  dispatch(
                    patchLayer(
                      layer.id,
                      { customParams: { ...layer.customParams, [k]: Number(e.target.value) } },
                      "shader param",
                    ),
                  )
                }
              />
              <span className="w-9 text-right text-xs">{v.toFixed(2)}</span>
            </label>
          ))}
        </div>
      )}

      <div className="border-t border-hairline-soft pt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-ink-faint">fragment (glsl)</span>
          <button
            className="text-xs text-ink-faint hover:text-accent"
            onClick={() => setShowHelp((s) => !s)}
          >
            uniforms ?
          </button>
        </div>
        {showHelp && (
          <div className="mb-2 border border-hairline-soft p-2 text-xs text-ink-faint">
            auto-injected: u_time, u_resolution, u_rms, u_low, u_mid,
            u_high, u_onset, + your params. write finalColor; vUV is 0–1.
          </div>
        )}
        <textarea
          className="field min-h-48 resize-y font-mono text-xs leading-tight"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={compile}
        />
        {error && (
          <pre className="mt-1 whitespace-pre-wrap border border-accent p-2 font-mono text-xs text-accent">
            {error}
          </pre>
        )}
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [d, setD] = useState(String(value));
  useEffect(() => setD(String(value)), [value]);
  return (
    <label className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-ink-faint">{label}</span>
      <input
        className="field"
        value={d}
        onChange={(e) => setD(e.target.value)}
        onBlur={() => {
          const v = parseFloat(d);
          if (!Number.isNaN(v) && v > 0) onCommit(v);
          else setD(String(value));
        }}
      />
    </label>
  );
}
