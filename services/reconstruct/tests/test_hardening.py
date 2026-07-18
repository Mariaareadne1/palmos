"""Tests for the Pass-1 hardening surface: env-driven settings, upload
byte-signature validation, and the pluggable job store (in-memory + the
optional Redis backend via an injected fake client)."""

import threading
import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, _csv_env, _int_env, get_settings
from app.jobs import InMemoryJobStore, Job, RedisJobStore, build_store
from app.main import _sniff_image_type, app
from app.pipeline.preprocess import MAX_DECODE_PIXELS, preprocess

client = TestClient(app)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff\xe0"


class TestConfig:
    def test_int_env_default_when_unset(self, monkeypatch):
        monkeypatch.delenv("PALMOS_TEST_INT", raising=False)
        assert _int_env("PALMOS_TEST_INT", 7) == 7

    def test_int_env_parses_value(self, monkeypatch):
        monkeypatch.setenv("PALMOS_TEST_INT", "42")
        assert _int_env("PALMOS_TEST_INT", 7) == 42

    def test_int_env_falls_back_on_garbage(self, monkeypatch):
        monkeypatch.setenv("PALMOS_TEST_INT", "not-a-number")
        assert _int_env("PALMOS_TEST_INT", 7) == 7

    def test_csv_env_splits_and_trims(self, monkeypatch):
        monkeypatch.setenv("PALMOS_TEST_CSV", " a , b ,, c ")
        assert _csv_env("PALMOS_TEST_CSV") == ("a", "b", "c")

    def test_csv_env_empty(self, monkeypatch):
        monkeypatch.delenv("PALMOS_TEST_CSV", raising=False)
        assert _csv_env("PALMOS_TEST_CSV") == ()

    def test_defaults_preserve_original_behavior(self):
        s = Settings()
        assert s.max_upload_bytes == 10 * 1024 * 1024
        assert s.allowed_content_types == frozenset({"image/png", "image/jpeg"})
        assert "localhost" in s.cors_allow_origin_regex

    def test_get_settings_is_cached(self):
        assert get_settings() is get_settings()


class TestMagicByteSniff:
    def test_png_signature(self):
        assert _sniff_image_type(PNG_MAGIC + b"rest") == "image/png"

    def test_jpeg_signature(self):
        assert _sniff_image_type(JPEG_MAGIC + b"rest") == "image/jpeg"

    def test_non_image_bytes(self):
        assert _sniff_image_type(b"GIF89a") is None
        assert _sniff_image_type(b"") is None

    def test_mislabeled_body_rejected_415(self):
        # declared png, but the bytes are not an image
        r = client.post(
            "/reconstruct",
            files={"image": ("fake.png", b"\x00\x01\x02not-an-image", "image/png")},
        )
        assert r.status_code == 415

    def test_empty_body_still_422(self):
        r = client.post(
            "/reconstruct",
            files={"image": ("empty.png", b"", "image/png")},
        )
        assert r.status_code == 422


class TestInMemoryStore:
    def test_create_get_update(self):
        store = InMemoryJobStore(ttl_s=3600)
        job = store.create()
        assert store.get(job.id) is job
        store.update(job.id, status="done", progress=1.0)
        assert store.get(job.id).status == "done"

    def test_update_publishes_new_snapshot(self):
        # update() must not mutate the object a prior get() handed out
        store = InMemoryJobStore(ttl_s=3600)
        job = store.create()
        held = store.get(job.id)
        store.update(job.id, status="done")
        assert held.status == "processing"  # old snapshot unchanged
        assert store.get(job.id).status == "done"  # new snapshot current

    def test_update_rejects_unknown_field(self):
        store = InMemoryJobStore(ttl_s=3600)
        job = store.create()
        with pytest.raises(TypeError):
            store.update(job.id, sate="done")  # typo -> must not silently pass

    def test_update_unknown_is_noop(self):
        store = InMemoryJobStore(ttl_s=3600)
        store.update("does-not-exist", status="done")  # must not raise

    def test_ttl_prune_evicts_expired(self):
        store = InMemoryJobStore(ttl_s=3600)
        job = store.create()
        # Job is frozen, so publish a backdated snapshot directly
        store._jobs[job.id] = replace(store._jobs[job.id], created_at=time.time() - 7200)
        assert store.get(job.id) is None

    def test_concurrent_updates_are_consistent(self):
        store = InMemoryJobStore(ttl_s=3600)
        job = store.create()

        def bump(i: int) -> None:
            for _ in range(50):
                store.update(job.id, progress=i / 100)

        threads = [threading.Thread(target=bump, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # no torn state: the job is still readable and internally consistent
        final = store.get(job.id)
        assert final is not None and 0.0 <= final.progress <= 1.0


class _FakeRedis:
    """Minimal in-process stand-in for redis.Redis (get/setex/ttl)."""

    def __init__(self):
        self.store: dict[str, bytes] = {}
        self.ttls: dict[str, int] = {}

    def setex(self, key, ttl, value):
        self.store[key] = value.encode() if isinstance(value, str) else value
        self.ttls[key] = ttl

    def get(self, key):
        return self.store.get(key)

    def ttl(self, key):
        return self.ttls.get(key, -2)


class TestRedisStore:
    def test_roundtrip_create_get_update(self):
        store = RedisJobStore("redis://ignored", ttl_s=3600, client=_FakeRedis())
        job = store.create()
        fetched = store.get(job.id)
        assert fetched is not None and fetched.id == job.id
        store.update(job.id, status="done", progress=1.0, engine="cv")
        again = store.get(job.id)
        assert again.status == "done" and again.progress == 1.0 and again.engine == "cv"

    def test_get_missing_returns_none(self):
        store = RedisJobStore("redis://ignored", ttl_s=3600, client=_FakeRedis())
        assert store.get("missing") is None

    def test_update_missing_is_noop(self):
        store = RedisJobStore("redis://ignored", ttl_s=3600, client=_FakeRedis())
        store.update("missing", status="done")  # must not raise

    def test_update_preserves_remaining_ttl(self):
        fake = _FakeRedis()
        store = RedisJobStore("redis://ignored", ttl_s=3600, client=fake)
        job = store.create()
        key = f"palmos:job:{job.id}"
        fake.ttls[key] = 120  # simulate time elapsed
        store.update(job.id, progress=0.5)
        assert fake.ttls[key] == 120

    def test_update_resets_ttl_when_expiry_unknown(self):
        # ttl() == -1 (no expiry) / -2 (missing) -> fall back to the full ttl
        fake = _FakeRedis()
        store = RedisJobStore("redis://ignored", ttl_s=3600, client=fake)
        job = store.create()
        key = f"palmos:job:{job.id}"
        fake.ttls[key] = -1
        store.update(job.id, progress=0.5)
        assert fake.ttls[key] == 3600

    def test_corrupt_payload_returns_none(self):
        fake = _FakeRedis()
        fake.store["palmos:job:bad"] = b"{not valid json"
        store = RedisJobStore("redis://ignored", ttl_s=3600, client=fake)
        assert store.get("bad") is None  # must not raise / 500

    def test_unknown_field_in_payload_returns_none(self):
        import json

        fake = _FakeRedis()
        fake.store["palmos:job:x"] = json.dumps({"id": "x", "bogus": 1}).encode()
        store = RedisJobStore("redis://ignored", ttl_s=3600, client=fake)
        assert store.get("x") is None


class TestBuildStore:
    def test_defaults_to_in_memory(self):
        assert isinstance(build_store(Settings(redis_url="")), InMemoryJobStore)

    def test_selects_redis_when_url_set(self, monkeypatch):
        # avoid a real connection: intercept the lazy redis import
        import sys
        import types

        fake_mod = types.ModuleType("redis")
        fake_mod.Redis = type(
            "Redis", (), {"from_url": staticmethod(lambda *a, **k: _FakeRedis())}
        )
        monkeypatch.setitem(sys.modules, "redis", fake_mod)
        store = build_store(Settings(redis_url="redis://localhost:6379"))
        assert isinstance(store, RedisJobStore)


class TestEnvWiring:
    def test_env_vars_populate_settings(self, monkeypatch):
        monkeypatch.setenv("RECONSTRUCT_MAX_UPLOAD_BYTES", "2048")
        monkeypatch.setenv("RECONSTRUCT_WORKERS", "5")
        monkeypatch.setenv("RECONSTRUCT_CORS_ORIGINS", "https://a.app,https://b.app")
        monkeypatch.setenv("REDIS_URL", "redis://x")
        get_settings.cache_clear()
        try:
            s = get_settings()
            assert s.max_upload_bytes == 2048
            assert s.executor_workers == 5
            assert s.cors_allow_origins == ("https://a.app", "https://b.app")
            assert s.redis_url == "redis://x"
        finally:
            get_settings.cache_clear()

    def test_negative_int_env_falls_back(self, monkeypatch):
        monkeypatch.setenv("PALMOS_TEST_INT", "-5")
        assert _int_env("PALMOS_TEST_INT", 9) == 9


class TestDecompressionGuard:
    def test_oversize_dimensions_rejected(self):
        import io

        from PIL import Image

        # header claims a huge canvas; guard trips before a full decode
        side = int(MAX_DECODE_PIXELS**0.5) + 100
        buf = io.BytesIO()
        Image.new("RGB", (side, side), "#ffffff").save(buf, format="PNG")
        with pytest.raises(ValueError):
            preprocess(buf.getvalue())

    def test_normal_image_passes(self, synthetic_png):
        result = preprocess(synthetic_png)
        assert result.rgb.ndim == 3
