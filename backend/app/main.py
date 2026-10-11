from fastapi import FastAPI

app = FastAPI(title="RoboWare API")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "message": "RoboWare backend is connected",
    }