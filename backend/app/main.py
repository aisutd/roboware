from __future__ import annotations
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from .api import compare, layouts, models, sessions, training
from .errors import Conflict, Forbidden, NotFound
from .services import Services
from .simulation.grid import LayoutError
DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend-dist"
def create_app(data_dir: Path | str | None = None) -> FastAPI:
    resolved = Path(data_dir or os.environ.get("ROBOWARE_DATA_DIR") or DEFAULT_DATA_DIR)
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.services = Services.create(resolved)
        yield
        await app.state.services.shutdown()
    app = FastAPI(title="RoboWare API", lifespan=lifespan)
    @app.get("/api/health")
    def health(): return {"status":"ok", "message":"RoboWare backend is connected"}
    for router in (layouts.router, models.router, training.router, sessions.router, compare.router): app.include_router(router, prefix="/api")
    @app.exception_handler(NotFound)
    async def not_found(_: Request, exc: NotFound): return JSONResponse({"detail": str(exc)}, status_code=404)
    @app.exception_handler(Forbidden)
    async def forbidden(_: Request, exc: Forbidden): return JSONResponse({"detail": str(exc)}, status_code=403)
    @app.exception_handler(Conflict)
    async def conflict(_: Request, exc: Conflict): return JSONResponse({"detail": str(exc)}, status_code=409)
    @app.exception_handler(LayoutError)
    async def bad_layout(_: Request, exc: LayoutError): return JSONResponse({"detail":{"message":str(exc),"unreachable":[list(c) for c in exc.unreachable]}},status_code=400)
    @app.exception_handler(ValueError)
    async def bad_value(_: Request, exc: ValueError): return JSONResponse({"detail": str(exc)}, status_code=400)
    frontend_dir = Path(os.environ.get("ROBOWARE_FRONTEND_DIR") or DEFAULT_FRONTEND_DIR)
    index_file = frontend_dir / "index.html"
    if index_file.is_file():
        @app.get("/{path:path}", include_in_schema=False)
        async def frontend(path: str):
            requested = (frontend_dir / path).resolve()
            if path and requested.is_file() and frontend_dir.resolve() in requested.parents: return FileResponse(requested)
            return FileResponse(index_file)
    return app
app = create_app()
