"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/state/store";

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperApi {
  open(): Promise<EyeDropperResult>;
}
declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperApi;
  }
}

interface Props {
  label: string;
  value: string | null;
  allowNone?: boolean;
  onChange: (color: string | null) => void;
}

/**
 * Compact custom picker: hex input + scene palette swatches + native
 * wheel + EyeDropper where the API exists. No native-looking chrome.
 */
export default function ColorPicker({ label, value, allowNone, onChange }: Props) {
  const palette = useAppStore((s) => s.scene.palette);
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value ?? "");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHex(value ?? ""), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const commitHex = (raw: string) => {
    let v = raw.trim();
    if (!v.startsWith("#")) v = `#${v}`;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) onChange(v.toLowerCase());
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-ink-faint">{label}</span>
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-5 w-5 shrink-0 border border-hairline"
        style={
          value
            ? { background: value }
            : {
                background:
                  "linear-gradient(to top left, transparent 46%, #0a0a0a 48%, #0a0a0a 52%, transparent 54%)",
              }
        }
        aria-label={`${label} color`}
      />
      <input
        className="field w-20"
        value={hex}
        placeholder="none"
        spellCheck={false}
        onChange={(e) => setHex(e.target.value)}
        onBlur={() => commitHex(hex)}
        onKeyDown={(e) => e.key === "Enter" && commitHex(hex)}
      />
      {open && (
        <div className="absolute right-0 top-6 z-20 w-44 border border-hairline bg-paper p-2">
          <div className="mb-2 flex flex-wrap gap-1">
            {palette.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className={`h-5 w-5 border ${
                  value === c ? "border-accent" : "border-hairline-soft"
                }`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value ?? "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="h-6 w-6 cursor-pointer border border-hairline-soft bg-paper p-0"
              aria-label="color wheel"
            />
            {typeof window !== "undefined" && window.EyeDropper && (
              <button
                className="border border-hairline px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
                onClick={async () => {
                  try {
                    const result = await new window.EyeDropper!().open();
                    onChange(result.sRGBHex);
                    setOpen(false);
                  } catch {
                    // user cancelled
                  }
                }}
              >
                pick
              </button>
            )}
            {allowNone && (
              <button
                className="ml-auto border border-hairline px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                none
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
