import { describe, expect, it } from "vitest";
import {
  createShapeLayer,
  createTextLayer,
  ellipsePath,
  rectPath,
} from "./shapes";

describe("rectPath", () => {
  it("draws a closed rectangle from the origin", () => {
    expect(rectPath(100, 50)).toBe("M 0 0 H 100 V 50 H 0 Z");
  });
});

describe("ellipsePath", () => {
  it("draws two arcs around the bbox center", () => {
    expect(ellipsePath(100, 50)).toBe(
      "M 0 25 A 50 25 0 1 0 100 25 A 50 25 0 1 0 0 25 Z",
    );
  });
});

describe("createShapeLayer", () => {
  it("builds a rect path layer with the given geometry and fill", () => {
    const layer = createShapeLayer("rect", 10, 20, 100, 50, "#e63946", "box");
    expect(layer.type).toBe("path");
    expect(layer.name).toBe("box");
    expect(layer.transform).toEqual({
      x: 10,
      y: 20,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });
    expect(layer.d).toBe(rectPath(100, 50));
    expect(layer.fill).toBe("#e63946");
    expect(layer.stroke).toBeNull();
    expect(layer.strokeWidth).toBe(0);
    expect(layer.opacity).toBe(1);
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);
    expect(layer.effects).toEqual([]);
    expect(layer.id).toBeTruthy();
  });

  it("uses the ellipse path for the ellipse kind", () => {
    const layer = createShapeLayer("ellipse", 0, 0, 80, 40, "#000", "e");
    expect(layer.d).toBe(ellipsePath(80, 40));
  });

  it("gives each layer a unique id", () => {
    const a = createShapeLayer("rect", 0, 0, 1, 1, "#000", "a");
    const b = createShapeLayer("rect", 0, 0, 1, 1, "#000", "b");
    expect(a.id).not.toBe(b.id);
  });
});

describe("createTextLayer", () => {
  it("builds a text layer with sensible defaults", () => {
    const layer = createTextLayer(5, 6, "#123456");
    expect(layer.type).toBe("text");
    expect(layer.text).toBe("text");
    expect(layer.fontFamily).toBe("Space Mono");
    expect(layer.fontSize).toBe(32);
    expect(layer.fontWeight).toBe(400);
    expect(layer.fill).toBe("#123456");
    expect(layer.align).toBe("left");
    expect(layer.letterSpacing).toBe(0);
    expect(layer.strokeOnly).toBe(false);
    expect(layer.transform.x).toBe(5);
    expect(layer.transform.y).toBe(6);
  });
});
