import { FormEvent, useEffect, useState } from "react";
import { Check, CheckCircle2, FilePlus2, Lightbulb, MessageSquare, Plus, SendHorizontal } from "lucide-react";
import { MessageContent } from "../../components/chat/MessageContent";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { api } from "../../services/api";
import type { TrainingDraft, TrainingGenerateResult, TrainingMessage, TrainingSession } from "../../types";

const ACTIVE_TRAINING_SESSION_KEY = "nava_active_training_session";

function roleLabel(role: TrainingMessage["role"]) {
  if (role === "assistant") return "NAVA";
  if (role === "correction") return "Koreksi Helpdesk";
  return "Helpdesk";
}

function draftLines(values: string[] = []) {
  return values.join("\n");
}

function parseLines(value: string) {
  return [...new Set(value.split(/\n|,/).map((item) => item.trim()).filter(Boolean))];
}

function emptyDraft(): TrainingDraft {
  return {
    title: "",
    category: "",
    product: "nagagold",
    clientScope: ["all"],
    symptoms: [],
    troubleshootingSteps: [],
    userResponseTemplate: "",
    tags: [],
    internalNotes: "",
    escalationRules: [],
  };
}

export function ChatTrainingPage() {
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [question, setQuestion] = useState("");
  const [correctionFor, setCorrectionFor] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [draftResult, setDraftResult] = useState<TrainingGenerateResult | null>(null);
  const [draft, setDraft] = useState<TrainingDraft>(emptyDraft());
  const [duplicateAction, setDuplicateAction] = useState<"" | "new" | "update_existing">("");
  const [duplicateArticleId, setDuplicateArticleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function createTrainingRoom(noticeMessage = "") {
    try {
      setLoading(true);
      setError("");
      setNotice("");
      const nextSession = await api.createTrainingSession();
      sessionStorage.removeItem(ACTIVE_TRAINING_SESSION_KEY);
      sessionStorage.setItem(ACTIVE_TRAINING_SESSION_KEY, nextSession.training_id);
      setSession(nextSession);
      setDraftResult(null);
      setDraft(emptyDraft());
      setDuplicateAction("");
      setDuplicateArticleId("");
      setNotice(noticeMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat training session.");
    } finally {
      setLoading(false);
    }
  }

  async function startNewTraining() {
    await createTrainingRoom();
  }

  useEffect(() => {
    let cancelled = false;
    async function restoreOrCreateTraining() {
      let history: TrainingSession[] = [];
      try {
        history = await api.trainingSessions();
      } catch {
        // Loading history is helpful but should not prevent starting a training session.
      }

      const savedTrainingId = sessionStorage.getItem(ACTIVE_TRAINING_SESSION_KEY);
      const activeTraining = history.find((item) => item.status === "active");
      const trainingIdToRestore = activeTraining?.training_id || savedTrainingId || "";
      if (trainingIdToRestore) {
        try {
          setLoading(true);
          setError("");
          const savedSession = await api.trainingSession(trainingIdToRestore);
          if (!cancelled) {
            sessionStorage.setItem(ACTIVE_TRAINING_SESSION_KEY, savedSession.training_id);
            setSession(savedSession);
            setLoading(false);
          }
          return;
        } catch {
          sessionStorage.removeItem(ACTIVE_TRAINING_SESSION_KEY);
        }
      }

      try {
        setLoading(true);
        setError("");
        const nextSession = await api.createTrainingSession();
        if (!cancelled) {
          sessionStorage.setItem(ACTIVE_TRAINING_SESSION_KEY, nextSession.training_id);
          setSession(nextSession);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal membuat training session.");
          setLoading(false);
        }
      }
    }

    restoreOrCreateTraining();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateSession(next: TrainingSession) {
    setSession(next);
    setDraftResult(null);
    setDuplicateAction("");
    setDuplicateArticleId("");
    setNotice("");
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!session || !question.trim() || sending || session.status !== "active") return;
    const submittedQuestion = question.trim();
    const optimisticId = `optimistic-training-${Date.now()}`;
    const optimisticMessage: TrainingMessage = {
      _id: optimisticId,
      training_id: session.training_id,
      role: "helpdesk",
      content: submittedQuestion,
      metadata: { delivery_status: "sending" },
      created_at: new Date().toISOString(),
    };
    setSession((current) => current ? { ...current, messages: [...current.messages, optimisticMessage], updated_at: optimisticMessage.created_at } : current);
    setQuestion("");
    try {
      setSending(true);
      setError("");
      const result = await api.trainingMessage(session.training_id, submittedQuestion);
      updateSession(result.session);
      sessionStorage.setItem(ACTIVE_TRAINING_SESSION_KEY, result.session.training_id);
    } catch (err) {
      setSession((current) => current ? {
        ...current,
        messages: current.messages.map((message) => message._id === optimisticId
          ? { ...message, metadata: { ...message.metadata, delivery_status: "failed" } }
          : message),
      } : current);
      setError(err instanceof Error ? err.message : "Gagal meminta jawaban NAVA.");
    } finally {
      setSending(false);
    }
  }

  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    if (!session || !correction.trim() || sending || session.status !== "active") return;
    const submittedCorrection = correction.trim();
    const optimisticId = `optimistic-training-correction-${Date.now()}`;
    const optimisticMessage: TrainingMessage = {
      _id: optimisticId,
      training_id: session.training_id,
      role: "correction",
      content: submittedCorrection,
      metadata: { delivery_status: "sending", corrects_message_id: correctionFor || undefined },
      created_at: new Date().toISOString(),
    };
    setSession((current) => current ? { ...current, messages: [...current.messages, optimisticMessage], updated_at: optimisticMessage.created_at } : current);
    setCorrection("");
    setCorrectionFor(null);
    try {
      setSending(true);
      setError("");
      const result = await api.trainingCorrection(session.training_id, submittedCorrection, correctionFor || "");
      updateSession(result.session);
      sessionStorage.setItem(ACTIVE_TRAINING_SESSION_KEY, result.session.training_id);
    } catch (err) {
      setSession((current) => current ? {
        ...current,
        messages: current.messages.map((message) => message._id === optimisticId
          ? { ...message, metadata: { ...message.metadata, delivery_status: "failed" } }
          : message),
      } : current);
      setError(err instanceof Error ? err.message : "Gagal mengirim koreksi.");
    } finally {
      setSending(false);
    }
  }

  async function markCorrect(messageId: string) {
    if (!session || !messageId) return;
    try {
      setError("");
      const updated = await api.trainingFeedback(session.training_id, messageId, "correct");
      setSession((current) => current ? {
        ...current,
        messages: current.messages.map((message) => message._id === updated._id ? updated : message),
      } : current);
      setNotice("Jawaban ditandai benar untuk evaluasi training.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan penilaian jawaban.");
    }
  }

  async function generateDraft() {
    if (!session) return;
    try {
      setGenerating(true);
      setError("");
      setNotice("");
      const result = await api.generateTrainingKnowledge(session.training_id);
      setDraftResult(result);
      setDraft(result.draft || emptyDraft());
      setDuplicateAction("new");
      setDuplicateArticleId(result.duplicate_candidates[0]?.article_id || "");
      if (!result.can_save) setNotice("Percakapan belum cukup kuat untuk dijadikan draft knowledge.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat kandidat knowledge.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveDraft() {
    if (!session || !draftResult?.can_save || !draft) return;
    if (draftResult.duplicate_candidates.length && !duplicateAction) {
      setError("Pilih terlebih dahulu: update knowledge existing atau buat knowledge baru.");
      return;
    }
    try {
      setSavingDraft(true);
      setError("");
      const article = await api.saveTrainingDraft(
        session.training_id,
        draft,
        duplicateAction || "new",
        duplicateArticleId,
      );
      await createTrainingRoom(`Draft ${article.articleId} tersimpan. Training baru sudah siap digunakan.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan draft knowledge.");
    } finally {
      setSavingDraft(false);
    }
  }

  function updateDraft(patch: Partial<TrainingDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  return (
    <HelpdeskLayout>
      <section className="training-page">
        <div className="training-page-head">
          <div>
            <span className="eyebrow"><Lightbulb size={14} /> Internal Tool</span>
            <h1>Chat Training</h1>
            <p>Uji jawaban NAVA, beri koreksi, lalu siapkan draft knowledge untuk direview Helpdesk.</p>
          </div>
          <div className="training-head-actions">
            <span className={`training-status ${session?.status === "closed" ? "closed" : "active"}`}>
              {session?.status === "closed" ? "Training ditutup" : "Tidak terlihat customer"}
            </span>
            <button className="button secondary" type="button" onClick={startNewTraining} disabled={loading || sending}>
              <Plus size={15} /> Training Baru
            </button>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {notice && <div className="success-box">{notice}</div>}

        <div className="training-layout">
          <section className="training-conversation panel-card">
            <div className="training-panel-head">
              <div>
                <span className="eyebrow"><MessageSquare size={14} /> Conversation</span>
                <h2>{session?.title || "Memuat training..."}</h2>
              </div>
              <small>
                {session?.training_id || "-"}
                {session?.customer_domain ? ` · ${session.customer_domain}` : ""}
              </small>
            </div>

            <div className="training-message-list">
              {loading && <div className="empty-state">Menyiapkan training session...</div>}
              {!loading && !session?.messages.length && <div className="empty-state">Ketik pertanyaan customer untuk mulai menguji NAVA.</div>}
              {session?.messages.map((message, index) => {
                const messageId = message._id || `${message.created_at}-${index}`;
                return (
                  <article className={`training-message training-message-${message.role}`} key={messageId}>
                    <div className="training-message-meta">
                      <strong>{roleLabel(message.role)}</strong>
                      <span>{new Date(message.created_at).toLocaleString("id-ID")}</span>
                    </div>
                    <div className="training-message-content">
                      {message.role === "correction" ? <p>{message.content}</p> : <MessageContent content={message.content} />}
                    </div>
                    {message.metadata?.delivery_status === "failed" && <div className="training-message-delivery-error">Pesan belum mendapat jawaban. Coba kirim ulang jika diperlukan.</div>}
                    {message.role === "assistant" && message.metadata?.evaluation && (
                      <div className={`training-evaluation ${message.metadata.evaluation === "correct" ? "is-correct" : "needs-correction"}`}>
                        {message.metadata.evaluation === "correct" ? "✓ Ditandai benar" : "Perlu koreksi"}
                      </div>
                    )}
                    {message.role === "assistant" && session.status === "active" && (
                      <div className="training-message-actions">
                        <button className={message.metadata?.evaluation === "correct" ? "is-selected" : ""} type="button" onClick={() => markCorrect(messageId)} disabled={message.metadata?.evaluation === "correct"}>
                          <Check size={14} /> {message.metadata?.evaluation === "correct" ? "Sudah Benar" : "Benar"}
                        </button>
                        <button className={message.metadata?.evaluation === "needs_correction" ? "is-selected" : ""} type="button" onClick={() => { setCorrectionFor(messageId); setCorrection(""); setNotice(""); }}>
                          Perlu Koreksi
                        </button>
                      </div>
                    )}
                    {correctionFor === messageId && (
                      <form className="training-correction-form" onSubmit={submitCorrection}>
                        <label>Koreksi / jawaban yang benar
                          <textarea value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="Tulis koreksi Helpdesk..." autoFocus />
                        </label>
                        <div>
                          <button className="button secondary" type="button" onClick={() => setCorrectionFor(null)}>Batal</button>
                          <button className="button primary" type="submit" disabled={sending || !correction.trim()}>{sending ? "Memproses..." : "Kirim Koreksi"}</button>
                        </div>
                      </form>
                    )}
                  </article>
                );
              })}
              {sending && <div className="empty-state">NAVA sedang memproses...</div>}
            </div>

            <form className="training-composer" onSubmit={submitQuestion}>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} disabled={sending || session?.status !== "active"} placeholder={session?.status === "closed" ? "Training sudah ditutup" : "Ketik pertanyaan customer..."} />
              <button className="button primary" type="submit" disabled={sending || session?.status !== "active" || !question.trim()}>
                <SendHorizontal size={16} /> Kirim
              </button>
            </form>
          </section>

          <aside className="training-info panel-card">
            <div className="training-panel-head">
              <div>
                <span className="eyebrow"><FilePlus2 size={14} /> Training Info</span>
                <h2>Draft Knowledge</h2>
              </div>
            </div>
            <p className="training-help-text">Koreksi Helpdesk menjadi acuan utama. Draft tidak langsung published dan tidak membuat ticket customer.</p>
            <button className="button primary training-generate-button" type="button" onClick={generateDraft} disabled={generating || !session || session.messages.length < 2}>
              <Lightbulb size={16} /> {generating ? "Menganalisis..." : "Generate Draft Knowledge"}
            </button>

            {draftResult && (
              <div className="training-draft-result">
                <section className="training-summary">
                  <h3>Ringkasan hasil training</h3>
                  <dl>
                    <div><dt>Konteks</dt><dd>{draftResult.summary.context || "-"}</dd></div>
                    <div><dt>Pertanyaan customer</dt><dd>{draftResult.summary.customer_question || "-"}</dd></div>
                    <div><dt>Kesalahan sebelumnya</dt><dd>{draftResult.summary.previous_answer_issue || "-"}</dd></div>
                    <div><dt>Koreksi Helpdesk</dt><dd>{draftResult.summary.helpdesk_corrections.length ? draftResult.summary.helpdesk_corrections.join(" ") : "-"}</dd></div>
                    <div><dt>Kesimpulan benar</dt><dd>{draftResult.summary.confirmed_conclusion || "-"}</dd></div>
                    <div><dt>Knowledge reusable</dt><dd>{draftResult.summary.reusable_knowledge || "-"}</dd></div>
                  </dl>
                  {draftResult.summary.solution_steps.length > 0 && <><strong>Langkah solusi</strong><ol>{draftResult.summary.solution_steps.map((step) => <li key={step}>{step}</li>)}</ol></>}
                  {draftResult.missing_confirmation.length > 0 && <div className="training-warning">{draftResult.missing_confirmation.join(" ")}</div>}
                </section>

                {draftResult.can_save && draftResult.draft && (
                  <section className="training-draft-editor">
                    <div className="training-editor-title"><h3>Preview & edit draft</h3><small>Sumber: {session?.training_id}</small></div>
                    <label>Judul<input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
                    <div className="training-form-grid">
                      <label>Kategori<input value={draft.category} onChange={(event) => updateDraft({ category: event.target.value })} /></label>
                      <label>Program<input value={draft.product} onChange={(event) => updateDraft({ product: event.target.value })} /></label>
                    </div>
                    <label>Symptoms<textarea value={draftLines(draft.symptoms)} onChange={(event) => updateDraft({ symptoms: parseLines(event.target.value) })} /></label>
                    <label>Langkah troubleshooting<textarea value={draft.troubleshootingSteps.map((step) => step.instruction).join("\n")} onChange={(event) => updateDraft({ troubleshootingSteps: parseLines(event.target.value).map((instruction, index) => ({ order: index + 1, title: `Langkah ${index + 1}`, instruction, expectedResult: "Kendala teratasi." })) })} /></label>
                    <label>Template jawaban customer<textarea value={draft.userResponseTemplate} onChange={(event) => updateDraft({ userResponseTemplate: event.target.value })} /></label>
                    <label>Tags<textarea value={draftLines(draft.tags)} onChange={(event) => updateDraft({ tags: parseLines(event.target.value) })} /></label>
                    <label>Internal Notes<textarea value={draft.internalNotes} onChange={(event) => updateDraft({ internalNotes: event.target.value })} /></label>

                    {draftResult.duplicate_candidates.length > 0 && (
                      <div className="training-duplicates">
                        <h3>Knowledge serupa ditemukan</h3>
                        <p>Draft baru tidak akan menimpa artikel published.</p>
                        <select value={duplicateArticleId} onChange={(event) => setDuplicateArticleId(event.target.value)}>
                          {draftResult.duplicate_candidates.map((candidate) => <option value={candidate.article_id} key={candidate.article_id}>{candidate.title} · {candidate.category || "tanpa kategori"}</option>)}
                        </select>
                        <div className="training-duplicate-actions">
                          <button className={`button ${duplicateAction === "new" ? "primary" : "secondary"}`} type="button" onClick={() => setDuplicateAction("new")}><Plus size={15} /> Buat Knowledge Baru</button>
                          <button className={`button ${duplicateAction === "update_existing" ? "primary" : "secondary"}`} type="button" onClick={() => setDuplicateAction("update_existing")}><CheckCircle2 size={15} /> Buat Draft Update</button>
                        </div>
                      </div>
                    )}

                    <button className="button primary training-save-button" type="button" onClick={saveDraft} disabled={savingDraft || Boolean(session?.knowledge_draft_id)}>
                      <FilePlus2 size={15} /> {savingDraft ? "Menyimpan..." : session?.knowledge_draft_id ? "Draft Sudah Tersimpan" : "Simpan sebagai Draft"}
                    </button>
                  </section>
                )}
              </div>
            )}
          </aside>
        </div>
      </section>
    </HelpdeskLayout>
  );
}
