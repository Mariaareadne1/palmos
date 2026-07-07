"""Step 2 — palette extraction: k-means (k=8) on a 10k-pixel sample,
merge centroids closer than deltaE ~= 12 (Lab), order by coverage."""

import cv2
import numpy as np
from sklearn.cluster import KMeans

K = 8
SAMPLE = 10_000
MERGE_DELTA_E = 12.0


def _to_lab(rgb_colors: np.ndarray) -> np.ndarray:
    """(N, 3) uint8 RGB -> (N, 3) float Lab (OpenCV scaling)."""
    img = rgb_colors.reshape(-1, 1, 3).astype(np.uint8)
    lab = cv2.cvtColor(img, cv2.COLOR_RGB2Lab).reshape(-1, 3).astype(np.float64)
    # OpenCV 8-bit Lab: L in 0..255 (scaled from 0..100), a/b offset by 128
    lab[:, 0] *= 100.0 / 255.0
    lab[:, 1] -= 128.0
    lab[:, 2] -= 128.0
    return lab


def hex_of(rgb: np.ndarray) -> str:
    r, g, b = (int(round(float(v))) for v in rgb[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def extract_palette(rgb: np.ndarray) -> tuple[list[str], np.ndarray]:
    """Returns (hex list ordered by coverage, centroid array (M,3) uint8
    in the same order). The centroids drive the CV fallback segmenter."""
    pixels = rgb.reshape(-1, 3)
    if len(pixels) > SAMPLE:
        idx = np.random.default_rng(0).choice(len(pixels), SAMPLE, replace=False)
        sample = pixels[idx]
    else:
        sample = pixels

    k = min(K, len(np.unique(sample, axis=0)))
    if k == 0:
        return ["#000000"], np.zeros((1, 3), dtype=np.uint8)
    km = KMeans(n_clusters=k, n_init=4, random_state=0).fit(sample.astype(np.float64))
    centroids = km.cluster_centers_
    counts = np.bincount(km.labels_, minlength=k).astype(np.float64)

    # merge close centroids (deltaE76 in Lab), largest-coverage first
    order = np.argsort(-counts)
    lab = _to_lab(np.clip(centroids, 0, 255).astype(np.uint8))
    kept: list[int] = []
    weight: dict[int, float] = {}
    for i in order:
        merged = False
        for j in kept:
            if np.linalg.norm(lab[i] - lab[j]) < MERGE_DELTA_E:
                weight[j] += counts[i]
                merged = True
                break
        if not merged:
            kept.append(int(i))
            weight[int(i)] = counts[i]

    kept.sort(key=lambda j: -weight[j])
    final = np.clip(centroids[kept], 0, 255).astype(np.uint8)
    return [hex_of(c) for c in final], final
