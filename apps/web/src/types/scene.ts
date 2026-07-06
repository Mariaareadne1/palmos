export type LayerType = "path" | "text" | "image" | "group";

export interface Transform {
  x: number;        // px, relative to parent
  y: number;
  scaleX: number;   // 1 = 100%
  scaleY: number;
  rotation: number; // degrees
}

export interface BaseLayer {
  id: string;             // nanoid
  name: string;           // user-editable, e.g. "Sun circle"
  type: LayerType;
  transform: Transform;
  opacity: number;        // 0–1
  visible: boolean;
  locked: boolean;
  // zIndex is implicit: order within parent's children array
}

export interface PathLayer extends BaseLayer {
  type: "path";
  d: string;              // SVG path data — the universal vector format here
  fill: string | null;    // hex or null
  stroke: string | null;
  strokeWidth: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  align: "left" | "center" | "right";
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
}

export type Layer = PathLayer | TextLayer | ImageLayer | GroupLayer;

// ---- Audio modulation ----

export type AudioFeature = "rms" | "low" | "mid" | "high" | "onset";

export type ModTarget =
  | "x" | "y" | "scale" | "rotation" | "opacity" | "hue" | "blur";

export interface ModRouting {
  id: string;
  layerId: string;
  target: ModTarget;
  source: AudioFeature;
  amount: number;      // -1..1, bipolar; scaled per-target (see Step 4 table)
  smoothing: number;   // 0..1 → EMA attack/release coefficient
  invert: boolean;
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
  version: 1;
}
