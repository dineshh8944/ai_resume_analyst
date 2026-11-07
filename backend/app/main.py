from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .config import get_settings
from . import database as db
from . import ai as backup_ai

settings = get_settings()
app = FastAPI(
    title="ResumeMatch AI - API",
    description="Resume tailoring, version history, and LLM completions via Groq, Gemini, or OpenAI.",
    version="2.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.frontend_origin.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


class VersionIn(BaseModel):
    resume_text: str = Field(min_length=1, max_length=60000)
    job_description: str = Field(default="", max_length=30000)
    keyword_score: int = Field(ge=0, le=100)
    ai_score: Optional[int] = Field(default=None, ge=0, le=100)
    missing_keywords: list[str] = Field(default_factory=list, max_length=100)
    model: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=120)
    filename: str = Field(default="", max_length=180)


class AIRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=40000)
    temperature: float = Field(default=0.2, ge=0, le=1)
    api_key: Optional[str] = Field(default="")
    provider: Optional[str] = Field(default="")


@app.post("/api/ai")
async def ai_endpoint(req: AIRequest):
    """Processes AI requests using Groq, Gemini, or OpenAI."""
    try:
        text, provider = await backup_ai.complete(
            req.prompt,
            req.temperature,
            custom_key=req.api_key or "",
            custom_provider=req.provider or ""
        )
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return {"text": text, "provider": provider}


@app.get("/")
def root():
    return {"message": "ResumeMatch AI history API", "docs": "/docs"}


@app.get("/api/health")
def health():
    return {"status": "ok", "storage": db.storage_name(), "ai_providers": backup_ai.provider_names()}


@app.post("/api/history", status_code=201)
def create(v: VersionIn):
    return db.save_version(v.model_dump())


@app.get("/api/history")
def history(limit: int = 20):
    if not 1 <= limit <= 100:
        raise HTTPException(400, "limit must be between 1 and 100")
    return {"items": db.list_versions(limit)}


@app.get("/api/history/{version_id}")
def get_one(version_id: str):
    item = db.get_version(version_id)
    if not item:
        raise HTTPException(404, "Version not found")
    return item


@app.delete("/api/history/{version_id}")
def remove(version_id: str):
    if not db.delete_version(version_id):
        raise HTTPException(404, "Version not found")
    return {"deleted": True}
