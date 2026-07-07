"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Konva from "konva";
import {
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer as KonvaLayer,
  Path,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ImageLayer, Layer, PathLayer, TextLayer } from "@/types/scene";
import { useAppStore } from "@/state/store";
import { batch, patchLayer, addLayers } from "@/state/commands";
import { findLayer } from "@/lib/layers";
import { createShapeLayer, createTextLayer } from "@/lib/shapes";
import { konvaFillProps } from "@/lib/fill";
import { stageRegistry } from "@/editor/stageRegistry";
import { useHtmlImage } from "@/editor/useHtmlImage";
import { useEffectPreviews } from "@/editor/useEffectPreviews";
import { useBakeHandler } from "@/editor/useBakeHandler";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_FACTOR = 1.08;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function normBox(x1: number, y1: number, x2: number, y2: number): Box {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- layer renderers ----------

function ImageNode({
  layer,
  common,
}: {
  layer: ImageLayer;
  common: Record<string, unknown>;
}) {
  const img = useHtmlImage(layer.src);
  if (!img) return null;
  return (
    <KonvaImage image={img} width={layer.width} height={layer.height} {...common} />
  );
}

/** Approx self-rect for gradient placement, before transform. */
function pathBBox(d: string): { x: number; y: number; width: number; height: number } {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

function PathNode({
  layer,
  common,
}: {
  layer: PathLayer;
  common: Record<string, unknown>;
}) {
  const bbox = pathBBox(layer.d);
  const fillProps = konvaFillProps(layer.fill, bbox);
  return (
    <Path
      data={layer.d}
      stroke={layer.stroke ?? undefined}
      strokeWidth={layer.stroke ? layer.strokeWidth : 0}
      {...fillProps}
      {...common}
    />
  );
}

function TextNode({
  layer,
  common,
}: {
  layer: TextLayer;
  common: Record<string, unknown>;
}) {
  const solid =
    typeof layer.fill === "string"
      ? layer.fill
      : layer.fill && "stops" in layer.fill
        ? layer.fill.stops[0]?.color ?? "#000000"
        : "#000000";
  return (
    <Text
      text={layer.text}
      fontFamily={layer.fontFamily}
      fontSize={layer.fontSize}
      fontStyle={layer.fontWeight >= 600 ? "bold" : "normal"}
      fill={layer.strokeOnly ? undefined : solid}
      stroke={layer.strokeOnly ? solid : undefined}
      strokeWidth={layer.strokeOnly ? 1 : 0}
      letterSpacing={layer.letterSpacing}
      align={layer.align}
      {...common}
    />
  );
}

function LayerNode({ layer }: { layer: Layer }) {
  const common = {
    id: layer.id,
    x: layer.transform.x,
    y: layer.transform.y,
    scaleX: layer.transform.scaleX,
    scaleY: layer.transform.scaleY,
    rotation: layer.transform.rotation,
    opacity: layer.opacity,
    visible: layer.visible,
    listening: !layer.locked,
  };
  switch (layer.type) {
    case "path":
      return <PathNode layer={layer} common={common} />;
    case "text":
      return <TextNode layer={layer} common={common} />;
    case "image":
      return <ImageNode layer={layer} common={common} />;
    case "shader":
      // GPU quad: previews as a hairline placeholder rect in edit mode
      return (
        <Rect
          width={layer.width}
          height={layer.height}
          stroke="#0a0a0a"
          strokeWidth={1}
          dash={[4, 4]}
          {...common}
        />
      );
    case "group":
      return (
        <Group {...common}>
          {layer.children.map((child) => (
            <LayerNode key={child.id} layer={child} />
          ))}
        </Group>
      );
  }
}

// ---------- the canvas ----------

export default function EditorCanvas() {
  const scene = useAppStore((s) => s.scene);
  const selectedIds = useAppStore((s) => s.selectedLayerIds);
  const tool = useAppStore((s) => s.tool);
  const viewport = useAppStore((s) => s.viewport);
  const dispatch = useAppStore((s) => s.dispatch);
  const setSelected = useAppStore((s) => s.setSelected);
  const setTool = useAppStore((s) => s.setTool);
  const setViewport = useAppStore((s) => s.setViewport);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const [interacting, setInteracting] = useState(false);

  // GPU effect previews (edit mode) + bake-to-layers handler (SPEC2 §9)
  const previews = useEffectPreviews(stageRef, scene, interacting);
  useBakeHandler(stageRef);

  const fittedRef = useRef(false);
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // --- container sizing ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // --- initial fit: center artboard at a comfortable zoom ---
  useEffect(() => {
    if (fittedRef.current || size.w === 0 || size.h === 0) return;
    fittedRef.current = true;
    const scale = Math.min(
      (size.w - 96) / scene.width,
      (size.h - 96) / scene.height,
      1,
    );
    setViewport({
      x: (size.w - scene.width * scale) / 2,
      y: (size.h - scene.height * scale) / 2,
      scale,
    });
  }, [size, scene.width, scene.height, setViewport]);

  // --- stage registry for export-png ---
  useEffect(() => {
    stageRegistry.current = stageRef.current;
    return () => {
      stageRegistry.current = null;
    };
  }, []);

  // --- space key for panning ---
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
        return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // --- transformer attachment ---
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;
    const nodes = selectedIds
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is Konva.Node => n !== undefined && n !== null);
    tr.nodes(nodes);
  }, [selectedIds, scene]);

  const toWorld = useCallback(
    (p: { x: number; y: number }) => ({
      x: (p.x - viewport.x) / viewport.scale,
      y: (p.y - viewport.y) / viewport.scale,
    }),
    [viewport],
  );

  // --- zoom (cursor-centered) ---
  const onWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const old = viewport.scale;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, e.evt.deltaY > 0 ? old / ZOOM_FACTOR : old * ZOOM_FACTOR),
      );
      const world = toWorld(pointer);
      setViewport({
        x: pointer.x - world.x * next,
        y: pointer.y - world.y * next,
        scale: next,
      });
    },
    [viewport, toWorld, setViewport],
  );

  /** Top-level ancestor id of a clicked Konva node (canvas selects roots). */
  const topLevelIdOf = useCallback(
    (node: Konva.Node): string | null => {
      let current: Konva.Node | null = node;
      let candidate: string | null = null;
      while (current && current !== stageRef.current) {
        const id = current.id();
        if (id && scene.layers.some((l) => l.id === id)) candidate = id;
        current = current.getParent();
      }
      return candidate;
    },
    [scene.layers],
  );

  // --- pointer handlers ---
  const onMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // pan: space+drag or middle mouse
      if (spaceDown || e.evt.button === 1) {
        e.evt.preventDefault();
        panRef.current = {
          px: pointer.x,
          py: pointer.y,
          vx: viewport.x,
          vy: viewport.y,
        };
        return;
      }
      if (e.evt.button !== 0) return;

      const world = toWorld(pointer);

      if (tool === "rect" || tool === "ellipse") {
        gestureStartRef.current = world;
        setDraft({ x: world.x, y: world.y, w: 0, h: 0 });
        return;
      }
      if (tool === "text") {
        const layer = createTextLayer(world.x, world.y, scene.palette[0] ?? "#0a0a0a");
        dispatch(addLayers([{ layer, parentId: null, index: scene.layers.length }], "add text"));
        setSelected([layer.id]);
        setTool("select");
        return;
      }

      // select tool
      const onEmpty =
        e.target === stage || e.target.name() === "artboard";
      if (onEmpty) {
        gestureStartRef.current = world;
        setMarquee({ x: world.x, y: world.y, w: 0, h: 0 });
        return;
      }
      const id = topLevelIdOf(e.target);
      if (!id) return;
      if (e.evt.shiftKey) {
        setSelected(
          selectedIds.includes(id)
            ? selectedIds.filter((s) => s !== id)
            : [...selectedIds, id],
        );
      } else if (!selectedIds.includes(id)) {
        setSelected([id]);
      }
    },
    [spaceDown, viewport, tool, toWorld, scene, dispatch, setSelected, setTool, selectedIds, topLevelIdOf],
  );

  const onMouseMove = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    if (panRef.current) {
      setViewport({
        x: panRef.current.vx + (pointer.x - panRef.current.px),
        y: panRef.current.vy + (pointer.y - panRef.current.py),
        scale: viewport.scale,
      });
      return;
    }
    const start = gestureStartRef.current;
    if (!start) return;
    const world = toWorld(pointer);
    const box = normBox(start.x, start.y, world.x, world.y);
    if (marquee) setMarquee(box);
    if (draft) setDraft(box);
  }, [viewport.scale, toWorld, marquee, draft, setViewport]);

  const onMouseUp = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      panRef.current = null;

      if (marquee && stage) {
        gestureStartRef.current = null;
        if (marquee.w < 3 && marquee.h < 3) {
          // plain click on empty space: deselect
          if (!e.evt.shiftKey) setSelected([]);
        } else {
          const hits = scene.layers
            .filter((l) => l.visible && !l.locked)
            .filter((l) => {
              const node = stage.findOne(`#${l.id}`);
              if (!node) return false;
              const r = node.getClientRect({ relativeTo: stage as unknown as Konva.Container });
              return boxesIntersect(marquee, { x: r.x, y: r.y, w: r.width, h: r.height });
            })
            .map((l) => l.id);
          setSelected(
            e.evt.shiftKey ? [...new Set([...selectedIds, ...hits])] : hits,
          );
        }
        setMarquee(null);
        return;
      }

      if (draft) {
        gestureStartRef.current = null;
        if (draft.w >= 3 && draft.h >= 3) {
          const kind = tool === "ellipse" ? "ellipse" : "rect";
          const count =
            scene.layers.filter((l) => l.type === "path").length + 1;
          const layer = createShapeLayer(
            kind,
            draft.x,
            draft.y,
            draft.w,
            draft.h,
            scene.palette[0] ?? "#0a0a0a",
            `${kind} ${count}`,
          );
          dispatch(
            addLayers(
              [{ layer, parentId: null, index: scene.layers.length }],
              `add ${kind}`,
            ),
          );
          setSelected([layer.id]);
        }
        setDraft(null);
        setTool("select");
      }
    },
    [marquee, draft, scene, tool, selectedIds, dispatch, setSelected, setTool],
  );

  // --- drag-to-move: move every selected node together, commit on end ---
  const onDragStart = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const id = e.target.id();
      const ids = selectedIds.includes(id) ? selectedIds : [id];
      if (!selectedIds.includes(id)) setSelected([id]);
      const map = new Map<string, { x: number; y: number }>();
      for (const sid of ids) {
        const node = stage.findOne(`#${sid}`);
        if (node) map.set(sid, { x: node.x(), y: node.y() });
      }
      dragStartRef.current = map;
      setInteracting(true); // pause effect previews while dragging
    },
    [selectedIds, setSelected],
  );

  const onDragMove = useCallback((e: KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current;
    const start = dragStartRef.current;
    const startSelf = start.get(e.target.id());
    if (!stage || !startSelf) return;
    const dx = e.target.x() - startSelf.x;
    const dy = e.target.y() - startSelf.y;
    for (const [sid, pos] of start) {
      if (sid === e.target.id()) continue;
      const node = stage.findOne(`#${sid}`);
      node?.position({ x: pos.x + dx, y: pos.y + dy });
    }
  }, []);

  const onDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const stage = stageRef.current;
      const start = dragStartRef.current;
      const startSelf = start.get(e.target.id());
      if (!stage || !startSelf) return;
      const dx = e.target.x() - startSelf.x;
      const dy = e.target.y() - startSelf.y;
      dragStartRef.current = new Map();
      setInteracting(false);
      if (dx === 0 && dy === 0) return;
      const commands = [...start.keys()].flatMap((sid) => {
        const layer = findLayer(scene.layers, sid);
        const s = start.get(sid);
        if (!layer || !s) return [];
        return [
          patchLayer(sid, {
            transform: { ...layer.transform, x: s.x + dx, y: s.y + dy },
          }),
        ];
      });
      dispatch(batch(commands, "move"));
    },
    [scene.layers, dispatch],
  );

  // --- transformer scale/rotate, commit on end ---
  const onTransformEnd = useCallback(() => {
    const tr = trRef.current;
    if (!tr) return;
    const commands = tr.nodes().flatMap((node) => {
      const layer = findLayer(scene.layers, node.id());
      if (!layer) return [];
      return [
        patchLayer(node.id(), {
          transform: {
            x: node.x(),
            y: node.y(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            rotation: node.rotation(),
          },
        }),
      ];
    });
    if (commands.length) dispatch(batch(commands, "transform"));
  }, [scene.layers, dispatch]);

  const draggable = tool === "select" && !spaceDown;
  const cursor = spaceDown
    ? "grab"
    : tool === "select"
      ? "default"
      : "crosshair";

  return (
    <div
      ref={containerRef}
      className="graph-paper absolute inset-0"
      style={{ cursor }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <KonvaLayer>
          {/* artboard */}
          <Rect
            name="artboard"
            x={0}
            y={0}
            width={scene.width}
            height={scene.height}
            fill={scene.background}
            stroke="#0a0a0a"
            strokeWidth={1 / viewport.scale}
          />
          {scene.layers.map((layer) => (
            <Group
              key={layer.id}
              // wrapper so top-level drag works uniformly for all types
              id={layer.id}
              x={layer.transform.x}
              y={layer.transform.y}
              scaleX={layer.transform.scaleX}
              scaleY={layer.transform.scaleY}
              rotation={layer.transform.rotation}
              opacity={layer.opacity}
              visible={layer.visible}
              listening={!layer.locked}
              draggable={draggable && !layer.locked}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            >
              <LayerNode
                layer={{
                  ...layer,
                  // identity transform on the inner node — the wrapper owns it
                  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
                  opacity: 1,
                  id: `${layer.id}:inner`,
                } as Layer}
              />
              {/* GPU-effect preview drawn over the vector; vector stays
                  underneath for hit-testing (SPEC2 §9.2) */}
              {previews.has(layer.id) && (
                <KonvaImage
                  image={previews.get(layer.id)!.image}
                  x={previews.get(layer.id)!.x}
                  y={previews.get(layer.id)!.y}
                  width={previews.get(layer.id)!.width}
                  height={previews.get(layer.id)!.height}
                  listening={false}
                />
              )}
            </Group>
          ))}
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio={false}
            anchorSize={7}
            anchorCornerRadius={0}
            anchorStroke="#0a0a0a"
            anchorFill="#ffffff"
            borderStroke="#ff5c1f"
            rotateAnchorOffset={24}
            onTransformEnd={onTransformEnd}
          />
          {marquee && (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill="rgba(255,92,31,0.08)"
              stroke="#ff5c1f"
              strokeWidth={1 / viewport.scale}
              listening={false}
            />
          )}
          {draft && tool === "rect" && (
            <Rect
              x={draft.x}
              y={draft.y}
              width={draft.w}
              height={draft.h}
              stroke="#0a0a0a"
              strokeWidth={1 / viewport.scale}
              listening={false}
            />
          )}
          {draft && tool === "ellipse" && (
            <Ellipse
              x={draft.x + draft.w / 2}
              y={draft.y + draft.h / 2}
              radiusX={draft.w / 2}
              radiusY={draft.h / 2}
              stroke="#0a0a0a"
              strokeWidth={1 / viewport.scale}
              listening={false}
            />
          )}
        </KonvaLayer>
      </Stage>
    </div>
  );
}
