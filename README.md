# ResumeMatch AI (Direct LLM APIs + Optional Backend)

Tailor your resume to any job: live keyword/ATS matching, AI advice, **one-click Auto-optimize**, and download (.docx / .pdf / .txt).

- **Direct AI Integration**: Completely removed Puter. Uses direct client-side and backend integrations for **Groq**, **Google Gemini**, and **OpenAI**.
- **Interactive API Settings**: Configure your API keys and select models right from the web UI (stored securely in browser `localStorage`), with real-time connection testing.
- **Auto Fallback**: Automatically routes to the fastest working model (Groq &rarr; Gemini &rarr; OpenAI).
- **Backend (optional)**: FastAPI (+ MongoDB) for saving/restoring resume versions across sessions.

---

## Quick Start (Frontend)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Open `http://localhost:5173` in your browser. Click **API Keys & Models** in the top bar to verify or update your keys:
- **Groq** (Free & Ultra Fast): Model `qwen/qwen3.8-27b`
- **Google Gemini** (Free AI Studio): Model `gemini-3.5-flash`
- **OpenAI** (Requires billing credit): Model `gpt-4o-mini`

---

## Run the Backend (Optional: Resume Version History)

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env              # macOS/Linux: cp .env.example .env
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- When the backend is running, a **History** tab appears automatically in the app to save and restore resume iterations.
- API documentation: http://127.0.0.1:8000/docs
