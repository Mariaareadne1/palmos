"""Step 3 — segmentation. CV fallback (always works, built first) with
optional SAM/MobileSAM when importable AND a checkpoint exists at
$SAM_CHECKPOINT. Every optional path is wrapped so its absence or
failure can never crash the service (SPEC §0 rule 2)."""

import os
from dataclasses import dataclass

import cv2
import numpy as np

MIN_AREA_FRACTION = 0.005  # drop masks < 0.5% of image area


@dataclass
class Segment:
    mask: np.ndarray            # (H, W) bool
    color_rgb: np.ndarray | None  # dominant color (CV path); None for SAM
    area: int


@dataclass
class SegmentationResult:
    segments: list[Segment]     # sorted by area, descending
    background_rgb: np.ndarray  # (3,) uint8
    engine: str                 # "sam" | "cv"


# ---------- CV fallback (the path that must always work) ----------


def _quantize(rgb: np.ndarray, centroids: np.ndarray) -> np.ndarray:
    """Nearest-centroid label per pixel -> (H, W) int."""
    flat = rgb.reshape(-1, 3).astype(np.int32)
    cents = centroids.astype(np.int32)
    # (N, M) squared distances — fine at 1024px and M<=8
    d = (
        (flat[:, None, :] - cents[None, :, :]).astype(np.int64) ** 2
    ).sum(axis=2)
    return d.argmin(axis=1).reshape(rgb.shape[:2])


def cv_segment(
    rgb: np.ndarray,
    centroids: np.ndarray,
    max_layers: int,
    exclude: np.ndarray | None = None,
) -> SegmentationResult:
    """Palette-quantize -> per-color morphology -> connected components.
    The largest component overall becomes the background (not a layer).
    `exclude` is an optional bool mask (e.g. OCR word boxes) removed from
    consideration."""
    h, w = rgb.shape[:2]
    min_area = int(h * w * MIN_AREA_FRACTION)
    labels = _quantize(rgb, centroids)

    kernel = np.ones((3, 3), np.uint8)
    segments: list[Segment] = []
    for ci in range(len(centroids)):
        mask = (labels == ci).astype(np.uint8)
        if exclude is not None:
            mask[exclude] = 0
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        n, comp = cv2.connectedComponents(mask)
        for label in range(1, n):
            m = comp == label
            area = int(m.sum())
            if area >= min_area:
                segments.append(
                    Segment(mask=m, color_rgb=centroids[ci], area=area)
                )

    segments.sort(key=lambda s: -s.area)
    if segments:
        background = segments[0]
        segments = segments[1 : max_layers + 1]
        bg_rgb = background.color_rgb
    else:
        bg_rgb = centroids[0] if len(centroids) else np.array([255, 255, 255])
        segments = []
    return SegmentationResult(
        segments=segments,
        background_rgb=np.asarray(bg_rgb, dtype=np.uint8),
        engine="cv",
    )


# ---------- optional SAM ----------


def _border_modal_color(rgb: np.ndarray) -> np.ndarray:
    """Most common border pixel color — the SAM-path background guess."""
    border = np.concatenate(
        [rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]], axis=0
    )
    colors, counts = np.unique(border, axis=0, return_counts=True)
    return colors[counts.argmax()].astype(np.uint8)


def try_sam_segment(rgb: np.ndarray, max_layers: int) -> SegmentationResult | None:
    """Automatic mask generation via SAM/MobileSAM. Returns None on ANY
    failure — missing import, missing checkpoint, runtime error."""
    checkpoint = os.environ.get("SAM_CHECKPOINT")
    if not checkpoint or not os.path.exists(checkpoint):
        return None
    try:
        try:
            from mobile_sam import (  # type: ignore[import-not-found]
                SamAutomaticMaskGenerator,
                sam_model_registry,
            )

            model_type = "vit_t"
        except ImportError:
            from segment_anything import (  # type: ignore[import-not-found]
                SamAutomaticMaskGenerator,
                sam_model_registry,
            )

            model_type = os.environ.get("SAM_MODEL_TYPE", "vit_b")

        sam = sam_model_registry[model_type](checkpoint=checkpoint)
        generator = SamAutomaticMaskGenerator(sam)
        raw = generator.generate(rgb)

        h, w = rgb.shape[:2]
        min_area = int(h * w * MIN_AREA_FRACTION)
        segments = [
            Segment(mask=m["segmentation"].astype(bool), color_rgb=None, area=int(m["area"]))
            for m in raw
            if m["area"] >= min_area
        ]
        segments.sort(key=lambda s: -s.area)
        return SegmentationResult(
            segments=segments[:max_layers],
            background_rgb=_border_modal_color(rgb),
            engine="sam",
        )
    except Exception:
        return None


def segment(
    rgb: np.ndarray,
    centroids: np.ndarray,
    max_layers: int,
    exclude: np.ndarray | None = None,
) -> SegmentationResult:
    """SAM if available, else the CV fallback chain."""
    result = try_sam_segment(rgb, max_layers)
    if result is not None and result.segments:
        return result
    return cv_segment(rgb, centroids, max_layers, exclude)
