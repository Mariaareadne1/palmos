/**
 * Shared GLSL helpers injected into effect fragment sources. Pixi's
 * default filter varying is `vTextureCoord` and the input sampler is
 * `uTexture`; every palmós effect samples un-premultiplied color so
 * per-channel math behaves. `uTime` is fed each frame by the renderer.
 */

// simplex-ish value noise (cheap, good enough for displacement/grain)
export const NOISE_GLSL = /* glsl */ `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for(int i = 0; i < 5; i++){ v += amp * vnoise(p); p *= 2.0; amp *= 0.5; }
  return v;
}
`;

export const HEADER = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTime;
// MUST be highp to match pixi's default filter vertex shader — a bare
// \`vec4\` here trips "precisions differ between VERTEX and FRAGMENT"
uniform highp vec4 uInputSize;   // (w, h, 1/w, 1/h) of the input texture
`;

/** un-premultiply / re-premultiply wrappers used by most effects */
export const UNPREMULT = /* glsl */ `
vec3 unpremult(vec4 c){ return c.a > 0.0 ? c.rgb / c.a : c.rgb; }
`;
