import { describe, expect, it } from "vitest";
import { isSceneGraph, normalizeScene } from "./scene-io";

const validV2 = {
  id: "s1",
  name: "poster",
  width: 800,
  height: 600,
  background: "#f2ede4",
  layers: [],
  routings: [],
  palette: ["#000000"],
  postEffects: [],
  styles: [],
  version: 2,
};

const validV1 = {
  id: "old",
  name: "legacy",
  width: 400,
  height: 300,
  background: "#ffffff",
  layers: [],
  routings: [],
  palette: [],
  version: 1,
};

describe("isSceneGraph", () => {
  it("accepts a valid v2 scene", () => {
    expect(isSceneGraph(validV2)).toBe(true);
  });

  it("accepts a valid v1 scene", () => {
    expect(isSceneGraph(validV1)).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isSceneGraph(null)).toBe(false);
    expect(isSceneGraph("nope")).toBe(false);
    expect(isSceneGraph(42)).toBe(false);
  });

  it("rejects an object missing required fields", () => {
    const noPalette: Record<string, unknown> = { ...validV2 };
    delete noPalette.palette;
    expect(isSceneGraph(noPalette)).toBe(false);
  });

  it("rejects an unsupported version", () => {
    expect(isSceneGraph({ ...validV2, version: 3 })).toBe(false);
  });

  it("rejects when a field has the wrong type", () => {
    expect(isSceneGraph({ ...validV2, width: "800" })).toBe(false);
  });
});

describe("normalizeScene", () => {
  it("returns a v2 scene unchanged in version", () => {
    const result = normalizeScene(validV2);
    expect(result.version).toBe(2);
    expect(result.id).toBe("s1");
  });

  it("migrates a v1 scene up to v2", () => {
    const result = normalizeScene(validV1);
    expect(result.version).toBe(2);
  });

  it("throws on a structurally invalid scene", () => {
    expect(() => normalizeScene({ foo: "bar" })).toThrow();
  });
});
