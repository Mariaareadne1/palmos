"use client";

import { Filter, GlProgram, UniformGroup, defaultFilterVert } from "pixi.js";
import { gpuContext } from "./GpuContext";
import { shaderPreamble } from "./shaderPresets";

/**
 * Validate a user fragment against the shared WebGL2 context (SPEC2
 * §11.2): compile-on-blur, surface real GLSL errors inline, and never
 * let a bad shader crash the app. Returns the full source to run when ok.
 */
export interface CompileResult {
  ok: boolean;
  error?: string;
  fullSource?: string;
}

export function validateFragment(
  body: string,
  customParams: Record<string, number>,
): CompileResult {
  const gl = gpuContext.renderer
    ? (gpuContext.canvas?.getContext("webgl2") as WebGL2RenderingContext | null)
    : null;
  const fullSource = `${shaderPreamble(customParams)}\n${body}`;

  if (!gl) {
    // no context yet (SSR / pre-init): accept optimistically, the render
    // path will fall back to passthrough if it turns out invalid
    return { ok: true, fullSource };
  }

  const glslSource = `#version 300 es\nprecision highp float;\n${fullSource}`;
  const shader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!shader) return { ok: true, fullSource };
  gl.shaderSource(shader, glslSource);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
  const log = ok ? "" : gl.getShaderInfoLog(shader) || "compile error";
  gl.deleteShader(shader);

  if (!ok) return { ok: false, error: cleanLog(log) };
  return { ok: true, fullSource };
}

/** Trim driver noise to the first couple of meaningful error lines. */
function cleanLog(log: string): string {
  return log
    .split("\n")
    .map((l) => l.replace(/^ERROR:\s*\d+:/, "line "))
    .filter((l) => l.trim())
    .slice(0, 3)
    .join("\n");
}

/**
 * Build a Pixi Filter running a validated shader on a quad. Uniforms:
 * u_time, u_resolution, the five audio features, and each customParam.
 * Returns null if the source is invalid (caller renders passthrough).
 */
export function makeShaderFilter(
  body: string,
  customParams: Record<string, number>,
): Filter | null {
  const result = validateFragment(body, customParams);
  if (!result.ok || !result.fullSource) return null;
  const uniforms: Record<string, { value: unknown; type: string }> = {
    u_time: { value: 0, type: "f32" },
    u_resolution: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
    u_rms: { value: 0, type: "f32" },
    u_low: { value: 0, type: "f32" },
    u_mid: { value: 0, type: "f32" },
    u_high: { value: 0, type: "f32" },
    u_onset: { value: 0, type: "f32" },
  };
  for (const [k, v] of Object.entries(customParams)) {
    uniforms[k] = { value: v, type: "f32" };
  }
  try {
    return new Filter({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: result.fullSource,
        name: "palmos-shader-layer",
      }),
      resources: {
        shaderUniforms: new UniformGroup(
          uniforms as ConstructorParameters<typeof UniformGroup>[0],
        ),
      },
    });
  } catch {
    return null;
  }
}
