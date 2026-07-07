"""Shared fixtures: synthetic test images generated in-code (SPEC §5
step 6) — no binary fixtures in the repo."""

import io
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# (name, hex, rgb) ground truth for the synthetic design
BACKGROUND = ("#f2ede4", (242, 237, 228))
SHAPES = [
    ("#e63946", (230, 57, 70)),    # red rect
    ("#1d3557", (29, 53, 87)),     # navy rect
    ("#2a9d8f", (42, 157, 143)),   # teal rect
    ("#f4a261", (244, 162, 97)),   # sand circle
]


def make_synthetic_design() -> bytes:
    """800x600: distinct background + 3 filled rects + a circle."""
    img = Image.new("RGB", (800, 600), BACKGROUND[0])
    d = ImageDraw.Draw(img)
    d.rectangle([80, 80, 300, 300], fill=SHAPES[0][0])
    d.rectangle([450, 120, 700, 260], fill=SHAPES[1][0])
    d.rectangle([100, 400, 400, 520], fill=SHAPES[2][0])
    d.ellipse([500, 350, 700, 550], fill=SHAPES[3][0])
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="session")
def synthetic_png() -> bytes:
    return make_synthetic_design()
