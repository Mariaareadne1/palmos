"""Step 4 — vectorization. Primary: vtracer (in a crash-isolated
subprocess — see vtracer_worker.py). Fallback per mask (or for the whole
batch when the worker dies): cv2.findContours + approxPolyDP."""

import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image

from .segment import Segment

WORKER_TIMEOUT_S = 120
APPROX_EPSILON = 1.5


@dataclass
class VectorPath:
    d: str
    fill: str | None
    tx: float = 0.0
    ty: float = 0.0


@dataclass
class VectorizedSegment:
    paths: list[VectorPath] = field(default_factory=list)


def _segment_rgba(rgb: np.ndarray, seg: Segment) -> np.ndarray:
    """Masked pixels composited onto transparency."""
    h, w = rgb.shape[:2]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3][seg.mask] = rgb[seg.mask]
    rgba[..., 3][seg.mask] = 255
    return rgba


_TRANSLATE_RE = re.compile(
    r"translate\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)\s*\)"
)


def _parse_svg_paths(svg_text: str) -> list[VectorPath]:
    root = ET.fromstring(svg_text)
    out: list[VectorPath] = []
    for el in root.iter():
        if el.tag.split("}")[-1] != "path":
            continue
        d = el.get("d")
        if not d:
            continue
        tx = ty = 0.0
        transform = el.get("transform", "")
        m = _TRANSLATE_RE.search(transform)
        if m:
            tx, ty = float(m.group(1)), float(m.group(2))
        fill = el.get("fill")
        if fill in ("none", "transparent"):
            fill = None
        out.append(VectorPath(d=d, fill=fill, tx=tx, ty=ty))
    return out


def _mean_color_hex(rgb: np.ndarray, seg: Segment) -> str:
    if seg.color_rgb is not None:
        r, g, b = (int(v) for v in seg.color_rgb)
    else:
        mean = rgb[seg.mask].mean(axis=0)
        r, g, b = (int(round(float(v))) for v in mean)
    return f"#{r:02x}{g:02x}{b:02x}"


def contour_fallback(rgb: np.ndarray, seg: Segment) -> VectorizedSegment:
    """findContours + approxPolyDP -> polygon path, fill = mask color."""
    mask = seg.mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    fill = _mean_color_hex(rgb, seg)
    paths: list[VectorPath] = []
    for contour in contours:
        approx = cv2.approxPolyDP(contour, APPROX_EPSILON, True)
        if len(approx) < 3:
            continue
        points = approx.reshape(-1, 2)
        d = "M " + " L ".join(f"{x} {y}" for x, y in points) + " Z"
        paths.append(VectorPath(d=d, fill=fill))
    return VectorizedSegment(paths=paths)


def _run_vtracer_batch(
    rgb: np.ndarray, segments: list[Segment]
) -> list[VectorizedSegment] | None:
    """One subprocess for the whole job. None => worker unavailable/crashed."""
    if not segments:
        return []
    with tempfile.TemporaryDirectory(prefix="palmos-vt-") as tmp:
        for i, seg in enumerate(segments):
            Image.fromarray(_segment_rgba(rgb, seg)).save(
                os.path.join(tmp, f"seg_{i:03d}.png")
            )
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "app.pipeline.vtracer_worker", tmp],
                cwd=os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                capture_output=True,
                timeout=WORKER_TIMEOUT_S,
            )
        except (subprocess.TimeoutExpired, OSError):
            return None
        if proc.returncode != 0:
            return None

        out: list[VectorizedSegment] = []
        for i, seg in enumerate(segments):
            svg_path = os.path.join(tmp, f"seg_{i:03d}.svg")
            try:
                with open(svg_path, encoding="utf-8") as f:
                    paths = _parse_svg_paths(f.read())
            except (OSError, ET.ParseError):
                paths = []
            if not paths:
                out.append(contour_fallback(rgb, seg))
            else:
                # vtracer traces the transparent backdrop too sometimes;
                # keep paths but default missing fills to the mask color
                fallback_fill = _mean_color_hex(rgb, seg)
                for p in paths:
                    if p.fill is None:
                        p.fill = fallback_fill
                out.append(VectorizedSegment(paths=paths))
        return out


def vectorize(
    rgb: np.ndarray,
    segments: list[Segment],
    on_progress: "callable[[float], None] | None" = None,
) -> list[VectorizedSegment]:
    result = _run_vtracer_batch(rgb, segments)
    if result is not None:
        if on_progress:
            on_progress(1.0)
        return result
    # vtracer unavailable on this interpreter — contour fallback for all
    out = []
    for i, seg in enumerate(segments):
        out.append(contour_fallback(rgb, seg))
        if on_progress:
            on_progress((i + 1) / max(1, len(segments)))
    return out
