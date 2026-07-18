"""Tests for the optional AI layer-naming path (app/enrich.py). The
`anthropic` package is not installed in the core env, so these inject a
fake `anthropic` module and exercise the summary + JSON-parsing logic that
was previously only covered on its 503 unavailable branch."""

import sys
import types

import pytest

from app import enrich as enrich_mod

SCENE = {
    "layers": [
        {"id": "l1", "name": "shape", "type": "path", "fill": "#e63946"},
        {
            "id": "g1",
            "name": "group",
            "type": "group",
            "children": [{"fill": "#1d3557"}, {"fill": "#2a9d8f"}],
        },
        {"id": "t1", "name": "title", "type": "text", "text": "hello"},
    ]
}


def _install_fake_anthropic(monkeypatch, reply: str) -> None:
    class _Block:
        type = "text"

        def __init__(self, text: str) -> None:
            self.text = text

    class _Response:
        def __init__(self, text: str) -> None:
            self.content = [_Block(text)]

    class _Messages:
        def create(self, **kwargs):
            return _Response(reply)

    class _Anthropic:
        def __init__(self, *a, **k) -> None:
            self.messages = _Messages()

    fake = types.ModuleType("anthropic")
    fake.Anthropic = _Anthropic
    monkeypatch.setitem(sys.modules, "anthropic", fake)


class TestLayerSummary:
    def test_summarizes_each_layer_type(self):
        out = enrich_mod._layer_summary(SCENE)
        assert [e["id"] for e in out] == ["l1", "g1", "t1"]
        path, group, text = out
        assert path["fill"] == "#e63946" and path["pathCount"] == 1
        assert group["pathCount"] == 2 and group["fill"] == "#1d3557"
        assert text["text"] == "hello"


class TestEnrichScene:
    def test_parses_names_and_tags(self, monkeypatch):
        reply = (
            '{"names": [{"id": "l1", "name": "red block"}, '
            '{"id": "t1", "name": "headline"}], '
            '"tags": ["bold", "editorial", "warm"]}'
        )
        _install_fake_anthropic(monkeypatch, reply)
        result = enrich_mod.enrich_scene(SCENE, None)
        assert result["names"] == {"l1": "red block", "t1": "headline"}
        assert result["tags"] == ["bold", "editorial", "warm"]

    def test_drops_names_for_unknown_ids(self, monkeypatch):
        reply = '{"names": [{"id": "ghost", "name": "x"}], "tags": []}'
        _install_fake_anthropic(monkeypatch, reply)
        result = enrich_mod.enrich_scene(SCENE, None)
        assert result["names"] == {}

    def test_tolerates_code_fences(self, monkeypatch):
        reply = '```json\n{"names": [], "tags": ["a", "b", "c", "d"]}\n```'
        _install_fake_anthropic(monkeypatch, reply)
        result = enrich_mod.enrich_scene(SCENE, None)
        # tags are capped at 3
        assert result["tags"] == ["a", "b", "c"]

    def test_raises_when_no_json(self, monkeypatch):
        _install_fake_anthropic(monkeypatch, "sorry, I cannot help with that")
        with pytest.raises(ValueError):
            enrich_mod.enrich_scene(SCENE, None)

    def test_passes_thumbnail_when_provided(self, monkeypatch):
        captured: dict = {}

        class _Block:
            type = "text"
            text = '{"names": [], "tags": []}'

        class _Messages:
            def create(self, **kwargs):
                captured.update(kwargs)
                return type("R", (), {"content": [_Block()]})()

        class _Anthropic:
            def __init__(self, *a, **k) -> None:
                self.messages = _Messages()

        fake = types.ModuleType("anthropic")
        fake.Anthropic = _Anthropic
        monkeypatch.setitem(sys.modules, "anthropic", fake)

        enrich_mod.enrich_scene(SCENE, "ZmFrZWpwZWc=")
        content = captured["messages"][0]["content"]
        assert any(block.get("type") == "image" for block in content)
