"""Job lifecycle + error-code matrix via TestClient (api-test-suite-builder
patterns: upload validation, boundaries, error paths first)."""

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestHealth:
    def test_health_shape(self):
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        caps = body["capabilities"]
        assert set(caps) == {"sam", "ocr", "enrich"}
        assert all(isinstance(v, bool) for v in caps.values())


class TestReconstructValidation:
    def test_wrong_mime_type_415(self):
        r = client.post(
            "/reconstruct",
            files={"image": ("notes.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 415
        assert "detail" in r.json()

    def test_oversize_413(self):
        blob = b"\x89PNG" + b"\0" * (10 * 1024 * 1024 + 1)
        r = client.post(
            "/reconstruct", files={"image": ("big.png", blob, "image/png")}
        )
        assert r.status_code == 413

    def test_empty_upload_422(self):
        r = client.post(
            "/reconstruct", files={"image": ("empty.png", b"", "image/png")}
        )
        assert r.status_code == 422

    @pytest.mark.parametrize("bad", [0, 65, -1])
    def test_max_layers_out_of_bounds_422(self, synthetic_png, bad):
        r = client.post(
            "/reconstruct",
            files={"image": ("d.png", synthetic_png, "image/png")},
            data={"max_layers": str(bad)},
        )
        assert r.status_code == 422

    @pytest.mark.parametrize("ok", [1, 64])
    def test_max_layers_boundaries_accepted(self, synthetic_png, ok):
        r = client.post(
            "/reconstruct",
            files={"image": ("d.png", synthetic_png, "image/png")},
            data={"max_layers": str(ok)},
        )
        assert r.status_code == 200
        assert r.json()["job_id"]


class TestJobs:
    def test_unknown_job_404(self):
        r = client.get("/jobs/nope")
        assert r.status_code == 404
        assert "detail" in r.json()

    def test_full_lifecycle(self, synthetic_png):
        r = client.post(
            "/reconstruct",
            files={"image": ("poster.png", synthetic_png, "image/png")},
        )
        assert r.status_code == 200
        job_id = r.json()["job_id"]

        deadline = time.time() + 60
        body = None
        while time.time() < deadline:
            poll = client.get(f"/jobs/{job_id}")
            assert poll.status_code == 200
            body = poll.json()
            assert body["status"] in ("processing", "done", "error")
            assert 0 <= body["progress"] <= 1
            if body["status"] in ("done", "error"):
                break
            time.sleep(0.2)

        assert body is not None
        assert body["status"] == "done", body.get("error")
        assert body["progress"] == 1.0
        assert body["engine"] in ("sam", "cv")
        scene = body["scene"]
        assert scene["version"] == 1
        assert scene["width"] == 800 and scene["height"] == 600
        assert len(scene["layers"]) >= 4
        assert scene["name"] == "poster"

    def test_enrich_unavailable_503(self, synthetic_png, monkeypatch):
        # no ANTHROPIC_API_KEY in the test env -> capability off -> 503
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        r = client.post("/jobs/whatever/enrich")
        assert r.status_code == 503

    def test_processing_body_has_no_null_noise(self, synthetic_png):
        r = client.post(
            "/reconstruct",
            files={"image": ("p.png", synthetic_png, "image/png")},
        )
        job_id = r.json()["job_id"]
        body = client.get(f"/jobs/{job_id}").json()
        # response_model_exclude_none: absent fields are absent, not null
        assert None not in body.values()
