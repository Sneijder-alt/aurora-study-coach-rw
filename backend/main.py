import json
import os
import sqlite3
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from rag.index import RAGIndex

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = os.getenv("AURORA_DB", str(BASE_DIR / "aurora.db"))
CONTENT_PATH = os.getenv("AURORA_CONTENT", str(BASE_DIR.parent / "content" / "notes.json"))
IS_VERCEL = os.getenv("VERCEL") == "1"
CHROMA_DIR = os.getenv("AURORA_CHROMA_DIR", "/tmp/chroma_db" if IS_VERCEL else str(BASE_DIR / "chroma_db"))

app = FastAPI(title="Aurora Study Coach API", version="0.1.0")
rag = RAGIndex(persist_dir=CHROMA_DIR)
cors_origins = os.getenv("AURORA_CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT,
                topic_id TEXT,
                question_id TEXT,
                correct INTEGER,
                difficulty REAL,
                quality INTEGER,
                created_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mastery (
                device_id TEXT,
                topic_id TEXT,
                mastery REAL,
                updated_at TEXT,
                PRIMARY KEY (device_id, topic_id)
            )
            """
        )


@app.on_event("startup")
async def startup() -> None:
    init_db()
    auto_ingest = os.getenv("AURORA_AUTO_INGEST", "1") == "1"
    if auto_ingest and rag.count() == 0:
        await ingest_notes()


class SyncEvent(BaseModel):
    device_id: str
    topic_id: str
    question_id: str
    correct: bool
    difficulty: float = 1.0
    quality: int = 3
    created_at: str


class SyncRequest(BaseModel):
    events: List[SyncEvent]


class TutorRequest(BaseModel):
    question: str
    language: str = Field("en", description="en or rw")


class GradeRequest(BaseModel):
    question: str
    answer: str
    language: str = Field("en", description="en or rw")


class TutorResponse(BaseModel):
    answer: str
    used_context: bool


class IngestResponse(BaseModel):
    added: int


class QueryRequest(BaseModel):
    query: str
    k: int = 5


class QueryResponse(BaseModel):
    context: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/sync/events")
async def sync_events(payload: SyncRequest):
    with sqlite3.connect(DB_PATH) as conn:
        for e in payload.events:
            conn.execute(
                """
                INSERT INTO events (device_id, topic_id, question_id, correct, difficulty, quality, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (e.device_id, e.topic_id, e.question_id, int(e.correct), e.difficulty, e.quality, e.created_at),
            )
        conn.commit()
    return {"stored": len(payload.events)}


@app.get("/analytics/weak-topics")
async def weak_topics(limit: int = 5):
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT topic_id,
                   SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS wrong,
                   COUNT(*) AS total
            FROM events
            GROUP BY topic_id
            ORDER BY wrong DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {"topic_id": r[0], "wrong": r[1], "total": r[2], "error_rate": (r[1] / r[2]) if r[2] else 0}
        for r in rows
    ]


@app.post("/rag/ingest", response_model=IngestResponse)
async def ingest_notes():
    if not os.path.exists(CONTENT_PATH):
        return IngestResponse(added=0)

    with open(CONTENT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    docs = []
    for item in data:
        docs.append(
            {
                "id": item["id"],
                "text": item["text"],
                "meta": {
                    "title": item.get("title", "Notes"),
                    "subject": item.get("subject", ""),
                    "topic": item.get("topic", ""),
                    "language": item.get("language", ""),
                },
            }
        )

    rag.add_documents(docs)
    return IngestResponse(added=len(docs))


@app.post("/rag/query", response_model=QueryResponse)
async def rag_query(payload: QueryRequest):
    context = rag.query(payload.query, payload.k)
    return QueryResponse(context=context)


async def call_llm(messages: List[dict]) -> Optional[str]:
    api_url = os.getenv("LLM_API_URL")
    api_key = os.getenv("LLM_API_KEY")
    model = os.getenv("LLM_MODEL", "")

    if not api_url or not api_key:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(timeout=25) as client:
        resp = await client.post(api_url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    try:
        return data["choices"][0]["message"]["content"]
    except Exception:
        return None


def system_prompt(language: str) -> str:
    if language == "rw":
        return (
            "You are Aurora Study Coach for Rwandan secondary students (Grade 11). "
            "You are bilingual: English and Kinyarwanda. You must be accurate and exam-oriented.\n\n"
            "Rules:\n"
            "- Use ONLY the provided CONTEXT to answer. If missing, say: 'I\u2019m not fully sure from the provided notes.'\n"
            "- Explain step-by-step for math/science.\n"
            "- Use simple Kinyarwanda and include English technical terms in brackets.\n"
            "- End with one short check question."
        )
    return (
        "You are Aurora Study Coach for Rwandan secondary students (Grade 11). "
        "You are bilingual: English and Kinyarwanda. You must be accurate and exam-oriented.\n\n"
        "Rules:\n"
        "- Use ONLY the provided CONTEXT to answer. If missing, say: 'I\u2019m not fully sure from the provided notes.'\n"
        "- Explain step-by-step for math/science.\n"
        "- Keep explanations short and clear.\n"
        "- End with one short check question."
    )


@app.post("/tutor/explain", response_model=TutorResponse)
async def tutor_explain(payload: TutorRequest):
    context = rag.query(payload.question, 5)
    used_context = bool(context.strip())

    messages = [
        {"role": "system", "content": system_prompt(payload.language)},
        {"role": "developer", "content": f"CONTEXT:\n{context}"},
        {"role": "user", "content": payload.question},
    ]

    response = await call_llm(messages)
    if not response:
        fallback = (
            "I\u2019m not fully sure from the provided notes. "
            "Please check with your teacher or textbook for the exact answer."
        )
        return TutorResponse(answer=fallback, used_context=used_context)

    return TutorResponse(answer=response, used_context=used_context)


@app.post("/tutor/generate_similar", response_model=TutorResponse)
async def tutor_generate_similar(payload: TutorRequest):
    context = rag.query(payload.question, 5)
    messages = [
        {"role": "system", "content": system_prompt(payload.language)},
        {
            "role": "developer",
            "content": (
                "CONTEXT:\n"
                f"{context}\n\n"
                "Task: Generate 3-5 similar practice questions based on the question." 
                "Keep them exam-oriented and short."
            ),
        },
        {"role": "user", "content": payload.question},
    ]

    response = await call_llm(messages)
    if not response:
        fallback = "Please try again when internet is available."
        return TutorResponse(answer=fallback, used_context=bool(context.strip()))

    return TutorResponse(answer=response, used_context=bool(context.strip()))


@app.post("/tutor/mistake_diagnosis", response_model=TutorResponse)
async def tutor_mistake_diagnosis(payload: TutorRequest):
    context = rag.query(payload.question, 5)
    messages = [
        {"role": "system", "content": system_prompt(payload.language)},
        {
            "role": "developer",
            "content": (
                "CONTEXT:\n"
                f"{context}\n\n"
                "Task: Identify the most likely misconception or mistake, then explain how to fix it."
            ),
        },
        {"role": "user", "content": payload.question},
    ]

    response = await call_llm(messages)
    if not response:
        fallback = "I\u2019m not fully sure from the provided notes."
        return TutorResponse(answer=fallback, used_context=bool(context.strip()))

    return TutorResponse(answer=response, used_context=bool(context.strip()))


@app.post("/tutor/grade_answer", response_model=TutorResponse)
async def tutor_grade_answer(payload: GradeRequest):
    context = rag.query(payload.question, 5)
    messages = [
        {"role": "system", "content": system_prompt(payload.language)},
        {
            "role": "developer",
            "content": (
                "CONTEXT:\n"
                f"{context}\n\n"
                "Task: Evaluate the student's answer. If correct, confirm and show the key steps. "
                "If incorrect, explain the mistake and provide the correct solution briefly. "
                "End with one short check question."
            ),
        },
        {
            "role": "user",
            "content": f"Question:\n{payload.question}\n\nStudent answer:\n{payload.answer}",
        },
    ]

    response = await call_llm(messages)
    if not response:
        fallback = (
            "I’m not fully sure from the provided notes. "
            "Please check with your teacher or textbook for the exact answer."
        )
        return TutorResponse(answer=fallback, used_context=bool(context.strip()))

    return TutorResponse(answer=response, used_context=bool(context.strip()))


@app.post("/tutor/translate_or_explain_rw", response_model=TutorResponse)
async def tutor_translate_or_explain(payload: TutorRequest):
    context = rag.query(payload.question, 5)
    messages = [
        {"role": "system", "content": system_prompt("rw")},
        {
            "role": "developer",
            "content": (
                "CONTEXT:\n"
                f"{context}\n\n"
                "Task: Explain the answer in simple Kinyarwanda and include English terms in brackets."
            ),
        },
        {"role": "user", "content": payload.question},
    ]

    response = await call_llm(messages)
    if not response:
        fallback = "Sinzi neza nk\u2019uko bikwiye mu nyandiko zatanzwe."
        return TutorResponse(answer=fallback, used_context=bool(context.strip()))

    return TutorResponse(answer=response, used_context=bool(context.strip()))
