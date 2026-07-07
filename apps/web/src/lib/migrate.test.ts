import { describe, expect, it } from "vitest";
import { migrateScene } from "./migrate";
import { isSceneGraph, normalizeScene } from "./scene-io";

/** A minimal v1 scene as SPEC.md's reconstruction service would emit. */
const v1 = {
  id: "abc",
  name: "old poster",
  width: 800,
  height: 600,
  background: "#f2ede4",
  layers: [
    {
      id: "l1",
      name: "red shape",
      type: "path",
      transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      d: "M 0 0 H 100 V 100 H 0 Z",
      fill: "#e63946",
      stroke: null,
      strokeWidth: 0,
    },
    {
      id: "g1",
      name: "group",
      type: "group",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      children: [
        {
          id: "t1",
          name: "title",
          type: "text",
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          opacity: 1,
          visible: true,
          locked: false,
          text: "hi",
          fontFamily: "Inter",
          fontSize: 32,
          fontWeight: 400,
          fill: "#0a0a0a",
          align: "left",
        },
      ],
    },
  ],
  routings: [
    {
      id: "r1",
      layerId: "l1",
      target: "scale",
      source: "rms",
      amount: 0.5,
      smoothing: 0.5,
      invert: false,
    },
  ],
  palette: ["#e63946", "#f2ede4"],
  version: 1,
};

describe("v1 → v2 migration", () => {
  it("accepts a v1 scene as a valid graph", () => {
    expect(isSceneGraph(v1)).toBe(true);
  });

  it("adds empty effects to every layer (recursively)", () => {
    const v2 = migrateScene(v1);
    expect(v2.version).toBe(2);
    expect(v2.layers[0].effects).toEqual([]);
    const group = v2.layers[1];
    expect(group.type === "group" && group.children[0].effects).toEqual([]);
  });

  it("adds postEffects, styles, and routing phase/ratchet defaults", () => {
    const v2 = migrateScene(v1);
    expect(v2.postEffects).toEqual([]);
    expect(v2.styles).toEqual([]);
    expect(v2.routings[0].phaseOffset).toBe(0);
    expect(v2.routings[0].ratchet).toBe(false);
  });

  it("backfills text letterSpacing / strokeOnly", () => {
    const v2 = migrateScene(v1);
    const group = v2.layers[1];
    const text = group.type === "group" ? group.children[0] : null;
    expect(text?.type === "text" && text.letterSpacing).toBe(0);
    expect(text?.type === "text" && text.strokeOnly).toBe(false);
  });

  it("preserves existing content unchanged", () => {
    const v2 = migrateScene(v1);
    expect(v2.name).toBe("old poster");
    expect(v2.layers[0].type === "path" && v2.layers[0].fill).toBe("#e63946");
    expect(v2.palette).toEqual(["#e63946", "#f2ede4"]);
  });

  it("is idempotent on an already-v2 scene", () => {
    const once = normalizeScene(v1);
    const twice = normalizeScene(once);
    expect(twice).toEqual(once);
  });
});
