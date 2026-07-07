import { registerEffect } from "./registry";
import { HEADER, NOISE_GLSL, UNPREMULT } from "./glsl";

/**
 * GPU effect suite (SPEC2 §10). Each is one GLSL fragment, live in both
 * edit previews and perform mode. Numeric params are all modulatable; the
 * registry maps `param` → uniform `u{Param}` and pushes values per frame.
 */

registerEffect({
  kind: "dither",
  name: "dither",
  class: "gpu",
  params: [
    { name: "mode", label: "mode", type: "select", options: ["bayer2", "bayer4", "bayer8", "noise"], default: "bayer4" },
    { name: "threshold", label: "threshold", type: "number", min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: "palette", label: "palette", type: "select", options: ["bw", "scene"], default: "bw" },
    { name: "pixelSize", label: "pixel size", type: "number", min: 1, max: 16, step: 1, default: 2 },
  ],
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform float uMode; uniform float uThreshold; uniform float uPalette; uniform float uPixelSize;
float bayer2(vec2 p){ int x=int(mod(p.x,2.0)); int y=int(mod(p.y,2.0)); int i=x+y*2;
  return (i==0?0.0:i==1?2.0:i==2?3.0:1.0)/4.0; }
float bayer4(vec2 p){ return bayer2(floor(p/2.0))*0.25 + bayer2(p); }
float bayer8(vec2 p){ return bayer4(floor(p/2.0))*0.25 + bayer2(p); }
float rnd(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 res = uInputSize.xy;
  vec2 px = floor(vTextureCoord*res/uPixelSize)*uPixelSize;
  vec4 c = texture(uTexture, px/res);
  vec3 rgb = unpremult(c);
  float lum = dot(rgb, vec3(0.299,0.587,0.114));
  float t;
  if(uMode<0.5) t=bayer2(px);
  else if(uMode<1.5) t=bayer4(px);
  else if(uMode<2.5) t=bayer8(px);
  else t=rnd(px);
  float on = step(uThreshold*0.5 + t*0.5, lum);
  vec3 outc = mix(vec3(0.0), vec3(1.0), on);
  if(uPalette>0.5) outc = mix(rgb*0.6, rgb, on); // "scene": keep hue, quantize value
  finalColor = vec4(outc*c.a, c.a);
}`,
});

registerEffect({
  kind: "pixelate",
  name: "pixelate",
  class: "gpu",
  params: [{ name: "size", label: "size", type: "number", min: 1, max: 64, step: 1, default: 8 }],
  fragment: /* glsl */ `${HEADER}
uniform float uSize;
void main(){
  vec2 res = uInputSize.xy;
  vec2 px = (floor(vTextureCoord*res/uSize)+0.5)*uSize;
  finalColor = texture(uTexture, px/res);
}`,
});

registerEffect({
  kind: "crt",
  name: "crt",
  class: "gpu",
  params: [
    { name: "scanlineIntensity", label: "scanlines", type: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: "scanlineCount", label: "line count", type: "number", min: 100, max: 1200, step: 10, default: 600 },
    { name: "curvature", label: "curvature", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.1 },
    { name: "aberration", label: "aberration", type: "number", min: 0, max: 0.02, step: 0.001, default: 0.004 },
    { name: "vignette", label: "vignette", type: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: "phosphorGlow", label: "phosphor", type: "number", min: 0, max: 1, step: 0.01, default: 0.2 },
  ],
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform float uScanlineIntensity; uniform float uScanlineCount; uniform float uCurvature;
uniform float uAberration; uniform float uVignette; uniform float uPhosphorGlow;
void main(){
  vec2 uv = vTextureCoord;
  vec2 cc = uv*2.0-1.0;
  cc *= 1.0 + uCurvature*dot(cc,cc)*0.5;
  vec2 wuv = cc*0.5+0.5;
  if(wuv.x<0.0||wuv.x>1.0||wuv.y<0.0||wuv.y>1.0){ finalColor=vec4(0.0); return; }
  float r = texture(uTexture, wuv+vec2(uAberration,0.0)).r;
  vec4 g4 = texture(uTexture, wuv);
  float b = texture(uTexture, wuv-vec2(uAberration,0.0)).b;
  vec3 rgb = unpremult(vec4(r, g4.g, b, max(g4.a,0.001)));
  float scan = sin(wuv.y*uScanlineCount*3.14159)*0.5+0.5;
  rgb *= 1.0 - uScanlineIntensity*scan;
  rgb += rgb*uPhosphorGlow;
  float vig = 1.0 - uVignette*dot(cc,cc);
  rgb *= clamp(vig,0.0,1.0);
  finalColor = vec4(rgb*g4.a, g4.a);
}`,
});

registerEffect({
  kind: "displace",
  name: "displace",
  class: "gpu",
  animated: true,
  params: [
    { name: "amount", label: "amount", type: "number", min: 0, max: 100, step: 1, default: 20 },
    { name: "scale", label: "scale", type: "number", min: 0.001, max: 0.05, step: 0.001, default: 0.01 },
    { name: "speed", label: "speed", type: "number", min: 0, max: 3, step: 0.05, default: 0.5 },
    { name: "mode", label: "mode", type: "select", options: ["simplex", "ridged"], default: "simplex" },
  ],
  fragment: /* glsl */ `${HEADER}${NOISE_GLSL}
uniform float uAmount; uniform float uScale; uniform float uSpeed; uniform float uMode;
void main(){
  vec2 res = uInputSize.xy;
  vec2 p = gl_FragCoord.xy*uScale + vec2(uTime*uSpeed);
  float nx = fbm(p), ny = fbm(p+vec2(37.2,17.7));
  if(uMode>0.5){ nx = abs(nx*2.0-1.0); ny = abs(ny*2.0-1.0); }
  vec2 off = (vec2(nx,ny)*2.0-1.0)*uAmount/res;
  finalColor = texture(uTexture, vTextureCoord+off);
}`,
});

registerEffect({
  kind: "distort",
  name: "distort",
  class: "gpu",
  animated: true,
  params: [
    { name: "amount", label: "amount", type: "number", min: 0, max: 0.3, step: 0.005, default: 0.05 },
    { name: "frequency", label: "frequency", type: "number", min: 1, max: 40, step: 0.5, default: 10 },
    { name: "mode", label: "mode", type: "select", options: ["wave", "twist", "bulge"], default: "wave" },
  ],
  fragment: /* glsl */ `${HEADER}
uniform float uAmount; uniform float uFrequency; uniform float uMode;
void main(){
  vec2 uv = vTextureCoord;
  vec2 c = uv-0.5;
  if(uMode<0.5){
    uv.x += sin(uv.y*uFrequency + uTime)*uAmount;
    uv.y += cos(uv.x*uFrequency + uTime)*uAmount;
  } else if(uMode<1.5){
    float a = length(c)*uFrequency*uAmount;
    float s=sin(a), co=cos(a);
    uv = 0.5 + mat2(co,-s,s,co)*c;
  } else {
    float d = length(c);
    uv = 0.5 + c*(1.0 - uAmount*(1.0-d)*uFrequency*0.1);
  }
  finalColor = texture(uTexture, uv);
}`,
});

registerEffect({
  kind: "recolorMap",
  name: "recolor map",
  class: "gpu",
  params: [
    { name: "dark", label: "dark", type: "color", default: "#1b1b3a" },
    { name: "mid", label: "mid", type: "color", default: "#d7263d" },
    { name: "light", label: "light", type: "color", default: "#f5efe0" },
    { name: "contrast", label: "contrast", type: "number", min: 0.5, max: 2, step: 0.05, default: 1 },
  ],
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform vec3 uDark; uniform vec3 uMid; uniform vec3 uLight; uniform float uContrast;
void main(){
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 rgb = unpremult(c);
  float l = dot(rgb, vec3(0.299,0.587,0.114));
  l = clamp((l-0.5)*uContrast+0.5, 0.0, 1.0);
  vec3 mapped = l<0.5 ? mix(uDark,uMid,l*2.0) : mix(uMid,uLight,(l-0.5)*2.0);
  finalColor = vec4(mapped*c.a, c.a);
}`,
});

registerEffect({
  kind: "grain",
  name: "grain",
  class: "gpu",
  animated: true,
  params: [
    { name: "amount", label: "amount", type: "number", min: 0, max: 1, step: 0.01, default: 0.15 },
    { name: "size", label: "size", type: "number", min: 1, max: 8, step: 0.5, default: 1.5 },
    { name: "animated", label: "animated", type: "boolean", default: true },
  ],
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform float uAmount; uniform float uSize; uniform float uAnimated;
float rnd(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 seed = floor(gl_FragCoord.xy/uSize) + (uAnimated>0.5 ? vec2(uTime*37.0) : vec2(0.0));
  float g = (rnd(seed)-0.5)*uAmount;
  vec3 rgb = unpremult(c) + g;
  finalColor = vec4(clamp(rgb,0.0,1.0)*c.a, c.a);
}`,
});

registerEffect({
  kind: "glow",
  name: "glow",
  class: "gpu",
  params: [
    { name: "color", label: "color", type: "color", default: "#ff9de2" },
    { name: "intensity", label: "intensity", type: "number", min: 0, max: 3, step: 0.05, default: 1 },
    { name: "spread", label: "spread", type: "number", min: 0, max: 20, step: 0.5, default: 6 },
    { name: "threshold", label: "threshold", type: "number", min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  // bright-pass → radial multi-tap gaussian → additive composite (§10)
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform vec3 uColor; uniform float uIntensity; uniform float uSpread; uniform float uThreshold;
void main(){
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 texel = uInputSize.zw * uSpread;
  vec3 bloom = vec3(0.0); float wsum = 0.0;
  for(int i=-4;i<=4;i++){
    for(int j=-4;j<=4;j++){
      vec2 o = vec2(float(i),float(j));
      float w = exp(-dot(o,o)*0.2);
      vec4 s = texture(uTexture, vTextureCoord + o*texel);
      vec3 rgb = unpremult(s);
      float l = dot(rgb, vec3(0.299,0.587,0.114));
      float bright = max(0.0, l - uThreshold) * s.a;
      bloom += bright * w;
      wsum += w;
    }
  }
  bloom /= max(wsum, 0.001);
  vec3 base = unpremult(c);
  vec3 outc = base + uColor * bloom * uIntensity;
  float a = max(c.a, bloom.r>0.0 ? min(1.0, bloom.r*uIntensity) : c.a);
  finalColor = vec4(clamp(outc,0.0,1.0)*a, a);
}`,
});

registerEffect({
  kind: "levels",
  name: "levels",
  class: "gpu",
  params: [
    { name: "blackPoint", label: "black", type: "number", min: 0, max: 1, step: 0.01, default: 0 },
    { name: "whitePoint", label: "white", type: "number", min: 0, max: 1, step: 0.01, default: 1 },
    { name: "gamma", label: "gamma", type: "number", min: 0.1, max: 3, step: 0.05, default: 1 },
    { name: "blur", label: "blur", type: "number", min: 0, max: 10, step: 0.5, default: 0 },
  ],
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform float uBlackPoint; uniform float uWhitePoint; uniform float uGamma; uniform float uBlur;
void main(){
  vec2 texel = uInputSize.zw * uBlur;
  vec4 c = uBlur>0.01
    ? (texture(uTexture,vTextureCoord)
       + texture(uTexture,vTextureCoord+vec2(texel.x,0.0))
       + texture(uTexture,vTextureCoord-vec2(texel.x,0.0))
       + texture(uTexture,vTextureCoord+vec2(0.0,texel.y))
       + texture(uTexture,vTextureCoord-vec2(0.0,texel.y)))/5.0
    : texture(uTexture,vTextureCoord);
  vec3 rgb = unpremult(c);
  rgb = clamp((rgb - uBlackPoint)/max(uWhitePoint-uBlackPoint,0.001), 0.0, 1.0);
  rgb = pow(rgb, vec3(1.0/uGamma));
  finalColor = vec4(rgb*c.a, c.a);
}`,
});

registerEffect({
  kind: "scanSlice",
  name: "scan slice",
  class: "gpu",
  animated: true,
  params: [
    { name: "slices", label: "slices", type: "number", min: 2, max: 60, step: 1, default: 16 },
    { name: "offset", label: "offset", type: "number", min: 0, max: 0.5, step: 0.005, default: 0.05 },
    { name: "direction", label: "direction", type: "select", options: ["horizontal", "vertical"], default: "horizontal" },
  ],
  fragment: /* glsl */ `${HEADER}
uniform float uSlices; uniform float uOffset; uniform float uDirection;
float rnd(float n){ return fract(sin(n*12.9898)*43758.5453); }
void main(){
  vec2 uv = vTextureCoord;
  if(uDirection<0.5){
    float row = floor(uv.y*uSlices);
    uv.x += (rnd(row+floor(uTime*4.0))*2.0-1.0)*uOffset;
  } else {
    float col = floor(uv.x*uSlices);
    uv.y += (rnd(col+floor(uTime*4.0))*2.0-1.0)*uOffset;
  }
  finalColor = texture(uTexture, fract(uv));
}`,
});

registerEffect({
  kind: "riso",
  name: "riso",
  class: "gpu",
  animated: true,
  params: [
    { name: "inkColor", label: "ink", type: "color", default: "#2f4bff" },
    { name: "paperColor", label: "paper", type: "color", default: "#f5efe0" },
    { name: "misregistration", label: "misreg", type: "number", min: 0, max: 20, step: 0.5, default: 4 },
    { name: "grainAmount", label: "grain", type: "number", min: 0, max: 1, step: 0.01, default: 0.15 },
    { name: "layers", label: "inks", type: "number", min: 1, max: 3, step: 1, default: 2 },
  ],
  // duotone/tritone remap + per-channel offset (misregistration) + paper grain
  fragment: /* glsl */ `${HEADER}${UNPREMULT}
uniform vec3 uInkColor; uniform vec3 uPaperColor; uniform float uMisregistration;
uniform float uGrainAmount; uniform float uLayers;
float rnd(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
vec3 ink2(vec3 a){ return vec3(a.r*0.6+a.g*0.3, a.g*0.7, a.b*0.6+a.r*0.3); }
void main(){
  vec2 mo = uInputSize.zw * uMisregistration;
  float l1 = dot(unpremult(texture(uTexture, vTextureCoord+mo)), vec3(0.299,0.587,0.114));
  float l2 = dot(unpremult(texture(uTexture, vTextureCoord-mo)), vec3(0.299,0.587,0.114));
  vec4 base = texture(uTexture, vTextureCoord);
  float ink1 = 1.0 - l1;
  vec3 col = mix(uPaperColor, uInkColor, ink1);
  if(uLayers>1.5){
    vec3 ink2c = ink2(uInkColor);
    float ink2v = 1.0 - l2;
    col = mix(col, ink2c, ink2v*0.5);
  }
  float g = (rnd(gl_FragCoord.xy + vec2(uTime*13.0))-0.5)*uGrainAmount;
  col = clamp(col + g, 0.0, 1.0);
  float a = max(base.a, ink1);
  finalColor = vec4(col*a, a);
}`,
});
