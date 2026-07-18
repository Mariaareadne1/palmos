"""Tests for the Pass-1 hardening surface: env-driven settings, upload
byte-signature validation, and the pluggable job store (in-memory + the
optional Redis backend via an injected fake client)."""

import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, _csv_env, _int_env, get_settings
from app.jobs import InMemoryJobStore, RedisJobStore
from app.main import _sniff_image_type, app

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

    def test_update_unknown_is_noop(self):
        store = InMemoryJobStore(ttl_s=3600)
        store.update("does-not-exist", status="done")  # must not raise

    def test_ttl_prune_evicts_expired(self):
        store = InMemoryJobStore(ttl_s=3600)
        job = store.create()
        # backdate creation beyond the TTL, then trigger a prune via any op
        store._jobs[job.id].created_at = time.time() - 7200
        assert store.get(job.id) is None


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
