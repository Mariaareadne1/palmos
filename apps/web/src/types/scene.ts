export type LayerType = "path" | "text" | "image" | "group" | "shader";

export interface Transform {
  x: number;        // px, relative to parent
  y: number;
  scaleX: number;   // 1 = 100%
  scaleY: number;
  rotation: number; // degrees
}

// ---- Effects (SPEC2 §9.1) ----

export interface Effect {
  id: string;
  kind: string;                    // registry key, e.g. "halftone", "crt", "glow"
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface GradientStop {
  offset: number;                  // 0–1
  color: string;
}

export interface GradientFill {
  type: "linear" | "radial" | "conic";
  stops: GradientStop[];           // 2–8 stops
  angle: number;                   // linear/conic, degrees
  cx: number;                      // radial/conic center, 0–1 relative to layer bbox
  cy: number;
}

export type Fill = string | GradientFill | null;

export interface BaseLayer {
  id: string;             // nanoid
  name: string;           // user-editable, e.g. "Sun circle"
  type: LayerType;
  transform: Transform;
  opacity: number;        // 0–1
  visible: boolean;
  locked: boolean;
  effects: Effect[];      // applied bottom-to-top
  // zIndex is implicit: order within parent's children array
}

export interface PathLayer extends BaseLayer {
  type: "path";
  d: string;              // SVG path data — the universal vector format here
  fill: Fill;             // hex, gradient, or null
  stroke: string | null;
  strokeWidth: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: Fill;
  align: "left" | "center" | "right";
  letterSpacing: number;  // px, default 0
  strokeOnly: boolean;    // outline type, default false
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  src: string;            // data URL or storage URL
  width: number;
  height: number;
}

export interface GroupLayer extends BaseLayer {
  type: "group";
  children: Layer[];
  /** stamped by design-kit generators so motion recipes can match */
  sourceGenerator?: string;
  /** regenerable generator params (frozen away on ungroup) */
  generatorParams?: Record<string, number | string | boolean>;
  /** growth playback: cumulative path sets per step (SPEC2 §9.3) */
  growthSteps?: PathLayer[][];
}

/** Custom GLSL quad (SPEC2 §11.2). */
export interface ShaderLayer extends BaseLayer {
  type: "shader";
  fragmentSource: string;
  width: number;
  height: number;
  customParams: Record<string, number>;  // each auto-exposed 0–1, modulatable
}

export type Layer = PathLayer | TextLayer | ImageLayer | GroupLayer | ShaderLayer;

// ---- Audio modulation ----

export type AudioFeature = "rms" | "low" | "mid" | "high" | "onset";

/**
 * The seven core targets, plus:
 *   "effect:{effectId}:{paramName}"  — numeric layer-effect param
 *   "post:{effectId}:{paramName}"    — numeric document post-FX param
 *   "shader:{paramName}"             — ShaderLayer customParams key
 *   "growthProgress"                 — scrubs GroupLayer.growthSteps (0–1)
 */
export type ModTarget = string;

export interface ModRouting {
  id: string;
  layerId: string;
  target: ModTarget;
  source: AudioFeature;
  amount: number;      // -1..1, bipolar; scaled per-target
  smoothing: number;   // 0..1 → EMA attack/release coefficient
  invert: boolean;
  /** 0–1: deterministic per-instance delay on the smoothing input, so
      repeated elements ripple instead of pulsing in unison */
  phaseOffset: number;
  /** value only ever increases (growthProgress's one-way bloom) */
  ratchet: boolean;
}

// ---- Styles (SPEC2 §12.4) ----

export interface Style {
  id: string;
  name: string;
  fill?: Fill;
  stroke?: string | null;
  strokeWidth?: number;
  effects: Effect[];
}

export interface SceneGraph {
  id: string;
  name: string;
  width: number;          // canvas px
  height: number;
  background: string;     // hex
  layers: Layer[];        // bottom-to-top render order
  routings: ModRouting[];
  palette: string[];      // extracted or user-defined swatches
  postEffects: Effect[];  // document-level, perform-mode post-processing
  styles: Style[];
  version: 2;
}

/** v1 scene shape (SPEC.md) — what the migration accepts. */
export interface SceneGraphV1 {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: unknown[];
  routings: unknown[];
  palette: string[];
  version: 1;
}
