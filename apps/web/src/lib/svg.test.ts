import { describe, expect, it } from "vitest";
import { sceneToSvg } from "./svg";
import { createShapeLayer, createTextLayer } from "./shapes";
import type { GroupLayer, Layer, SceneGraph } from "@/types/scene";

function scene(layers: Layer[]): SceneGraph {
  return {
    id: "s1",
    name: "test",
    width: 800,
    height: 600,
    background: "#f2ede4",
    layers,
    routings: [],
    palette: [],
    postEffects: [],
    styles: [],
    version: 2,
  };
}

describe("sceneToSvg", () => {
  it("emits a well-formed svg header and background rect", () => {
    const out = sceneToSvg(scene([]));
    expect(out).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="800"');
    expect(out).toContain('viewBox="0 0 800 600"');
    expect(out).toContain('<rect width="800" height="600" fill="#f2ede4"/>');
    expect(out.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("renders a visible path layer", () => {
    const out = sceneToSvg(
      scene([createShapeLayer("rect", 0, 0, 120, 80, "#e63946", "r")]),
    );
    expect(out).toContain("<path");
    expect(out).toContain('fill="#e63946"');
    expect(out).toContain("H 120");
  });

  it("omits invisible layers", () => {
    const hidden: Layer = {
      ...createShapeLayer("rect", 0, 0, 999, 12, "#000", "hidden"),
      visible: false,
    };
    const out = sceneToSvg(scene([hidden]));
    expect(out).not.toContain("H 999");
  });

  it("escapes special characters in text", () => {
    const text: Layer = {
      ...createTextLayer(0, 0, "#000"),
      text: '<tag> & "quote"',
    };
    const out = sceneToSvg(scene([text]));
    expect(out).toContain("&lt;tag&gt; &amp; &quot;quote&quot;");
    expect(out).not.toContain("<tag>");
  });

  it("nests group children inside a <g>", () => {
    const group: GroupLayer = {
      id: "g1",
      name: "grp",
      type: "group",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      effects: [],
      children: [createShapeLayer("rect", 0, 0, 33, 33, "#2a9d8f", "child")],
    };
    const out = sceneToSvg(scene([group]));
    expect(out).toContain("<g");
    expect(out).toContain("</g>");
    expect(out).toContain("H 33");
  });
});
