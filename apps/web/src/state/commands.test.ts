import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  addLayers,
  batch,
  deleteLayers,
  groupLayers,
  patchLayer,
  patchRouting,
  patchScene,
  removeRouting,
  reorderLayer,
  ungroupLayer,
  addRouting,
} from "./commands";
import type { Layer, PathLayer, SceneGraph } from "@/types/scene";
import { isSceneGraph } from "@/lib/scene-io";
import { sceneToSvg } from "@/lib/svg";
import { findLayer, flattenLayers } from "@/lib/layers";

let idCounter = 0;
const nextId = () => `id-${idCounter++}`;

function pathLayer(name: string, fill = "#111111"): PathLayer {
  return {
    id: nextId(),
    name,
    type: "path",
    transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    d: "M 0 0 H 100 V 100 H 0 Z",
    fill,
    stroke: null,
    strokeWidth: 0,
  };
}

function makeScene(layerCount = 3): SceneGraph {
  return {
    id: nextId(),
    name: "test",
    width: 800,
    height: 600,
    background: "#ffffff",
    layers: Array.from({ length: layerCount }, (_, i) =>
      pathLayer(`layer ${i}`),
    ),
    routings: [],
    palette: ["#111111"],
    version: 1,
  };
}

/** Deterministic PRNG so the property test is reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("command layer basics", () => {
  it("patchLayer applies and reverts exactly the patched keys", () => {
    const scene = makeScene();
    const target = scene.layers[1];
    const cmd = patchLayer(target.id, { name: "renamed", opacity: 0.5 });
    const next = cmd.apply(scene);
    const found = findLayer(next.layers, target.id)!;
    expect(found.name).toBe("renamed");
    expect(found.opacity).toBe(0.5);
    const back = cmd.revert(next);
    expect(back).toEqual(scene);
  });

  it("deleteLayers restores layers AND their routings on revert", () => {
    const scene = makeScene();
    const victim = scene.layers[1];
    const withRouting: SceneGraph = {
      ...scene,
      routings: [
        {
          id: "r1",
          layerId: victim.id,
          target: "scale",
          source: "rms",
          amount: 0.5,
          smoothing: 0.5,
          invert: false,
        },
      ],
    };
    const cmd = deleteLayers([victim.id]);
    const next = cmd.apply(withRouting);
    expect(findLayer(next.layers, victim.id)).toBeNull();
    expect(next.routings).toHaveLength(0);
    const back = cmd.revert(next);
    expect(findLayer(back.layers, victim.id)).toEqual(victim);
    expect(back.routings).toEqual(withRouting.routings);
    // position restored too
    expect(back.layers.findIndex((l) => l.id === victim.id)).toBe(1);
  });

  it("reorderLayer adjusts the index when moving forward in-parent", () => {
    const scene = makeScene(3);
    const [a, , c] = scene.layers;
    // move a to the end (after c)
    const cmd = reorderLayer(a.id, null, 3);
    const next = cmd.apply(scene);
    expect(next.layers.map((l) => l.id)).toEqual([
      scene.layers[1].id,
      c.id,
      a.id,
    ]);
    expect(cmd.revert(next)).toEqual(scene);
  });

  it("group/ungroup round-trips", () => {
    const scene = makeScene(3);
    const ids = [scene.layers[0].id, scene.layers[2].id];
    const group = groupLayers(ids, nextId);
    const grouped = group.apply(scene);
    expect(grouped.layers).toHaveLength(2);
    const g = grouped.layers.find((l) => l.type === "group")!;
    expect(g.type === "group" && g.children.map((c) => c.id)).toEqual(ids);
    expect(group.revert(grouped)).toEqual(scene);

    const ungroup = ungroupLayer(g.id);
    const flat = ungroup.apply(grouped);
    expect(flat.layers.find((l) => l.type === "group")).toBeUndefined();
    expect(ungroup.revert(flat)).toEqual(grouped);
  });

  it("batch reverts in reverse order", () => {
    const scene = makeScene(1);
    const id = scene.layers[0].id;
    const cmd = batch(
      [patchLayer(id, { name: "one" }), patchLayer(id, { name: "two" })],
      "rename twice",
    );
    const next = cmd.apply(scene);
    expect(findLayer(next.layers, id)!.name).toBe("two");
    expect(cmd.revert(next)).toEqual(scene);
  });

  it("routing commands round-trip", () => {
    const scene = makeScene(1);
    const routing = {
      id: "r1",
      layerId: scene.layers[0].id,
      target: "hue" as const,
      source: "low" as const,
      amount: 1,
      smoothing: 0,
      invert: false,
    };
    const add = addRouting(routing);
    const s1 = add.apply(scene);
    expect(s1.routings).toHaveLength(1);
    const patch = patchRouting("r1", { amount: -0.5, invert: true });
    const s2 = patch.apply(s1);
    expect(s2.routings[0].amount).toBe(-0.5);
    expect(patch.revert(s2)).toEqual(s1);
    const remove = removeRouting("r1");
    const s3 = remove.apply(s1);
    expect(s3.routings).toHaveLength(0);
    expect(remove.revert(s3)).toEqual(s1);
    expect(add.revert(s1)).toEqual(scene);
  });
});

describe("undo/redo property test — 20+ mixed operations", () => {
  it("applying N random commands then reverting them all restores the scene", () => {
    const rng = mulberry32(1234);
    for (let round = 0; round < 5; round++) {
      const original = makeScene(4);
      let scene = original;
      const stack: Command[] = [];

      for (let i = 0; i < 25; i++) {
        const layers = flattenLayers(scene.layers).map((e) => e.layer);
        const pick = (arr: Layer[]) => arr[Math.floor(rng() * arr.length)];
        const roll = rng();
        let cmd: Command;
        if (roll < 0.25 && layers.length) {
          cmd = patchLayer(pick(layers).id, {
            transform: {
              x: Math.round(rng() * 500),
              y: Math.round(rng() * 500),
              scaleX: 1 + rng(),
              scaleY: 1 + rng(),
              rotation: Math.round(rng() * 360),
            },
          });
        } else if (roll < 0.4 && layers.length) {
          cmd = patchLayer(pick(layers).id, {
            name: `name-${i}`,
            opacity: Math.round(rng() * 100) / 100,
          });
        } else if (roll < 0.55) {
          cmd = addLayers([
            {
              layer: pathLayer(`added ${i}`),
              parentId: null,
              index: Math.floor(rng() * (scene.layers.length + 1)),
            },
          ]);
        } else if (roll < 0.65 && scene.layers.length > 2) {
          cmd = deleteLayers([pick(scene.layers).id]);
        } else if (roll < 0.75 && scene.layers.length > 1) {
          cmd = reorderLayer(
            pick(scene.layers).id,
            null,
            Math.floor(rng() * scene.layers.length),
          );
        } else if (roll < 0.85 && scene.layers.length >= 2) {
          const ids = scene.layers.slice(0, 2).map((l) => l.id);
          cmd = groupLayers(ids, nextId);
        } else {
          cmd = patchScene({ background: `#${i}${i}${i}${i}${i}${i}`.slice(0, 7) });
        }
        scene = cmd.apply(scene);
        stack.push(cmd);
      }

      for (const cmd of [...stack].reverse()) {
        scene = cmd.revert(scene);
      }
      expect(scene).toEqual(original);
    }
  });
});

describe("scene serialization", () => {
  it("JSON round-trip preserves the graph and validates", () => {
    const scene = makeScene(3);
    const grouped = groupLayers(
      [scene.layers[0].id, scene.layers[1].id],
      nextId,
    ).apply(scene);
    const json = JSON.stringify(grouped);
    const parsed: unknown = JSON.parse(json);
    expect(isSceneGraph(parsed)).toBe(true);
    expect(parsed).toEqual(grouped);
  });

  it("sceneToSvg emits a well-formed document with all visible layers", () => {
    const scene = makeScene(2);
    const svg = sceneToSvg(scene);
    expect(svg).toContain(`viewBox="0 0 800 600"`);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain(`fill="#ffffff"`);
    // hidden layers are skipped
    const hidden = patchLayer(scene.layers[0].id, { visible: false }).apply(scene);
    expect(sceneToSvg(hidden).match(/<path /g)).toHaveLength(1);
  });
});
