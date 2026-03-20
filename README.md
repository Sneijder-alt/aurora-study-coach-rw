# Aurora Study Coach (Advanced Offline-First)

Aurora Study Coach is an offline-first AI learning app built for Rwandan Grade 11 students. It combines mastery-based learning, spaced repetition, bilingual support (Kinyarwanda + English), and Retrieval-Augmented Generation (RAG) to give accurate, exam-oriented explanations while remaining usable on low-end phones and intermittent internet.

## Why this wins
- **Impact**: Targets SDG 4 (Quality Education) for rural and low-bandwidth learners.
- **Technical depth**: Mastery model + spaced repetition + RAG + offline sync queue.
- **Real-world fit**: Offline packs + low data mode + bilingual UX.

## Features
- Offline-first PWA with cached content packs
- Adaptive quiz engine (new + review questions)
- Mastery tracking per topic
- Spaced repetition scheduling per question
- Bilingual explanations (Kinyarwanda/English)
- AI Tutor endpoints (RAG + safety guardrails)
- Optional analytics endpoint for weak-topic insights

## Repo structure
- `frontend/` PWA client
- `backend/` FastAPI server
- `content/` sample curriculum notes and packs

## Quick start
### Frontend
1. `cd frontend`
2. `npm install`
3. `npm run dev`

### Backend
1. `cd backend`
2. `python -m venv .venv`
3. `./.venv/Scripts/activate`
4. `pip install -r requirements.txt`
5. `uvicorn main:app --reload --port 8000`

## Environment variables
Backend uses a generic LLM proxy to avoid hard-coding a provider.

- `LLM_API_URL` (optional)
- `LLM_API_KEY` (optional)
- `LLM_MODEL` (optional)

If unset, the AI Tutor endpoints return a safe fallback response.

## Vercel deployment (frontend + API)
This repo includes a `vercel.json` that deploys:
- Frontend as a static Vite build
- Backend as a Python serverless function at `/api`

Steps:
1. Install Vercel CLI: `npm i -g vercel`
2. From repo root: `vercel`
3. When prompted, set the project name and scope.
4. Add environment variables in Vercel Dashboard (Project Settings → Environment Variables):
   - `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` (optional)

Notes:
- The RAG index is auto-ingested at cold start (from `content/notes.json`).
- Serverless storage is ephemeral, so analytics are best-effort for demo use.

## Offline packs
Sample packs are in `frontend/public/packs/`. After first load, they are cached for offline use.

## Notes
- Replace `frontend/public/pwa-192.png` and `frontend/public/pwa-512.png` with real icons for production.
- Add more curriculum notes in `content/notes.json` to improve RAG accuracy.
- RAG uses lightweight lexical retrieval for easy deployment on serverless platforms.

## Submission checklist
- Problem statement and SDG mapping
- Demo video showing offline use + bilingual tutor
- Evidence of pilot (classmates/teachers)
- Impact plan for local deployment
