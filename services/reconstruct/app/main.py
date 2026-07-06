"""palmós reconstruction service.

Stateless FastAPI app: screenshot in, scene-graph JSON out.
Pipeline endpoints arrive in Step 6; /health is the contract that the
frontend uses to detect the service (and, later, optional capabilities).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="palmos-reconstruct", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "capabilities": {
            # Populated for real in Steps 6–7 (sam / ocr / enrich flags).
        },
    }
