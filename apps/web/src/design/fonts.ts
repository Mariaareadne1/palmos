/**
 * Design-kit fonts (SPEC2 §12.4). Fraunces is the editorial serif display
 * voice of the board; Space Grotesk a clean grotesk; the monos for quiet
 * technical type; Silkscreen for occasional bitmap moments. Literal family
 * names so canvas (Konva/Pixi) text renders them directly.
 */
export const DESIGN_FONTS = [
  "Fraunces",
  "Space Grotesk",
  "Space Mono",
  "JetBrains Mono",
  "Silkscreen",
] as const;

export type DesignFont = (typeof DESIGN_FONTS)[number];
