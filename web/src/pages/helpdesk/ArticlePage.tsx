import { FormEvent, useEffect, useState } from "react";
import { Archive, ArrowUpRight, BookOpenText, CheckCircle2, Plus, Search, Trash2 } from "lucide-react";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import { api } from "../../services/api";
import type { KnowledgeArticle } from "../../types";

const DEFAULT_PRODUCT = "nagagold";

function emptyArticle(): Partial<KnowledgeArticle> {
  return {
    title: "",
    category: "",
    product: DEFAULT_PRODUCT,
    symptoms: [],
    tags: [],
    userResponseTemplate: "",
    troubleshootingSteps: [],
    escalationRules: [],
    internalNotes: "",
  };
}

function articleIssue(article: Partial<KnowledgeArticle>) {
  return article.title || article.symptoms?.[0] || "";
}

function articleSolution(article: Partial<KnowledgeArticle>) {
  return article.userResponseTemplate || article.troubleshootingSteps?.[0]?.instruction || "";
}

function articleProduct(article: Partial<KnowledgeArticle>) {
  const product = (article.product || DEFAULT_PRODUCT).trim();
  return product.toLowerCase() === "navacare" ? DEFAULT_PRODUCT : product;
}

function cleanArticle(article: Partial<KnowledgeArticle>) {
  const issue = articleIssue(article).trim();
  const solution = articleSolution(article).trim();
  return {
    articleId: article.articleId,
    title: issue,
    category: (article.category || "").trim(),
    product: articleProduct(article),
    symptoms: issue ? [issue] : [],
    tags: [],
    userResponseTemplate: solution,
    troubleshootingSteps: solution ? [{
      order: 1,
      title: "Solusi",
      instruction: solution,
      expectedResult: "Kendala teratasi.",
    }] : [],
    escalationRules: [],
    internalNotes: (article.internalNotes || "").trim(),
  };
}

function statusLabel(status?: string) {
  if (status === "published") return "Published";
  if (status === "archived") return "Archived";
  return "Draft";
}

function categoryLabel(value: string) {
  return value ? value.slice(0, 1).toUpperCase() + value.slice(1) : value;
}

export function ArticlePage() {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<Partial<KnowledgeArticle>>(emptyArticle());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(filters = { search, status, category }, keepArticleId = selected.articleId) {
    try {
      setLoading(true);
      setError("");
      const rows = await api.knowledgeArticles({
        search: filters.search,
        status: filters.status,
        category: filters.category,
        limit: "80",
      });
      setArticles(rows);
      if (keepArticleId) {
        const current = rows.find((article) => article.articleId === keepArticleId);
        if (current) setSelected({ ...current, product: articleProduct(current) });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat artikel.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories() {
    try {
      const rows = await api.knowledgeCategories();
      setCategories(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat kategori artikel.");
    }
  }

  useEffect(() => {
    load();
    loadCategories();
  }, []);

  function resetFilters() {
    const emptyFilters = { search: "", status: "", category: "" };
    setSearch("");
    setStatus("");
    setCategory("");
    load(emptyFilters);
  }

  async function saveDraft(event?: FormEvent) {
    event?.preventDefault();
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const payload = cleanArticle(selected);
      if (selected.articleId) {
        await api.updateKnowledgeArticle(selected.articleId, payload, { asDraft: true });
      } else {
        await api.createKnowledgeArticle(payload);
      }
      setNotice("Draft artikel tersimpan.");
      setSelected(emptyArticle());
      await Promise.all([load(undefined, ""), loadCategories()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan artikel.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    try {
      setPublishing(true);
      setError("");
      setNotice("");
      const payload = cleanArticle(selected);
      const saved = selected.articleId
        ? await api.updateKnowledgeArticle(selected.articleId, payload)
        : await api.createKnowledgeArticle(payload);
      const published = await api.publishKnowledgeArticle(saved.articleId);
      setNotice("Artikel sudah published dan embedding siap dipakai.");
      setSelected(emptyArticle());
      await Promise.all([load(undefined, ""), loadCategories()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal publish artikel.");
    } finally {
      setPublishing(false);
    }
  }

  async function savePublishedChanges() {
    if (!selected.articleId) return publish();
    try {
      setPublishing(true);
      setError("");
      setNotice("");
      await api.updateKnowledgeArticle(selected.articleId, cleanArticle(selected));
      setNotice("Perubahan tersimpan dan embedding diperbarui.");
      setSelected(emptyArticle());
      await Promise.all([load(undefined, ""), loadCategories()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan perubahan artikel.");
    } finally {
      setPublishing(false);
    }
  }

  async function archive() {
    if (!selected.articleId) return;
    try {
      setSaving(true);
      setError("");
      const archived = await api.archiveKnowledgeArticle(selected.articleId);
      setSelected(archived);
      setNotice("Artikel diarsipkan dan tidak dipakai NAVA.");
      await load(undefined, archived.articleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal archive artikel.");
    } finally {
      setSaving(false);
    }
  }

  async function removeArchived() {
    if (!selected.articleId || selected.status !== "archived") return;
    try {
      setDeleting(true);
      setError("");
      const result = await api.deleteKnowledgeArticle(selected.articleId);
      setConfirmDelete(false);
      setSelected(emptyArticle());
      setNotice(`Artikel ${result.articleId} berhasil dihapus permanen.`);
      await load(undefined, "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus artikel.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <HelpdeskLayout>
      <section className="article-page">
        <aside className="article-list-panel">
          <div className="article-head">
            <div>
              <span className="eyebrow">Knowledge Bot</span>
              <h1>Artikel</h1>
              <p>Kelola knowledge NAVA.</p>
            </div>
            <div className="article-head-actions">
              <a className="button secondary article-training-button" href="/chat-training" onClick={handleHelpdeskNavigation}>
                Training <ArrowUpRight size={15} />
              </a>
              <button className="button primary" type="button" onClick={() => setSelected(emptyArticle())}>
                <Plus size={15} /> Artikel Baru
              </button>
            </div>
          </div>
          <div className="article-filters">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Semua kategori</option>
              {categories.map((item) => <option value={item} key={item}>{categoryLabel(item)}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Semua status</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
            <div className="article-filter-actions">
              <button className="button secondary" type="button" onClick={() => load()}>Terapkan</button>
              <button className="button secondary" type="button" onClick={resetFilters}>Reset</button>
            </div>
            <label className="search-field">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari kendala, kategori, solusi..." />
            </label>
          </div>
          {error && <div className="error-box">{error}</div>}
          {notice && <div className="success-box">{notice}</div>}
          <div className="article-list">
            {loading && <div className="empty-state">Memuat artikel...</div>}
            {!loading && articles.map((article) => (
              <button
                className={`article-item ${selected.articleId === article.articleId ? "active" : ""}`}
                type="button"
                key={article.articleId}
                onClick={() => setSelected({ ...article, product: articleProduct(article) })}
              >
                <div>
                  <strong>{article.title || "Tanpa kendala"}</strong>
                  <span>{articleProduct(article)} · {article.category || "tanpa kategori"}</span>
                </div>
                <p>{article.userResponseTemplate || "Belum ada jawaban/solusi."}</p>
                <div className="article-badges">
                  <span className={`article-status status-${article.status}`}>{statusLabel(article.status)}</span>
                </div>
              </button>
            ))}
            {!loading && !articles.length && <div className="empty-state">Belum ada artikel.</div>}
          </div>
        </aside>

        <form
          className="article-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected.status === "published") savePublishedChanges();
            else saveDraft();
          }}
        >
          <div className="article-editor-top">
            <div className="section-icon"><BookOpenText size={18} /></div>
            <div>
              <h2>{selected.articleId ? "Edit Artikel" : "Artikel Baru"}</h2>
              <p>{selected.articleId || "Isi kendala customer dan solusi yang sebaiknya dijawab NAVA."}</p>
            </div>
            <span className={`article-status status-${selected.status || "draft"}`}>{statusLabel(selected.status)}</span>
          </div>

          <div className="article-form-grid article-simple-grid">
            <label>
              Program
              <input value={articleProduct(selected)} onChange={(event) => setSelected((current) => ({ ...current, product: event.target.value }))} placeholder="nagagold" />
            </label>
            <label>
              Kategori
              <input list="article-categories" value={selected.category || ""} onChange={(event) => setSelected((current) => ({ ...current, category: event.target.value }))} placeholder="Contoh: login" />
              <datalist id="article-categories">
                {categories.map((item) => <option value={item} key={item} />)}
              </datalist>
            </label>
          </div>

          <label className="article-full-field">
            Kendala / Pertanyaan Customer
            <textarea
              value={articleIssue(selected)}
              onChange={(event) => setSelected((current) => ({
                ...current,
                title: event.target.value,
                symptoms: event.target.value.trim() ? [event.target.value] : [],
              }))}
              placeholder="Contoh: Customer tidak bisa login karena lupa password"
            />
          </label>

          <label className="article-full-field">
            Jawaban / Solusi
            <textarea
              value={articleSolution(selected)}
              onChange={(event) => setSelected((current) => ({
                ...current,
                userResponseTemplate: event.target.value,
                troubleshootingSteps: event.target.value.trim() ? [{
                  order: 1,
                  title: "Solusi",
                  instruction: event.target.value,
                  expectedResult: "Kendala teratasi.",
                }] : [],
              }))}
              placeholder="Tulis jawaban atau langkah solusi yang aman untuk customer."
            />
          </label>

          <div className="article-helper-note">
            Saat di-publish, sistem otomatis membuat gejala, kata kunci, langkah troubleshooting, dan embedding dari isian ini.
          </div>

          <div className="article-actions">
            {selected.status === "published" ? (
              <button className="button primary" type="button" onClick={savePublishedChanges} disabled={saving || publishing}>
                <CheckCircle2 size={15} /> {publishing ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            ) : (
              <>
                <button className="button secondary" type="submit" disabled={saving || publishing}>
                  {saving ? "Menyimpan..." : "Simpan Draft"}
                </button>
                <button className="button primary" type="button" onClick={publish} disabled={saving || publishing}>
                  <CheckCircle2 size={15} /> {publishing ? "Membuat embedding..." : selected.articleId ? "Publish" : "Simpan & Publish"}
                </button>
              </>
            )}
            {selected.articleId && selected.status !== "archived" && (
              <button className="button secondary" type="button" onClick={archive} disabled={saving || publishing}>
                <Archive size={15} /> Archive
              </button>
            )}
            {selected.articleId && selected.status === "archived" && (
              <button className="button danger" type="button" onClick={() => setConfirmDelete(true)} disabled={saving || publishing || deleting}>
                <Trash2 size={15} /> Delete Permanen
              </button>
            )}
          </div>
        </form>
        {confirmDelete && selected.articleId && (
          <div className="confirm-backdrop" role="presentation" onMouseDown={() => setConfirmDelete(false)}>
            <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-article-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="confirm-icon danger">
                <Trash2 size={22} />
              </div>
              <h2 id="delete-article-title">Hapus artikel permanen?</h2>
              <p>Artikel <strong>{selected.title || "ini"}</strong> sudah archived dan akan dihapus dari database. Tindakan ini tidak dapat dibatalkan.</p>
              <div className="confirm-actions">
                <button className="button secondary" type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Batal</button>
                <button className="button danger" type="button" onClick={removeArchived} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Ya, Hapus Permanen"}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </HelpdeskLayout>
  );
}
