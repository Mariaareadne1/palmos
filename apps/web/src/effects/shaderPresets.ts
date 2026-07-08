/**
 * Starter fragment-shader presets for the custom GLSL layer (SPEC2 §11.2).
 * Auto-injected uniforms (documented in the editor help popover):
 *   u_time, u_resolution, u_rms, u_low, u_mid, u_high, u_onset,
 *   plus every key of the layer's customParams (each a 0–1 slider,
 *   modulatable like any effect param).
 *
 * Author fragments as plain GLSL ES 3.0 bodies that write `finalColor`
 * and read `vUV` (0–1). The renderer wraps them with the varying/uniform
 * preamble, so presets stay short and legible.
 */

export interface ShaderPreset {
  name: string;
  fragment: string;
  customParams: Record<string, number>;
}

export const SHADER_PRESETS: Record<string, ShaderPreset> = {
  plasma: {
    name: "plasma",
    customParams: { warp: 0.5 },
    fragment: `
void main() {
  vec2 p = vUV * 6.0;
  float t = u_time * 0.5;
  float v = sin(p.x + t) + sin(p.y + t)
          + sin(p.x + p.y + t) + sin(length(p) + t*(1.0 + warp));
  vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + v + u_low*3.0);
  finalColor = vec4(col, 1.0);
}`,
  },
  rings: {
    name: "rings",
    customParams: { count: 0.5 },
    fragment: `
void main() {
  vec2 c = vUV - 0.5;
  float d = length(c);
  float rings = 6.0 + count*30.0;
  float pulse = 0.5 + 0.5*sin(d*rings - u_time*3.0 - u_low*8.0);
  vec3 col = mix(vec3(0.05,0.05,0.1), vec3(0.6,0.8,1.0), pulse);
  finalColor = vec4(col, 1.0);
}`,
  },
  flowfield: {
    name: "flowfield",
    customParams: { speed: 0.4 },
    fragment: `
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}
void main() {
  vec2 p = vUV*4.0;
  float t = u_time*(0.2 + speed);
  float n = noise(p + t) + 0.5*noise(p*2.0 - t);
  float a = n*6.2831 + u_mid*6.0;
  float flow = 0.5 + 0.5*sin(a + p.x*3.0);
  vec3 col = mix(vec3(0.1,0.0,0.2), vec3(1.0,0.4,0.8), flow);
  finalColor = vec4(col, 1.0);
}`,
  },
  starburst: {
    name: "starburst rays",
    customParams: { rays: 0.5 },
    fragment: `
void main() {
  vec2 c = vUV - 0.5;
  float a = atan(c.y, c.x);
  float n = 6.0 + rays*36.0;
  float r = 0.5 + 0.5*sin(a*n + u_time*2.0);
  float glow = smoothstep(0.6, 0.0, length(c)) * (0.5 + u_high);
  vec3 col = vec3(r*glow, r*glow*0.6, glow);
  finalColor = vec4(col, 1.0);
}`,
  },
};

/** The preamble the renderer prepends to a user fragment. */
export function shaderPreamble(customParams: Record<string, number>): string {
  const params = Object.keys(customParams)
    .map((k) => `uniform float ${k};`)
    .join("\n");
  return `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_rms;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_onset;
${params}
#define vUV vTextureCoord
`;
}
