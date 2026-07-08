import { registerEffect } from "./registry";
import { HEADER, NOISE_GLSL, UNPREMULT } from "./glsl";

/**
 * Document post-FX (SPEC2 §11.1): full-frame GPU passes over the
 * composited perform-mode output. Most are ordinary one-pass Filters
 * registered here; `feedback` is special — it needs ping-pong render
 * targets and is implemented in the renderer (FeedbackPass), but its
 * params are still declared here so the UI + mod matrix see it.
 */

registerEffect({
  kind: "bloom",
  name: "bloom",
  class: "gpu",
  params: [
    { name: "threshold", label: "threshold", type: "number", min: 0, max: 1, step: 0.01, default: 0.6 },
    { name: "intensity", label: "intensity", type: "number", min: 0, max: 3, step: 0.05, default: 1 },
    { name: "radius", label: "radius", type: "number", min: 1, max: 24, step: 0.5, default: 8 },
  ],
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform float uThreshold; uniform float uIntensity; uniform float uRadius;
void main(){
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 texel = uInputSize.zw * uRadius;
  vec3 bloom = vec3(0.0); float wsum = 0.0;
  for(int i=-4;i<=4;i++) for(int j=-4;j<=4;j++){
    vec2 o = vec2(float(i),float(j));
    float w = exp(-dot(o,o)*0.2);
    vec3 s = unpremult(texture(uTexture, vTextureCoord + o*texel));
    float l = dot(s, vec3(0.299,0.587,0.114));
    bloom += max(vec3(0.0), s - uThreshold) * step(uThreshold, l) * w;
    wsum += w;
  }
  bloom /= max(wsum, 0.001);
  vec3 base = unpremult(c);
  finalColor = vec4((base + bloom*uIntensity)*c.a, c.a);
}`,
});

// feedback: params only — FeedbackPass in the renderer does the ping-pong
registerEffect({
  kind: "feedback",
  name: "feedback",
  class: "gpu",
  params: [
    { name: "decay", label: "decay", type: "number", min: 0.5, max: 0.98, step: 0.01, default: 0.9 },
    { name: "zoom", label: "zoom", type: "number", min: 0.9, max: 1.1, step: 0.001, default: 1.01 },
    { name: "rotate", label: "rotate", type: "number", min: -5, max: 5, step: 0.05, default: 0 },
    { name: "offsetX", label: "offset x", type: "number", min: -20, max: 20, step: 0.5, default: 0 },
    { name: "offsetY", label: "offset y", type: "number", min: -20, max: 20, step: 0.5, default: 0 },
    { name: "hueShift", label: "hue shift", type: "number", min: -30, max: 30, step: 0.5, default: 0 },
  ],
  // this fragment composites the previous (fed-back) frame — supplied as
  // uTexture — over the new frame; the renderer swaps targets each frame
  fragment: /* glsl */ `${HEADER}
uniform float uDecay; uniform float uZoom; uniform float uRotate;
uniform float uOffsetX; uniform float uOffsetY; uniform float uHueShift;
vec3 hueRotate(vec3 c, float deg){
  float a = radians(deg);
  float s = sin(a), co = cos(a);
  mat3 m = mat3(0.299,0.587,0.114, 0.299,0.587,0.114, 0.299,0.587,0.114)
    + co*mat3(0.701,-0.587,-0.114, -0.299,0.413,-0.114, -0.300,-0.588,0.886)
    + s*mat3(0.168,0.330,-0.497, -0.328,0.035,0.292, 1.250,-1.050,-0.203);
  return clamp(m*c, 0.0, 1.0);
}
void main(){
  vec2 uv = vTextureCoord;
  vec2 c = uv - 0.5;
  float s = sin(radians(uRotate)), co = cos(radians(uRotate));
  c = mat2(co,-s,s,co) * c / uZoom;
  vec2 prevUv = c + 0.5 + uInputSize.zw*vec2(uOffsetX,uOffsetY);
  vec4 prev = texture(uTexture, prevUv);
  prev.rgb = hueRotate(prev.rgb, uHueShift) * uDecay;
  finalColor = prev;
}`,
});

registerEffect({
  kind: "chromaticAberration",
  name: "chromatic aberration",
  class: "gpu",
  params: [
    { name: "amount", label: "amount", type: "number", min: 0, max: 0.05, step: 0.001, default: 0.006 },
    { name: "radial", label: "radial", type: "boolean", default: true },
  ],
  fragment: /* glsl */ `${HEADER}
uniform float uAmount; uniform float uRadial;
void main(){
  vec2 uv = vTextureCoord;
  vec2 dir = uRadial>0.5 ? (uv-0.5) : vec2(1.0,0.0);
  float r = texture(uTexture, uv + dir*uAmount).r;
  float g = texture(uTexture, uv).g;
  float b = texture(uTexture, uv - dir*uAmount).b;
  float a = texture(uTexture, uv).a;
  finalColor = vec4(r,g,b,a);
}`,
});

registerEffect({
  kind: "kaleido",
  name: "kaleidoscope",
  class: "gpu",
  params: [
    { name: "segments", label: "segments", type: "number", min: 2, max: 24, step: 1, default: 6 },
    { name: "angle", label: "angle", type: "number", min: 0, max: 360, step: 1, default: 0 },
  ],
  fragment: /* glsl */ `${HEADER}
uniform float uSegments; uniform float uAngle;
void main(){
  vec2 c = vTextureCoord - 0.5;
  float r = length(c);
  float a = atan(c.y, c.x) + radians(uAngle);
  float seg = 6.28318 / uSegments;
  a = mod(a, seg);
  a = abs(a - seg*0.5);
  vec2 uv = vec2(cos(a), sin(a))*r + 0.5;
  finalColor = texture(uTexture, clamp(uv,0.0,1.0));
}`,
});

registerEffect({
  kind: "noiseWarp",
  name: "noise warp",
  class: "gpu",
  animated: true,
  params: [
    { name: "amount", label: "amount", type: "number", min: 0, max: 0.1, step: 0.002, default: 0.02 },
    { name: "scale", label: "scale", type: "number", min: 1, max: 20, step: 0.5, default: 6 },
    { name: "speed", label: "speed", type: "number", min: 0, max: 2, step: 0.05, default: 0.3 },
  ],
  fragment: /* glsl */ `${HEADER}${NOISE_GLSL}
uniform float uAmount; uniform float uScale; uniform float uSpeed;
void main(){
  vec2 uv = vTextureCoord;
  float nx = fbm(uv*uScale + vec2(uTime*uSpeed));
  float ny = fbm(uv*uScale + vec2(5.2,1.3) + vec2(uTime*uSpeed));
  finalColor = texture(uTexture, uv + (vec2(nx,ny)*2.0-1.0)*uAmount);
}`,
});

registerEffect({
  kind: "vignette",
  name: "vignette",
  class: "gpu",
  params: [
    { name: "amount", label: "amount", type: "number", min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: "softness", label: "softness", type: "number", min: 0.1, max: 1.5, step: 0.05, default: 0.6 },
    { name: "color", label: "color", type: "color", default: "#000000" },
  ],
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform float uAmount; uniform float uSoftness; uniform vec3 uColor;
void main(){
  vec4 c = texture(uTexture, vTextureCoord);
  float d = distance(vTextureCoord, vec2(0.5));
  float v = smoothstep(0.75, 0.75 - uSoftness, d);
  vec3 base = unpremult(c);
  vec3 outc = mix(uColor, base, mix(1.0, v, uAmount));
  finalColor = vec4(outc*c.a, c.a);
}`,
});

/** feedback is a real post-fx but needs the renderer's ping-pong pass. */
export const FEEDBACK_KIND = "feedback";
