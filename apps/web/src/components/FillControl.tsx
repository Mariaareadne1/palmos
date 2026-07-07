"use client";

import type { Fill } from "@/types/scene";
import { fillFallbackColor, isGradientFill } from "@/lib/fill";
import ColorPicker from "@/components/ColorPicker";

/**
 * Fill editor. Step 9 ships the solid path (a plain ColorPicker); Step 12
 * (§12.3) extends this same component with the solid/gradient toggle and
 * stop-bar editor. Keeping one component means the inspector never has to
 * change again when gradients land.
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
  const solid = fillFallbackColor(fill);
  return (
    <div className="flex flex-col gap-1">
      <ColorPicker
        label={label}
        value={solid}
        allowNone={allowNone}
        onChange={(c) => onChange(c)}
      />
      {isGradientFill(fill) && (
        <span className="pl-14 text-xs text-ink-faint">
          gradient ({fill.type}) — edit in gradient panel
        </span>
      )}
    </div>
  );
}
