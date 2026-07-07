"""Step 5 — optional OCR. Runs only when pytesseract AND the tesseract
binary are both present; silently skipped otherwise (text then arrives as
vector paths, which is acceptable per SPEC)."""

from dataclasses import dataclass

import numpy as np

MIN_CONFIDENCE = 60


@dataclass
class TextItem:
    text: str
    x: int
    y: int
    w: int
    h: int
    fill: str


def _text_pixel_color(rgb: np.ndarray, x: int, y: int, w: int, h: int) -> str:
    """Dominant text-pixel color: Otsu-split the box, take the minority
    class (glyphs cover less area than their background)."""
    import cv2

    box = rgb[y : y + h, x : x + w]
    if box.size == 0:
        return "#0a0a0a"
    gray = cv2.cvtColor(box, cv2.COLOR_RGB2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dark = thresh == 0
    text_mask = dark if dark.mean() <= 0.5 else ~dark
    if not text_mask.any():
        return "#0a0a0a"
    mean = box[text_mask].mean(axis=0)
    r, g, b = (int(round(float(v))) for v in mean)
    return f"#{r:02x}{g:02x}{b:02x}"


def try_extract_text(
    rgb: np.ndarray,
) -> tuple[list[TextItem], np.ndarray | None]:
    """Returns (word items with confidence > 60, bool exclusion mask for
    the segmenter) — or ([], None) when OCR is unavailable."""
    try:
        import pytesseract
        from PIL import Image

        pytesseract.get_tesseract_version()  # raises if binary missing
    except Exception:
        return [], None

    try:
        data = pytesseract.image_to_data(
            Image.fromarray(rgb), output_type=pytesseract.Output.DICT
        )
    except Exception:
        return [], None

    items: list[TextItem] = []
    exclude = np.zeros(rgb.shape[:2], dtype=bool)
    for i, text in enumerate(data["text"]):
        text = (text or "").strip()
        if not text:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            continue
        if conf <= MIN_CONFIDENCE:
            continue
        x, y = int(data["left"][i]), int(data["top"][i])
        w, h = int(data["width"][i]), int(data["height"][i])
        if w <= 1 or h <= 1:
            continue
        items.append(
            TextItem(
                text=text,
                x=x,
                y=y,
                w=w,
                h=h,
                fill=_text_pixel_color(rgb, x, y, w, h),
            )
        )
        exclude[y : y + h, x : x + w] = True

    return items, (exclude if items else None)
