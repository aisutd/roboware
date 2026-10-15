"""RoboWare API: layouts, models, training jobs, automated sessions and comparisons."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import layouts, models, training
from .errors import Conflict, Forbidden, NotFound
from .services import Services
from .simulation.grid import LayoutError

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def create_app(data_dir: Path | str | None = None) -> FastAPI:
    resolved = Path(data_dir or os.environ.get("ROBOWARE_DATA_DIR") or DEFAULT_DATA_DIR)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.services = Services.create(resolved)
        yield
        await app.state.services.shutdown()

    app = FastAPI(title="RoboWare API", lifespan=lifespan)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "message": "RoboWare backend is connected"}

    for router in (layouts.router, models.router, training.router):
        app.include_router(router, prefix="/api")

    @app.exception_handler(NotFound)
    async def not_found(_: Request, exc: NotFound):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(Forbidden)
    async def forbidden(_: Request, exc: Forbidden):
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(Conflict)
    async def conflict(_: Request, exc: Conflict):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(LayoutError)
    async def bad_layout(_: Request, exc: LayoutError):
        return JSONResponse({"detail": {"message": str(exc), "unreachable": [list(c) for c in exc.unreachable]}},
                            status_code=400)

    @app.exception_handler(ValueError)
    async def bad_value(_: Request, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    return app


app = create_app()
