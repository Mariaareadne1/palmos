"""Step 6 — assemble the SceneGraph: artboard at ORIGINAL dimensions,
layers largest-area first (bottom) to smallest (top), auto-named via
nearest-CSS-color lookup, validated against the Pydantic schema."""

import uuid

import numpy as np

from ..schemas import SceneGraph
from .ocr import TextItem
from .preprocess import Preprocessed
from .segment import SegmentationResult
from .vectorize import VectorizedSegment

# CSS3 extended color keywords (subsampled to distinct hues/tones —
# nearest-match naming only, not authoritative rendering colors)
CSS_COLORS: dict[str, tuple[int, int, int]] = {
    "black": (0, 0, 0), "white": (255, 255, 255), "gray": (128, 128, 128),
    "silver": (192, 192, 192), "dimgray": (105, 105, 105),
    "gainsboro": (220, 220, 220), "red": (255, 0, 0), "crimson": (220, 20, 60),
    "firebrick": (178, 34, 34), "darkred": (139, 0, 0), "salmon": (250, 128, 114),
    "coral": (255, 127, 80), "tomato": (255, 99, 71), "orangered": (255, 69, 0),
    "orange": (255, 165, 0), "darkorange": (255, 140, 0), "gold": (255, 215, 0),
    "yellow": (255, 255, 0), "khaki": (240, 230, 140), "peach": (255, 218, 185),
    "olive": (128, 128, 0), "yellowgreen": (154, 205, 50), "lime": (0, 255, 0),
    "green": (0, 128, 0), "darkgreen": (0, 100, 0), "seagreen": (46, 139, 87),
    "mediumseagreen": (60, 179, 113), "springgreen": (0, 255, 127),
    "teal": (0, 128, 128), "cyan": (0, 255, 255), "turquoise": (64, 224, 208),
    "cadetblue": (95, 158, 160), "steelblue": (70, 130, 180),
    "lightblue": (173, 216, 230), "skyblue": (135, 206, 235),
    "dodgerblue": (30, 144, 255), "blue": (0, 0, 255), "mediumblue": (0, 0, 205),
    "navy": (0, 0, 128), "royalblue": (65, 105, 225), "slateblue": (106, 90, 205),
    "indigo": (75, 0, 130), "purple": (128, 0, 128), "violet": (238, 130, 238),
    "orchid": (218, 112, 214), "magenta": (255, 0, 255), "hotpink": (255, 105, 180),
    "pink": (255, 192, 203), "brown": (165, 42, 42), "sienna": (160, 82, 45),
    "chocolate": (210, 105, 30), "peru": (205, 133, 63), "tan": (210, 180, 140),
    "wheat": (245, 222, 179), "beige": (245, 245, 220), "ivory": (255, 255, 240),
    "lavender": (230, 230, 250), "maroon": (128, 0, 0),
}


def _new_id() -> str:
    return uuid.uuid4().hex[:21]


def nearest_css_name(hex_color: str | None) -> str:
    if not hex_color or not hex_color.startswith("#") or len(hex_color) < 7:
        return "shape"
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    best, best_d = "shape", float("inf")
    for name, (cr, cg, cb) in CSS_COLORS.items():
        d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
        if d < best_d:
            best, best_d = name, d
    return best


def _identity(scale: float, x: float = 0.0, y: float = 0.0) -> dict:
    return {"x": x, "y": y, "scaleX": scale, "scaleY": scale, "rotation": 0}


def _base(name: str) -> dict:
    return {
        "id": _new_id(),
        "name": name,
        "opacity": 1,
        "visible": True,
        "locked": False,
    }


def assemble(
    pre: Preprocessed,
    palette_hex: list[str],
    seg_result: SegmentationResult,
    vectorized: list[VectorizedSegment],
    text_items: list[TextItem],
    source_name: str,
) -> SceneGraph:
    scale = pre.scale
    bg = seg_result.background_rgb
    background = f"#{int(bg[0]):02x}{int(bg[1]):02x}{int(bg[2]):02x}"

    layers: list[dict] = []
    # segments arrive largest-first == bottom-first; keep that order
    for n, (seg, vec) in enumerate(
        zip(seg_result.segments, vectorized), start=1
    ):
        if not vec.paths:
            continue
        first_fill = vec.paths[0].fill
        name = f"{nearest_css_name(first_fill)} shape {n}"
        if len(vec.paths) == 1:
            p = vec.paths[0]
            layers.append(
                {
                    **_base(name),
                    "type": "path",
                    "transform": _identity(scale, p.tx * scale, p.ty * scale),
                    "d": p.d,
                    "fill": p.fill,
                    "stroke": None,
                    "strokeWidth": 0,
                }
            )
        else:
            # one mask, several paths — keep them grouped (SPEC step 6.4)
            layers.append(
                {
                    **_base(name),
                    "type": "group",
                    "transform": _identity(scale),
                    "children": [
                        {
                            **_base(f"{name}.{i + 1}"),
                            "type": "path",
                            "transform": _identity(1.0, p.tx, p.ty),
                            "d": p.d,
                            "fill": p.fill,
                            "stroke": None,
                            "strokeWidth": 0,
                        }
                        for i, p in enumerate(vec.paths)
                    ],
                }
            )

    # OCR text renders above the shapes
    for item in text_items:
        layers.append(
            {
                **_base(item.text[:24] or "text"),
                "type": "text",
                "transform": {
                    "x": item.x * scale,
                    "y": item.y * scale,
                    "scaleX": 1,
                    "scaleY": 1,
                    "rotation": 0,
                },
                "text": item.text,
                "fontFamily": "Inter",
                "fontSize": item.h * 0.75 * scale,
                "fontWeight": 400,
                "fill": item.fill,
                "align": "left",
            }
        )

    scene = {
        "id": _new_id(),
        "name": source_name,
        "width": pre.original_width,
        "height": pre.original_height,
        "background": background,
        "layers": layers,
        "routings": [],
        "palette": palette_hex,
        "version": 1,
    }
    # validate against the contract before returning (SPEC step 6.6)
    return SceneGraph.model_validate(scene)
