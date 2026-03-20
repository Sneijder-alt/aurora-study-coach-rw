import React, { useEffect, useMemo, useState } from "react";
import { buildSessionQuestions, normalizeAnswer, reviewSRS, updateMastery } from "./lib/engine";
import type { SRSState } from "./lib/engine";
import { getItem, setItem } from "./lib/storage";
import { enqueueEvent, flushQueue, getDeviceId, isOnline } from "./lib/offline";

const defaultApiBase = import.meta.env.PROD ? "/api" : "http://localhost:8000";
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? defaultApiBase;
const STATE_KEY = "learning-state";
const WORKSPACE_KEY = "workspace-notes";

type Question = {
  id: string;
  type: "mcq" | "short";
  prompt_en: string;
  prompt_rw: string;
  choices?: string[];
  answer: string;
  explanation_en: string;
  explanation_rw: string;
  difficulty: number;
  concept: string;
};

type Topic = {
  id: string;
  title_en: string;
  title_rw: string;
  notes_en: string;
  notes_rw: string;
  misconceptions_en: string;
  misconceptions_rw: string;
  questions: Question[];
};

type Pack = {
  subject: string;
  grade: string;
  language: string[];
  topics: Topic[];
};

type LearningState = {
  mastery: Record<string, number>;
  srs: Record<string, SRSState>;
  stats: Record<string, { correct: number; total: number }>;
};

const initialState: LearningState = {
  mastery: {},
  srs: {},
  stats: {}
};

export default function App() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [lang, setLang] = useState<"en" | "rw">("en");
  const [lowData, setLowData] = useState(true);
  const [online, setOnline] = useState(isOnline());
  const [deviceId, setDeviceId] = useState<string>("");
  const [learning, setLearning] = useState<LearningState>(initialState);
  const [workspaceNotes, setWorkspaceNotes] = useState("");

  const [packIndex, setPackIndex] = useState<number | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [sessionQuestions, setSessionQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [graded, setGraded] = useState<Record<string, boolean>>({});
  const [showResults, setShowResults] = useState(false);
  const [tutorText, setTutorText] = useState<string | null>(null);
  const [tutorLoading, setTutorLoading] = useState(false);
  const [practiceQuestion, setPracticeQuestion] = useState("");
  const [practiceAnswer, setPracticeAnswer] = useState("");
  const [practiceFeedback, setPracticeFeedback] = useState<string | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const stored = await getItem<LearningState>(STATE_KEY, initialState);
      setLearning(stored);
      const notes = await getItem<string>(WORKSPACE_KEY, "");
      setWorkspaceNotes(notes);
      const id = await getDeviceId();
      setDeviceId(id);
    };
    load();
  }, []);

  useEffect(() => {
    const loadPacks = async () => {
      const urls = ["/packs/math-pack.json", "/packs/physics-pack.json"];
      const res = await Promise.all(urls.map((u) => fetch(u)));
      const data = await Promise.all(res.map((r) => r.json()));
      setPacks(data);
    };
    loadPacks().catch(() => setPacks([]));
  }, []);

  useEffect(() => {
    setItem(STATE_KEY, learning).catch(() => undefined);
  }, [learning]);

  useEffect(() => {
    setItem(WORKSPACE_KEY, workspaceNotes).catch(() => undefined);
  }, [workspaceNotes]);

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    const trySync = async () => {
      await flushQueue(API_BASE);
    };
    trySync();
    const timer = setInterval(trySync, 30000);
    return () => clearInterval(timer);
  }, [online]);

  const selectedPack = packIndex !== null ? packs[packIndex] : null;
  const selectedTopic = useMemo(() => {
    if (!selectedPack || !topicId) return null;
    return selectedPack.topics.find((t) => t.id === topicId) ?? null;
  }, [selectedPack, topicId]);

  const currentQuestion = sessionQuestions[currentIndex];

  function t(en: string, rw: string) {
    return lang === "en" ? en : rw;
  }

  function startTopic(pIndex: number, tId: string) {
    setPackIndex(pIndex);
    setTopicId(tId);
    const pack = packs[pIndex];
    const topic = pack.topics.find((t) => t.id === tId);
    if (!topic) return;

    const session = buildSessionQuestions(topic.questions, learning.srs, 10);
    setSessionQuestions(session as Question[]);
    setCurrentIndex(0);
    setAnswers({});
    setGraded({});
    setShowResults(false);
    setTutorText(null);
  }

  async function gradeQuestion(question: Question, value: string) {
    if (graded[question.id]) return;
    if (!selectedPack || !selectedTopic) return;

    const isCorrect = normalizeAnswer(value) === normalizeAnswer(question.answer);
    const quality = isCorrect ? 5 : 2;
    const topicKey = `${selectedPack.subject}:${selectedTopic.id}`;

    setLearning((prev) => {
      const currentMastery = prev.mastery[topicKey] ?? 0.3;
      const nextMastery = updateMastery(currentMastery, {
        topicId: topicKey,
        correct: isCorrect,
        difficulty: question.difficulty
      });
      const nextSrs = reviewSRS(prev.srs[question.id], quality);
      const stat = prev.stats[topicKey] ?? { correct: 0, total: 0 };

      return {
        mastery: { ...prev.mastery, [topicKey]: nextMastery },
        srs: { ...prev.srs, [question.id]: nextSrs },
        stats: {
          ...prev.stats,
          [topicKey]: {
            correct: stat.correct + (isCorrect ? 1 : 0),
            total: stat.total + 1
          }
        }
      };
    });

    setGraded((prev) => ({ ...prev, [question.id]: true }));

    const event = {
      deviceId,
      topicId: topicKey,
      questionId: question.id,
      correct: isCorrect,
      difficulty: question.difficulty,
      quality,
      createdAt: new Date().toISOString()
    };
    await enqueueEvent(event);
  }

  function nextQuestion() {
    if (currentIndex < sessionQuestions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setTutorText(null);
    } else {
      setShowResults(true);
    }
  }

  function score() {
    let s = 0;
    for (const q of sessionQuestions) {
      if (normalizeAnswer(answers[q.id] ?? "") === normalizeAnswer(q.answer)) s += 1;
    }
    return s;
  }

  async function askTutor(mode: "explain" | "similar" | "mistake") {
    if (!currentQuestion) return;
    if (lowData) {
      setTutorText(t("Low Data Mode is on. Turn it off to use the AI Tutor.", "Low Data Mode iri ON. Yifungure kugirango ukoreshe AI Tutor."));
      return;
    }
    setTutorLoading(true);
    setTutorText(null);

    const prompt = `${lang === "en" ? currentQuestion.prompt_en : currentQuestion.prompt_rw}\n` +
      `Student answer: ${answers[currentQuestion.id] ?? "(no answer)"}`;

    const endpoint =
      mode === "explain"
        ? "/tutor/explain"
        : mode === "similar"
        ? "/tutor/generate_similar"
        : "/tutor/mistake_diagnosis";

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: prompt, language: lang })
      });
      const data = await res.json();
      setTutorText(data.answer ?? "");
    } catch {
      setTutorText(t("Unable to reach AI tutor right now.", "Ntibishoboye kugera kuri AI tutor ubu."));
    } finally {
      setTutorLoading(false);
    }
  }

  async function runPractice(mode: "explain" | "similar" | "grade" | "translate") {
    const question = practiceQuestion.trim();
    const answer = practiceAnswer.trim();

    if (!question) {
      setPracticeFeedback(t("Please enter a question first.", "Banza wandike ikibazo."));
      return;
    }
    if (mode === "grade" && !answer) {
      setPracticeFeedback(t("Please enter your answer so I can check it.", "Andika igisubizo kugira ngo kigenzurwe."));
      return;
    }
    if (lowData) {
      setPracticeFeedback(t("Low Data Mode is on. Turn it off to use AI features.", "Low Data Mode iri ON. Yifungure kugirango ukoreshe AI."));
      return;
    }
    if (!online) {
      setPracticeFeedback(t("AI Practice works when online.", "AI Practice ikorera kuri interineti."));
      return;
    }

    setPracticeLoading(true);
    setPracticeFeedback(null);

    const endpoint =
      mode === "explain"
        ? "/tutor/explain"
        : mode === "similar"
        ? "/tutor/generate_similar"
        : mode === "translate"
        ? "/tutor/translate_or_explain_rw"
        : "/tutor/grade_answer";

    const payload: Record<string, string> = { question, language: lang };
    if (mode === "grade") payload.answer = answer;

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setPracticeFeedback(data.answer ?? "");
    } catch {
      setPracticeFeedback(t("Unable to reach AI right now.", "Ntibishoboye kugera kuri AI ubu."));
    } finally {
      setPracticeLoading(false);
    }
  }

  const masteryKey = selectedPack && selectedTopic ? `${selectedPack.subject}:${selectedTopic.id}` : "";
  const mastery = masteryKey ? learning.mastery[masteryKey] ?? 0.3 : 0.0;
  const stats = masteryKey ? learning.stats[masteryKey] ?? { correct: 0, total: 0 } : { correct: 0, total: 0 };

  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <h2 style={{ margin: 0 }}>Aurora Study Coach</h2>
            <div className="small">Offline-first AI Study Coach for Rwanda</div>
          </div>
        </div>
        <div className="tag-row">
          <span className="badge">{online ? t("Online", "Uri kuri interineti") : t("Offline", "Nta interineti")}</span>
          <button className="btn secondary" onClick={() => setLowData((v) => !v)}>
            {lowData ? t("Low Data: ON", "Low Data: ON") : t("Low Data: OFF", "Low Data: OFF")}
          </button>
          <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "rw")}>
            <option value="en">English</option>
            <option value="rw">Kinyarwanda</option>
          </select>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t("Learning Dashboard", "Imiterere y'Isomo")}</h3>
          <div className="stat">
            <span>{t("Mastery", "Urwego rw'ubumenyi")}</span>
            <strong>{Math.round(mastery * 100)}%</strong>
          </div>
          <div className="stat">
            <span>{t("Correct", "Byakunze")}</span>
            <strong>{stats.correct}</strong>
          </div>
          <div className="stat">
            <span>{t("Total", "Byose")}</span>
            <strong>{stats.total}</strong>
          </div>

          {selectedTopic && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>{t("Topic Notes", "Ibisobanuro by'isomo")}</h4>
              <div className="notice">
                {lang === "en" ? selectedTopic.notes_en : selectedTopic.notes_rw}
              </div>
              <h4 style={{ marginBottom: 8, marginTop: 16 }}>{t("Common Mistakes", "Amakosa asanzwe")}</h4>
              <div className="notice">
                {lang === "en" ? selectedTopic.misconceptions_en : selectedTopic.misconceptions_rw}
              </div>
            </div>
          )}

          {!selectedTopic && (
            <div className="small" style={{ marginTop: 16 }}>
              {t(
                "Pick a topic to start a mastery session. Your progress stays on this device even offline.",
                "Hitamo isomo utangire. Ibyo wakoze bibikwa kuri telefoni nubwo nta interineti."
              )}
            </div>
          )}
        </div>

        <div className="panel">
          {!selectedTopic && (
            <>
              <h3 style={{ marginTop: 0 }}>{t("Choose a Topic", "Hitamo Isomo")}</h3>
              <div className="grid" style={{ marginTop: 8 }}>
                {packs.map((pack, pIndex) => (
                  <div key={pack.subject} className="card">
                    <strong>{pack.subject}</strong>
                    <div className="small">Grade {pack.grade}</div>
                    <div className="grid" style={{ marginTop: 8 }}>
                      {pack.topics.map((tp) => (
                        <button
                          key={tp.id}
                          className="btn secondary"
                          onClick={() => startTopic(pIndex, tp.id)}
                        >
                          {lang === "en" ? tp.title_en : tp.title_rw}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {selectedTopic && !showResults && currentQuestion && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ marginTop: 0 }}>{lang === "en" ? selectedTopic.title_en : selectedTopic.title_rw}</h3>
                <span className="badge">
                  {t("Question", "Ikibazo")} {currentIndex + 1}/{sessionQuestions.length}
                </span>
              </div>

              <div className="question">
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {lang === "en" ? currentQuestion.prompt_en : currentQuestion.prompt_rw}
                </div>

                {currentQuestion.type === "mcq" && (
                  <div className="grid">
                    {currentQuestion.choices?.map((choice) => (
                      <label
                        key={choice}
                        className={`choice ${answers[currentQuestion.id] === choice ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name={currentQuestion.id}
                          value={choice}
                          checked={answers[currentQuestion.id] === choice}
                          onChange={() => {
                            setAnswers((prev) => ({ ...prev, [currentQuestion.id]: choice }));
                            gradeQuestion(currentQuestion, choice);
                          }}
                        />
                        <span>{choice}</span>
                      </label>
                    ))}
                  </div>
                )}

                {currentQuestion.type === "short" && (
                  <div className="grid">
                    <input
                      value={answers[currentQuestion.id] ?? ""}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                      placeholder={t("Type your answer", "Andika igisubizo")}
                      style={{ padding: 10, borderRadius: 10, border: "1px solid #1f2a44", background: "#0f172a", color: "#e2e8f0" }}
                    />
                    <button
                      className="btn secondary"
                      onClick={() => gradeQuestion(currentQuestion, answers[currentQuestion.id] ?? "")}
                    >
                      {t("Check", "Genzura")}
                    </button>
                  </div>
                )}
              </div>

              {graded[currentQuestion.id] && (
                <div className="card" style={{ marginTop: 12 }}>
                  <strong>{t("Explanation", "Ibisobanuro")}</strong>
                  <div style={{ marginTop: 6 }}>
                    {lang === "en" ? currentQuestion.explanation_en : currentQuestion.explanation_rw}
                  </div>
                </div>
              )}

              <div className="grid" style={{ marginTop: 12 }}>
                <button className="btn" onClick={nextQuestion} disabled={!graded[currentQuestion.id]}>
                  {currentIndex < sessionQuestions.length - 1 ? t("Next", "Komeza") : t("Finish", "Soza")}
                </button>

                {online && (
                  <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                    <button className="btn secondary" onClick={() => askTutor("explain")} disabled={tutorLoading}>
                      {t("Ask AI Tutor", "Baza AI Tutor")}
                    </button>
                    <button className="btn secondary" onClick={() => askTutor("mistake")} disabled={tutorLoading}>
                      {t("Mistake Help", "Fasha ku makosa")}
                    </button>
                    <button className="btn secondary" onClick={() => askTutor("similar")} disabled={tutorLoading}>
                      {t("Similar Qs", "Ibibazo bisa")}
                    </button>
                  </div>
                )}
              </div>

              {tutorText && (
                <div className="card" style={{ marginTop: 12 }}>
                  <strong>{t("AI Tutor", "AI Tutor")}</strong>
                  <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{tutorText}</div>
                </div>
              )}

              {!online && (
                <div className="small" style={{ marginTop: 8 }}>
                  {t("AI Tutor works when online. Your progress is saved offline.", "AI Tutor ikorera kuri interineti. Ibyo wakoze birabikwa offline.")}
                </div>
              )}
            </>
          )}

          {selectedTopic && showResults && (
            <>
              <h3 style={{ marginTop: 0 }}>{t("Session Results", "Ibisubizo by'isomo")}</h3>
              <p>
                {t("Score", "Amanota")}: {score()} / {sessionQuestions.length}
              </p>
              <p className="small">
                {t(
                  "Recommendation: review weak topics tomorrow for spaced repetition.",
                  "Inama: subira ku masomo agoranye ejo ukoresheje spaced repetition."
                )}
              </p>
              <button className="btn" onClick={() => setTopicId(null)}>
                {t("Back to topics", "Subira ku masomo")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 24 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t("Practice Lab", "Aho Gukorera Imyitozo")}</h3>
          <div className="small">
            {t(
              "Type any question you want to practice. Use AI for explanations or checking your answer.",
              "Andika ikibazo icyo ari cyo cyose ushaka gukora. Koresha AI kugusobanurira cyangwa kugenzura igisubizo."
            )}
          </div>

          <label className="small" style={{ marginTop: 12, display: "block" }}>
            {t("Question", "Ikibazo")}
          </label>
          <textarea
            className="text-area"
            value={practiceQuestion}
            onChange={(e) => setPracticeQuestion(e.target.value)}
            placeholder={t("e.g. Solve 3x + 2 = 11", "urugero: Kemuye 3x + 2 = 11")}
            rows={4}
          />

          <label className="small" style={{ marginTop: 10, display: "block" }}>
            {t("Your Answer (optional)", "Igisubizo cyawe (si ngombwa)")}
          </label>
          <textarea
            className="text-area"
            value={practiceAnswer}
            onChange={(e) => setPracticeAnswer(e.target.value)}
            placeholder={t("Write your steps or final answer here.", "Andika intambwe cyangwa igisubizo hano.")}
            rows={3}
          />

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 10 }}>
            <button className="btn" onClick={() => runPractice("grade")} disabled={practiceLoading}>
              {t("Check My Answer", "Genzura Igisubizo")}
            </button>
            <button className="btn secondary" onClick={() => runPractice("explain")} disabled={practiceLoading}>
              {t("Explain", "Sobanura")}
            </button>
            <button className="btn secondary" onClick={() => runPractice("similar")} disabled={practiceLoading}>
              {t("Similar Qs", "Ibibazo Bisa")}
            </button>
            <button className="btn secondary" onClick={() => runPractice("translate")} disabled={practiceLoading}>
              {t("Explain in Kinyarwanda", "Sobanura mu Kinyarwanda")}
            </button>
            <button
              className="btn warn"
              onClick={() => {
                setPracticeQuestion("");
                setPracticeAnswer("");
                setPracticeFeedback(null);
              }}
            >
              {t("Clear", "Siba")}
            </button>
          </div>

          {practiceFeedback && (
            <div className="card" style={{ marginTop: 12 }}>
              <strong>{t("AI Feedback", "Igisubizo cya AI")}</strong>
              <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{practiceFeedback}</div>
            </div>
          )}

          {!online && (
            <div className="small" style={{ marginTop: 8 }}>
              {t("AI Practice requires internet.", "AI Practice ikenera interineti.")}
            </div>
          )}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{t("My Workpad", "Aho Kwandika Imyitozo")}</h3>
          <div className="small">
            {t(
              "Use this space to write steps, formulas, or notes. It saves on this device.",
              "Andika intambwe, formulas, cyangwa notes hano. Bibikwa kuri telefoni."
            )}
          </div>
          <textarea
            className="text-area"
            value={workspaceNotes}
            onChange={(e) => setWorkspaceNotes(e.target.value)}
            placeholder={t("Write your working here...", "Andika ibikorwa byawe hano...")}
            rows={10}
          />
          <div className="small" style={{ marginTop: 6 }}>
            {t("Auto-saved locally. No internet needed.", "Birabikwa automatisch. Nta interineti ikenewe.")}
          </div>
        </div>
      </div>

      <div className="footer">
        {t(
          "Data privacy: no personal data required. Ask a teacher to verify when unsure.",
          "Ibanga: nta makuru y'ibanga asabwa. Baza umwarimu niba utizeye ibisubizo."
        )}
      </div>
    </div>
  );
}
