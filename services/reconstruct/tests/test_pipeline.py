"""Full CV-path pipeline tests on synthetic images — must pass with NO
optional deps installed (no SAM checkpoint, no tesseract, vtracer allowed
to be broken: the contour fallback covers it)."""

import re

import cv2
import numpy as np
import pytest

from app.pipeline.assemble import assemble
from app.pipeline.palette import extract_palette
from app.pipeline.preprocess import preprocess
from app.pipeline.segment import cv_segment
from app.pipeline.vectorize import vectorize
from tests.conftest import BACKGROUND, SHAPES

# ---------- helpers ----------

_COMMANDS = set("MmLlHhVvCcSsQqTtAaZz")
_TOKEN_RE = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")


def d_parses(d: str) -> bool:
    """A path `d` parses iff it starts with a moveto and every token is a
    valid command letter or number, with nothing left over."""
    tokens = _TOKEN_RE.findall(d)
    if not tokens or tokens[0] not in ("M", "m"):
        return False
    consumed = "".join(tokens)
    stripped = re.sub(r"[\s,]+", "", d)
    if consumed.replace(" ", "") != stripped:
        return False
    for t in tokens:
        if t in _COMMANDS:
            continue
        float(t)  # raises on malformed numbers
    return True


def delta_e(hex_a: str, rgb_b: tuple[int, int, int]) -> float:
    """CIE76 delta-E between a hex color and an RGB tuple."""
    a = np.array(
        [[int(hex_a[1:3], 16), int(hex_a[3:5], 16), int(hex_a[5:7], 16)]],
        dtype=np.uint8,
    ).reshape(1, 1, 3)
    b = np.array(rgb_b, dtype=np.uint8).reshape(1, 1, 3)
    lab_a = cv2.cvtColor(a, cv2.COLOR_RGB2Lab).astype(np.float64).reshape(3)
    lab_b = cv2.cvtColor(b, cv2.COLOR_RGB2Lab).astype(np.float64).reshape(3)
    for lab in (lab_a, lab_b):
        lab[0] *= 100.0 / 255.0
        lab[1] -= 128.0
        lab[2] -= 128.0
    return float(np.linalg.norm(lab_a - lab_b))


def run_cv_pipeline(png: bytes, max_layers: int = 24):
    pre = preprocess(png)
    palette_hex, centroids = extract_palette(pre.rgb)
    seg = cv_segment(pre.rgb, centroids, max_layers)
    vec = vectorize(pre.rgb, seg.segments)
    scene = assemble(pre, palette_hex, seg, vec, [], "test")
    return pre, palette_hex, seg, scene


def iter_paths(layers):
    for layer in layers:
        if layer.type == "path":
            yield layer
        elif layer.type == "group":
            yield from iter_paths(layer.children)


# ---------- the SPEC-required assertions ----------


@pytest.fixture(scope="module")
def result(synthetic_png):
    return run_cv_pipeline(synthetic_png)


class TestFullCvPipeline:
    def test_at_least_four_layers(self, result):
        _, _, _, scene = result
        assert len(scene.layers) >= 4

    def test_every_path_d_parses(self, result):
        _, _, _, scene = result
        paths = list(iter_paths(scene.layers))
        assert paths, "no path layers produced"
        for p in paths:
            assert d_parses(p.d), f"unparseable d on {p.name}: {p.d[:80]}"

    def test_every_fill_within_delta_e_20_of_a_true_color(self, result):
        _, _, _, scene = result
        true_colors = [rgb for _, rgb in SHAPES] + [BACKGROUND[1]]
        for p in iter_paths(scene.layers):
            assert p.fill, f"{p.name} has no fill"
            best = min(delta_e(p.fill, c) for c in true_colors)
            assert best < 20, f"{p.name} fill {p.fill} is deltaE {best:.1f} from everything"

    def test_background_detected(self, result):
        _, _, _, scene = result
        assert delta_e(scene.background, BACKGROUND[1]) < 20

    def test_scene_contract_fields(self, result):
        _, palette_hex, _, scene = result
        assert scene.version == 1
        assert scene.routings == []
        assert scene.width == 800 and scene.height == 600
        assert scene.palette == palette_hex
        assert all(layer.name for layer in scene.layers)

    def test_max_layers_respected(self, synthetic_png):
        _, _, seg, scene = run_cv_pipeline(synthetic_png, max_layers=2)
        assert len(seg.segments) <= 2


class TestPaletteMerge:
    def test_near_identical_colors_merge(self):
        # two reds ~deltaE 3 apart + white: merged palette has 2 entries
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        img[:, :40] = (255, 0, 0)
        img[:, 40:60] = (250, 4, 4)
        img[:, 60:] = (255, 255, 255)
        palette_hex, centroids = extract_palette(img)
        assert len(palette_hex) == 2
        assert len(centroids) == 2

    def test_distinct_colors_survive(self):
        img = np.zeros((90, 90, 3), dtype=np.uint8)
        img[:30] = (255, 0, 0)
        img[30:60] = (0, 0, 255)
        img[60:] = (255, 255, 255)
        palette_hex, _ = extract_palette(img)
        assert len(palette_hex) == 3

    def test_ordered_by_coverage(self):
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        img[:, :70] = (10, 200, 10)   # dominant
        img[:, 70:] = (200, 10, 200)
        palette_hex, _ = extract_palette(img)
        assert delta_e(palette_hex[0], (10, 200, 10)) < 10


class TestPreprocess:
    def test_downscales_long_side_to_1024(self):
        from PIL import Image
        import io

        img = Image.new("RGB", (2048, 1024), "#ffffff")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        pre = preprocess(buf.getvalue())
        assert max(pre.rgb.shape[:2]) == 1024
        assert pre.original_width == 2048
        assert pre.scale == 2.0

    def test_small_images_untouched(self, synthetic_png):
        pre = preprocess(synthetic_png)
        assert pre.rgb.shape[:2] == (600, 800)
        assert pre.scale == 1.0
