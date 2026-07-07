"""Standalone vtracer worker, run as a SUBPROCESS by vectorize.py.

vtracer is a native (PyO3) extension that hard-crashes (SIGSEGV) on some
Python builds — e.g. CPython 3.14 at the time of writing — which no
try/except can contain. Running it out-of-process turns a crash into a
nonzero exit code the parent can fall back from (SPEC §0 rule 2).

Usage: python -m app.pipeline.vtracer_worker <dir>
Converts every <dir>/seg_*.png to <dir>/seg_*.svg. Exits 0 on success.
"""

import glob
import os
import sys


def main() -> int:
    import vtracer  # crash risk lives here, inside the subprocess

    directory = sys.argv[1]
    for png in sorted(glob.glob(os.path.join(directory, "seg_*.png"))):
        svg = png[:-4] + ".svg"
        vtracer.convert_image_to_svg_py(
            png,
            svg,
            colormode="color",
            filter_speckle=4,
            mode="spline",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
