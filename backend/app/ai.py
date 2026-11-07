"""AI routing module supporting Groq, Google Gemini, and OpenAI.
Tries configured providers with automatic fallbacks for maximum reliability.
"""
import logging
from openai import AsyncOpenAI
from .config import get_settings

log = logging.getLogger("resume-ai")


def _real(key: str) -> bool:
    k = (key or "").strip().lower()
    return bool(k) and "your" not in k and "here" not in k


def providers(custom_key: str = "", custom_provider: str = "") -> list[dict]:
    s = get_settings()
    out = []

    # Priority 1: Groq (ultra fast response times)
    groq_k = (custom_key if custom_provider.lower() == "groq" else s.groq_key if hasattr(s, 'groq_key') else s.groq_api_key).strip()
    if _real(groq_k):
        primary_model = s.groq_model if s.groq_model and "llama-3.3" not in s.groq_model else "qwen/qwen3.8-27b"
        client = AsyncOpenAI(api_key=groq_k, base_url="https://api.groq.com/openai/v1", timeout=60)
        out.append({"name": "Groq", "model": primary_model, "fallbacks": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"], "client": client})

    # Priority 2: Gemini (OpenAI-compatible v1beta endpoint)
    gemini_k = (custom_key if custom_provider.lower() == "gemini" else s.gemini_api_key).strip()
    if _real(gemini_k):
        primary_model = s.gemini_model if s.gemini_model and "gemini-2.5-flash" != s.gemini_model else "gemini-3.5-flash"
        client = AsyncOpenAI(api_key=gemini_k, base_url="https://generativelanguage.googleapis.com/v1beta/openai/", timeout=60)
        out.append({"name": "Gemini", "model": primary_model, "fallbacks": ["gemini-3.5-flash-lite", "gemini-3.8-flash"], "client": client})

    # Priority 3: OpenAI
    openai_k = (custom_key if custom_provider.lower() == "openai" else s.openai_api_key).strip()
    if _real(openai_k):
        primary_model = s.openai_model if s.openai_model and "gpt-4.1-mini" != s.openai_model else "gpt-4o-mini"
        client = AsyncOpenAI(api_key=openai_k, timeout=60)
        out.append({"name": "OpenAI", "model": primary_model, "fallbacks": ["gpt-4o", "gpt-3.5-turbo"], "client": client})

    return out


def provider_names() -> list[str]:
    return [p["name"] for p in providers()]


async def complete(prompt: str, temperature: float = 0.2, custom_key: str = "", custom_provider: str = "") -> tuple[str, str]:
    """Returns (text, provider_label). Raises RuntimeError with readable message."""
    ps = providers(custom_key=custom_key, custom_provider=custom_provider)
    if not ps:
        raise RuntimeError("No AI key configured. Add GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY to backend/.env or configure it in the web app.")

    errors = []
    for p in ps:
        models_to_try = [p["model"], *p.get("fallbacks", [])]
        for m in models_to_try:
            try:
                r = await p["client"].chat.completions.create(
                    model=m,
                    temperature=temperature,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
                text = (r.choices[0].message.content or "").strip()
                if text:
                    return text, f'{p["name"]} ({m})'
                errors.append(f'{p["name"]} ({m}): empty reply')
            except Exception as e:
                err_str = str(e)
                log.warning("%s (%s) failed: %s", p["name"], m, err_str)
                errors.append(f'{p["name"]} ({m}): {err_str[:120]}')

    raise RuntimeError("All configured AI providers failed. " + " | ".join(errors))
