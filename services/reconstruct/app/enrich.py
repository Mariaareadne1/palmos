"""Step 7 — optional AI layer naming, active only when ANTHROPIC_API_KEY
is set AND the `anthropic` package is installed. Sends layer metadata
(names, colors, path counts — NOT the source image) plus a small
thumbnail to the Messages API; returns better names + 3 vibe tags.

Model verified against platform.claude.com docs at build time; the
cheapest current tier is right for a labeling task. Override with
$ANTHROPIC_MODEL if it ages out.
"""

import base64
import json
import os
import re

DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def is_available() -> bool:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401

        return True
    except ImportError:
        return False


def _layer_summary(scene: dict) -> list[dict]:
    out = []
    for layer in scene.get("layers", []):
        entry: dict = {
            "id": layer["id"],
            "name": layer["name"],
            "type": layer["type"],
        }
        if layer["type"] == "path":
            entry["fill"] = layer.get("fill")
            entry["pathCount"] = 1
        elif layer["type"] == "group":
            children = layer.get("children", [])
            entry["pathCount"] = len(children)
            fills = [c.get("fill") for c in children if c.get("fill")]
            if fills:
                entry["fill"] = fills[0]
        elif layer["type"] == "text":
            entry["text"] = layer.get("text")
        out.append(entry)
    return out


def enrich_scene(scene: dict, thumbnail_jpeg_b64: str | None) -> dict:
    """Returns {"names": {layer_id: new_name}, "tags": [str, str, str]}.
    Raises on any API failure — the endpoint maps that to a 502."""
    import anthropic

    client = anthropic.Anthropic()
    model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)

    content: list[dict] = []
    if thumbnail_jpeg_b64:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": thumbnail_jpeg_b64,
                },
            }
        )
    content.append(
        {
            "type": "text",
            "text": (
                "This is a reconstructed graphic design. Given the thumbnail "
                "and this layer list, propose a concise, descriptive lowercase "
                "name for each layer (e.g. 'sun circle', 'title bar') and 3 "
                "short vibe tags for the whole design.\n\n"
                f"Layers: {json.dumps(_layer_summary(scene))}\n\n"
                "Reply with ONLY this JSON, no prose:\n"
                '{"names": [{"id": "<layer id>", "name": "<new name>"}, ...], '
                '"tags": ["<tag>", "<tag>", "<tag>"]}'
            ),
        }
    )

    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": content}],
    )
    text = "".join(
        block.text for block in response.content if block.type == "text"
    )
    # tolerate accidental code fences
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("model returned no JSON")
    parsed = json.loads(match.group(0))

    valid_ids = {layer["id"] for layer in scene.get("layers", [])}
    names = {
        item["id"]: str(item["name"])[:64]
        for item in parsed.get("names", [])
        if isinstance(item, dict) and item.get("id") in valid_ids and item.get("name")
    }
    tags = [str(t)[:32] for t in parsed.get("tags", [])][:3]
    return {"names": names, "tags": tags}


def make_thumbnail_b64(rgb_array) -> str:
    """256px JPEG thumbnail of the working image, base64-encoded."""
    import io

    from PIL import Image

    img = Image.fromarray(rgb_array)
    img.thumbnail((256, 256))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")
