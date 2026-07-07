"""Step 1 — load, EXIF-rotate, downscale to <=1024 px on the longest side.

Keeps the scale factor so the assembled artboard uses the ORIGINAL
dimensions; layers carry a compensating transform scale."""

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 1024


@dataclass
class Preprocessed:
    rgb: np.ndarray          # (H, W, 3) uint8, working resolution
    original_width: int
    original_height: int
    scale: float             # original px per working px (>= 1)


def preprocess(image_bytes: bytes) -> Preprocessed:
    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    original_width, original_height = img.size

    longest = max(img.size)
    if longest > MAX_SIDE:
        factor = MAX_SIDE / longest
        img = img.resize(
            (max(1, round(img.width * factor)), max(1, round(img.height * factor))),
            Image.LANCZOS,
        )

    rgb = np.asarray(img.convert("RGB"), dtype=np.uint8)
    scale = original_width / rgb.shape[1]
    return Preprocessed(
        rgb=rgb,
        original_width=original_width,
        original_height=original_height,
        scale=scale,
    )
