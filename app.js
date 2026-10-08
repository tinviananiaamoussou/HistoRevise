"use strict";

/* ---------- Supabase ---------- */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/* ---------- Constantes de navigation ---------- */
const TABS = [
  { key: "chat", path: "#/", label: "Chat IA", icon: "💬" },
  { key: "coffre", path: "#/coffre", label: "Coffre-fort", icon: "🗂️" },
  { key: "atlas", path: "#/atlas", label: "Atlas 2D", icon: "🫀" },
  { key: "qcm", path: "#/qcm", label: "QCM", icon: "📝" },
  { key: "suivi", path: "#/suivi", label: "Suivi", icon: "📊" },
];

const EDGE_CHAT_URL = SUPABASE_URL + "/functions/v1/chat";
const EDGE_GENERATE_QCM_URL = SUPABASE_URL + "/functions/v1/generate-qcm";
const EDGE_GRADE_QCM_URL = SUPABASE_URL + "/functions/v1/grade-qcm";
const SESSION_KEY = "histo_session_id_v1";
function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

const PLACEHOLDERS = {
  atlas: {
    title: "Atlas 2D",
    icon: "🫀",
    desc: "Explorez une silhouette humaine, organe par organe, avec des coupes histologiques annotées.",
  },
};

const FILE_ICON = { pdf: "📄", txt: "📃", image: "🖼️" };
const CACHE_KEY = "histo_documents_cache_v1";

/* ---------- Utilitaires ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function fmtDate(d) {
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function toast(message, isError = false) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, 2600);
}
function mdLite(text) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\n/g, "<br>");
  return s;
}
function fileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".txt")) return "txt";
  if (file.type.startsWith("image/")) return "image";
  return null;
}
function openModal(innerHTML) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-sheet">${innerHTML}</div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

/* ---------- Extraction de texte ---------- */
async function extractText(file, kind) {
  try {
    if (kind === "txt") {
      return await file.text();
    }
    if (kind === "pdf" && window.pdfjsLib) {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it) => it.str).join(" ") + "\n";
      }
      return text.trim();
    }
  } catch (e) {
    console.warn("Extraction texte échouée :", e);
  }
  return null;
}

/* ---------- Coffre-fort : accès données ---------- */
const Vault = {
  async list() {
    const { data, error } = await sb.from("documents").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    return data;
  },
  cached() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
  },
  async add({ file, kind, title, chapter, extracted_text }) {
    const path = `${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error: upErr } = await sb.storage.from("documents").upload(path, file, {
      contentType: file.type || undefined,
    });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from("documents").getPublicUrl(path);
    const { error: dbErr } = await sb.from("documents").insert({
      title, chapter, file_type: kind, file_path: pub.publicUrl, extracted_text,
    });
    if (dbErr) throw dbErr;
  },
  async remove(doc) {
    const url = new URL(doc.file_path);
    const marker = "/object/public/documents/";
    const idx = url.pathname.indexOf(marker);
    const storagePath = idx >= 0 ? decodeURIComponent(url.pathname.slice(idx + marker.length)) : null;
    if (storagePath) {
      await sb.storage.from("documents").remove([storagePath]);
    }
    const { error } = await sb.from("documents").delete().eq("id", doc.id);
    if (error) throw error;
  },
};

/* ---------- Rendu : shell + nav ---------- */
function shellHTML(activeKey, title, subtitle, action) {
  return `
    <header class="header">
      <div class="header-inner">
        <div style="flex:1; min-width:0">
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
        </div>
        ${action || ""}
      </div>
    </header>
  `;
}
function navHTML(activeKey) {
  return `
    <nav class="bottom-nav"><div class="bottom-nav-inner">
      ${TABS.map((t) => `
        <a class="nav-item" data-active="${t.key === activeKey}" href="${t.path}">
          <span class="nav-ico">${t.icon}</span><span>${t.label}</span>
        </a>`).join("")}
    </div></nav>
  `;
}

/* ---------- Écran placeholder ---------- */
function renderPlaceholder(root, key) {
  const p = PLACEHOLDERS[key];
  root.innerHTML = `
    <div class="screen">
      ${shellHTML(key, "HistoRévise", p.title)}
      <main class="main">
        <div class="screen-empty">
          <div class="ico">${p.icon}</div>
          <h2>${esc(p.title)} — bientôt disponible</h2>
          <p>${esc(p.desc)}</p>
        </div>
      </main>
      ${navHTML(key)}
    </div>
  `;
}

/* ---------- Écran Coffre-fort ---------- */
async function renderCoffre(root) {
  const cached = Vault.cached();
  root.innerHTML = `
    <div class="screen">
      ${shellHTML("coffre", "Coffre-fort", "Documents du cours")}
      <main class="main">
        <div class="toolbar">
          <select id="filter-chapter"><option value="">Tous les chapitres</option></select>
        </div>
        <div id="doc-list-wrap">
          ${cached ? "" : `<div class="skeleton"></div><div style="height:0.6rem"></div><div class="skeleton"></div>`}
        </div>
      </main>
      <button class="fab" id="btn-add" aria-label="Ajouter un document">+</button>
      ${navHTML("coffre")}
    </div>
  `;

  qs("#btn-add").addEventListener("click", openAddModal);
  qs("#filter-chapter").addEventListener("change", () => renderDocList(state.allDocs, qs("#filter-chapter").value));

  const state = { allDocs: cached || [] };
  if (cached) renderDocList(state.allDocs, "");

  try {
    const docs = await Vault.list();
    state.allDocs = docs;
    renderDocList(docs, qs("#filter-chapter")?.value || "");
  } catch (e) {
    console.error(e);
    if (!cached) {
      qs("#doc-list-wrap").innerHTML = `<div class="screen-empty"><div class="ico">⚠️</div><h2>Connexion impossible</h2><p>Vérifiez votre connexion internet puis réessayez.</p></div>`;
    } else {
      toast("Impossible de rafraîchir la liste (hors-ligne ?)", true);
    }
  }

  function renderDocList(docs, chapterFilter) {
    const chapters = [...new Set(docs.map((d) => d.chapter).filter(Boolean))].sort();
    const sel = qs("#filter-chapter");
    if (sel) {
      const current = chapterFilter;
      sel.innerHTML = `<option value="">Tous les chapitres</option>` +
        chapters.map((c) => `<option value="${esc(c)}" ${c === current ? "selected" : ""}>${esc(c)}</option>`).join("");
    }
    const filtered = chapterFilter ? docs.filter((d) => d.chapter === chapterFilter) : docs;
    const wrap = qs("#doc-list-wrap");
    if (!wrap) return;
    if (filtered.length === 0) {
      wrap.innerHTML = `<div class="screen-empty"><div class="ico">🗂️</div><h2>Aucun document</h2><p>Ajoutez votre premier document avec le bouton "+".</p></div>`;
      return;
    }
    wrap.innerHTML = `<ul class="doc-list">${filtered.map((d) => `
      <li class="doc-row" data-id="${d.id}">
        <span class="doc-ico">${FILE_ICON[d.file_type] || "📄"}</span>
        <span class="doc-info" data-action="preview" data-id="${d.id}">
          <span class="title">${esc(d.title)}</span>
          <span class="meta"><span class="chapter-badge">${esc(d.chapter)}</span>${fmtDate(d.created_at)}</span>
        </span>
        <button class="doc-del" data-action="delete" data-id="${d.id}" aria-label="Supprimer">🗑️</button>
      </li>`).join("")}</ul>`;

    qsa('[data-action="preview"]', wrap).forEach((el) => {
      el.addEventListener("click", () => {
        const doc = docs.find((d) => d.id === el.dataset.id);
        if (doc) openPreview(doc);
      });
    });
    qsa('[data-action="delete"]', wrap).forEach((el) => {
      el.addEventListener("click", async () => {
        const doc = docs.find((d) => d.id === el.dataset.id);
        if (!doc) return;
        if (!confirm(`Supprimer « ${doc.title} » ?`)) return;
        try {
          await Vault.remove(doc);
          toast("Document supprimé");
          const fresh = await Vault.list();
          state.allDocs = fresh;
          renderDocList(fresh, qs("#filter-chapter")?.value || "");
        } catch (e) {
          console.error(e);
          toast("Échec de la suppression", true);
        }
      });
    });
  }

  function openAddModal() {
    const existingChapters = [...new Set(state.allDocs.map((d) => d.chapter).filter(Boolean))];
    const overlay = openModal(`
      <h3>Ajouter un document</h3>
      <form id="form-add">
        <div class="field"><label for="f-file">Fichier (PDF, image ou .txt)</label>
          <input id="f-file" type="file" accept=".pdf,.txt,image/*" required /></div>
        <div class="field"><label for="f-title">Titre</label>
          <input id="f-title" required placeholder="Ex : Épithéliums — cours 3" /></div>
        <div class="field"><label for="f-chapter">Chapitre</label>
          <input id="f-chapter" required list="chapters-list" placeholder="Ex : Tissus épithéliaux" />
          <datalist id="chapters-list">${existingChapters.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        </div>
        <button type="submit" class="btn block" id="btn-submit">Ajouter</button>
      </form>
    `);
    qs("#form-add", overlay).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fileInput = qs("#f-file", overlay);
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const kind = fileKind(file);
      if (!kind) { toast("Type de fichier non pris en charge", true); return; }
      const title = qs("#f-title", overlay).value.trim();
      const chapter = qs("#f-chapter", overlay).value.trim();
      if (!title || !chapter) { toast("Titre et chapitre sont requis", true); return; }

      const btn = qs("#btn-submit", overlay);
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Ajout en cours...`;
      try {
        const extracted_text = await extractText(file, kind);
        await Vault.add({ file, kind, title, chapter, extracted_text });
        overlay.remove();
        toast("Document ajouté");
        const fresh = await Vault.list();
        state.allDocs = fresh;
        renderDocList(fresh, "");
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = "Ajouter";
        toast("Échec de l'ajout : " + (err.message || "erreur inconnue"), true);
      }
    });
  }

  function openPreview(doc) {
    if (doc.file_type === "image") {
      openModal(`<h3>${esc(doc.title)}</h3><img src="${doc.file_path}" alt="${esc(doc.title)}" style="max-width:100%;border-radius:8px" />`);
    } else if (doc.file_type === "pdf") {
      openModal(`<h3>${esc(doc.title)}</h3><iframe class="preview-frame" src="${doc.file_path}"></iframe>`);
    } else if (doc.file_type === "txt") {
      if (doc.extracted_text) {
        openModal(`<h3>${esc(doc.title)}</h3><div class="preview-text">${esc(doc.extracted_text)}</div>`);
      } else {
        fetch(doc.file_path).then((r) => r.text()).then((t) => {
          openModal(`<h3>${esc(doc.title)}</h3><div class="preview-text">${esc(t)}</div>`);
        }).catch(() => toast("Impossible d'ouvrir ce fichier", true));
      }
    }
  }
}

/* ---------- Écran Chat IA ---------- */
function bubbleHTML(role, content, msgIndex) {
  const isUser = role === "user";
  const body = isUser ? esc(content).replace(/\n/g, "<br>") : mdLite(content);
  return `
    <div class="chat-row ${isUser ? "user" : "assistant"}">
      <div class="chat-bubble ${isUser ? "user" : "assistant"}">${body}</div>
      ${!isUser ? `
        <div class="chat-actions" data-for="${msgIndex}">
          <button class="link-btn" data-action="unclear" data-idx="${msgIndex}">Pas clair 🤔</button>
          <div class="whatsapp-wrap" data-wa-for="${msgIndex}" hidden></div>
        </div>` : ""}
    </div>`;
}

function openWhatsappSettingsModal(currentNumber, onSaved) {
  const overlay = openModal(`
    <h3>Contact de l'assistant du Professeur</h3>
    <p class="muted-note" style="margin-bottom:0.9rem">Numéro WhatsApp utilisé par le bouton "Pas clair" dans le chat. Avec l'indicatif pays, sans espaces (ex : 22900000000).</p>
    <div class="field"><label for="f-whatsapp">Numéro WhatsApp</label>
      <input id="f-whatsapp" value="${esc(currentNumber || "")}" placeholder="22900000000" inputmode="tel" /></div>
    <button class="btn block" id="btn-save-whatsapp">Enregistrer</button>
  `);
  qs("#btn-save-whatsapp", overlay).addEventListener("click", async () => {
    const value = qs("#f-whatsapp", overlay).value.trim();
    const btn = qs("#btn-save-whatsapp", overlay);
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Enregistrement...`;
    try {
      const { error } = await sb.from("app_settings").upsert({ key: "whatsapp_number", value });
      if (error) throw error;
      overlay.remove();
      toast("Numéro WhatsApp enregistré");
      onSaved(value);
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = "Enregistrer";
      toast("Échec de l'enregistrement", true);
    }
  });
}

async function renderChat(root) {
  const sessionId = getSessionId();
  root.innerHTML = `
    <div class="screen">
      ${shellHTML("chat", "HistoRévise", "Chat IA — répond à partir de votre coffre-fort", `<button class="header-action" id="btn-chat-settings" aria-label="Réglages">⚙️</button>`)}
      <main class="main chat-main">
        <div id="chat-list" class="chat-list"><div class="skeleton"></div></div>
      </main>
      <form id="chat-form" class="chat-input-bar">
        <input id="chat-input" type="text" placeholder="Posez votre question..." autocomplete="off" required />
        <button type="submit" class="btn" id="chat-send">➤</button>
      </form>
      ${navHTML("chat")}
    </div>
  `;

  let messages = [];
  let whatsappNumber = "";

  try {
    const [{ data: hist }, { data: settings }] = await Promise.all([
      sb.from("chat_messages").select("role, content").eq("session_id", sessionId).order("created_at", { ascending: true }),
      sb.from("app_settings").select("value").eq("key", "whatsapp_number").maybeSingle(),
    ]);
    messages = hist || [];
    whatsappNumber = (settings && settings.value) || "";
  } catch (e) {
    console.error(e);
  }

  renderMessages();

  qs("#btn-chat-settings").addEventListener("click", () => {
    openWhatsappSettingsModal(whatsappNumber, (newValue) => {
      whatsappNumber = newValue;
    });
  });

  function renderMessages() {
    const list = qs("#chat-list");
    if (messages.length === 0) {
      list.innerHTML = `<div class="screen-empty"><div class="ico">💬</div><h2>Posez votre première question</h2><p>L'IA répond uniquement à partir des documents de votre coffre-fort, avec citation des sources.</p></div>`;
      return;
    }
    list.innerHTML = messages.map((m, i) => bubbleHTML(m.role, m.content, i)).join("");
    qsa('[data-action="unclear"]', list).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = btn.dataset.idx;
        const wrap = qs(`[data-wa-for="${idx}"]`, list);
        if (!whatsappNumber) {
          wrap.innerHTML = `<p class="muted-note">Le contact de l'assistant du Professeur n'est pas encore configuré.</p>`;
        } else {
          const q = messages[idx - 1]?.content || "";
          const a = messages[idx]?.content || "";
          const text = `Bonjour, j'ai une question sur HistoRévise.\n\nMa question : ${q}\n\nRéponse de l'IA : ${a}\n\nPouvez-vous m'aider ?`;
          wrap.innerHTML = `<a class="btn whatsapp" target="_blank" rel="noopener" href="https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(text)}">💬 Demander à l'assistant du Professeur</a>`;
        }
        wrap.hidden = false;
        btn.hidden = true;
      });
    });
    list.scrollTop = list.scrollHeight;
  }

  qs("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = qs("#chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    const sendBtn = qs("#chat-send");
    sendBtn.disabled = true;
    messages.push({ role: "user", content: text });
    messages.push({ role: "assistant", content: "…" });
    renderMessages();

    try {
      const resp = await fetch(EDGE_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Erreur serveur");
      messages[messages.length - 1] = { role: "assistant", content: data.answer };
    } catch (err) {
      console.error(err);
      messages[messages.length - 1] = { role: "assistant", content: "⚠️ Erreur : impossible d'obtenir une réponse pour le moment." };
    }
    renderMessages();
    sendBtn.disabled = false;
  });
}

/* ---------- Écran QCM ---------- */
async function renderQcm(root, presetChapter, focusConcepts) {
  const sessionId = getSessionId();
  root.innerHTML = `
    <div class="screen">
      ${shellHTML("qcm", "HistoRévise", "QCM — niveau concours")}
      <main class="main" id="qcm-main">
        ${focusConcepts && focusConcepts.length ? `
          <div class="focus-banner">🎯 QCM ciblé sur vos points faibles : ${focusConcepts.map(esc).join(", ")}</div>
        ` : ""}
        <div class="form-card">
          <div class="field"><label for="qcm-chapter">Chapitre</label>
            <select id="qcm-chapter"><option value="">Chargement…</option></select></div>
          <div class="field"><label for="qcm-count">Nombre de questions</label>
            <select id="qcm-count">
              <option value="5">5 questions</option>
              <option value="10">10 questions</option>
              <option value="15">15 questions</option>
              <option value="20">20 questions</option>
            </select></div>
          <button class="btn block" id="qcm-generate">Générer le QCM</button>
        </div>
        <div id="qcm-body"></div>
      </main>
      ${navHTML("qcm")}
    </div>
  `;

  let whatsappNumber = "";
  try {
    const [{ data: docs }, { data: settings }] = await Promise.all([
      sb.from("documents").select("chapter"),
      sb.from("app_settings").select("value").eq("key", "whatsapp_number").maybeSingle(),
    ]);
    whatsappNumber = (settings && settings.value) || "";
    const chapters = [...new Set((docs || []).map((d) => d.chapter).filter(Boolean))].sort();
    const sel = qs("#qcm-chapter");
    sel.innerHTML = chapters.length
      ? chapters.map((c) => `<option value="${esc(c)}" ${c === presetChapter ? "selected" : ""}>${esc(c)}</option>`).join("")
      : `<option value="">Aucun chapitre — ajoutez des documents</option>`;
  } catch (e) {
    console.error(e);
    qs("#qcm-chapter").innerHTML = `<option value="">Erreur de chargement</option>`;
  }

  qs("#qcm-generate").addEventListener("click", async () => {
    const chapter = qs("#qcm-chapter").value;
    const count = qs("#qcm-count").value;
    if (!chapter) { toast("Choisissez un chapitre", true); return; }
    const btn = qs("#qcm-generate");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Génération en cours (peut prendre 20-30s)...`;
    const body = qs("#qcm-body");
    body.innerHTML = "";
    try {
      const resp = await fetch(EDGE_GENERATE_QCM_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId, chapter, num_questions: Number(count),
          focus_concepts: chapter === presetChapter ? focusConcepts : undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Erreur serveur");
      renderQuizForm(data.attempt_id, data.questions, chapter);
    } catch (e) {
      console.error(e);
      toast("Échec de la génération : " + (e.message || "erreur"), true);
    }
    btn.disabled = false;
    btn.textContent = "Générer le QCM";
  });

  function renderQuizForm(attemptId, questions, chapter) {
    const body = qs("#qcm-body");
    body.innerHTML = `
      <h3 class="section-title">${esc(chapter)} — ${questions.length} questions</h3>
      <form id="qcm-quiz-form">
        ${questions.map((q, qi) => `
          <div class="qcm-question">
            <p class="qcm-statement"><strong>${qi + 1}.</strong> ${esc(q.statement)}</p>
            ${q.propositions.map((p) => `
              <label class="qcm-prop">
                <input type="checkbox" data-qid="${q.id}" data-label="${p.label}" />
                <span><strong>${p.label}.</strong> ${esc(p.text)}</span>
              </label>
            `).join("")}
          </div>
        `).join("")}
        <button type="submit" class="btn block">Valider mes réponses</button>
      </form>
    `;
    qs("#qcm-quiz-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const answers = {};
      qsa('#qcm-quiz-form input[type="checkbox"]').forEach((cb) => {
        const qid = cb.dataset.qid;
        answers[qid] = answers[qid] || {};
        answers[qid][cb.dataset.label] = cb.checked;
      });
      const submitBtn = qs('#qcm-quiz-form button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner"></span> Correction...`;
      try {
        const resp = await fetch(EDGE_GRADE_QCM_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attempt_id: attemptId, answers }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Erreur serveur");
        renderCorrection(data);
      } catch (err) {
        console.error(err);
        toast("Échec de la correction", true);
        submitBtn.disabled = false;
        submitBtn.textContent = "Valider mes réponses";
      }
    });
  }

  function renderCorrection(data) {
    const body = qs("#qcm-body");
    const pct = Math.round((data.score / data.total) * 100);
    body.innerHTML = `
      <div class="qcm-score-card">
        <div class="qcm-score-num">${data.score}/${data.total}</div>
        <p>questions entièrement correctes (${pct}%)</p>
      </div>
      ${data.questions.map((q, qi) => `
        <div class="qcm-question">
          <p class="qcm-statement"><strong>${qi + 1}.</strong> ${esc(q.statement)}
            ${q.fully_correct ? `<span class="qcm-badge good">✓ Correct</span>` : `<span class="qcm-badge bad">✗ À revoir</span>`}
          </p>
          ${q.propositions.map((p) => `
            <div class="qcm-correction-row ${p.is_right ? "right" : "wrong"}">
              <div class="qcm-correction-head">
                <strong>${p.label}.</strong> ${esc(p.text)}
                <span class="qcm-tag ${p.correct ? "good" : "bad"}">${p.correct ? "Vrai" : "Faux"}</span>
                ${p.is_right ? "" : `<span class="qcm-tag miss">Votre réponse : ${p.student_said_true ? "Vrai" : "Faux"}</span>`}
              </div>
              <p class="qcm-just">${esc(p.justification)}</p>
              ${p.trap ? `<p class="qcm-trap">⚠️ Piège : ${esc(p.trap)}</p>` : ""}
              <p class="qcm-recall">💡 ${esc(p.concept_recall)}</p>
            </div>
          `).join("")}
          ${!q.fully_correct && whatsappNumber ? `
            <a class="btn whatsapp" style="margin-top:0.6rem" target="_blank" rel="noopener"
               href="https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(`Bonjour, j'ai une question sur le chapitre "${data.chapter}" (QCM) :\n\n${q.statement}\n\nJe n'ai pas bien compris cette notion, pouvez-vous m'aider ?`)}">
              💬 Demander à l'assistant du Professeur
            </a>` : ""}
        </div>
      `).join("")}
      <button class="btn secondary block" id="qcm-restart">Nouveau QCM</button>
    `;
    qs("#qcm-restart").addEventListener("click", () => renderQcm(document.getElementById("app")));
    body.scrollIntoView({ behavior: "smooth" });
  }
}

/* ---------- Écran Suivi ---------- */
async function renderSuivi(root) {
  const sessionId = getSessionId();
  root.innerHTML = `
    <div class="screen">
      ${shellHTML("suivi", "HistoRévise", "Suivi et révision")}
      <main class="main" id="suivi-main">
        <div class="skeleton"></div>
      </main>
      ${navHTML("suivi")}
    </div>
  `;

  let attempts = [], cards = [];
  try {
    const [{ data: a }, { data: c }] = await Promise.all([
      sb.from("qcm_attempts").select("chapter, score, total, completed_at").eq("session_id", sessionId).not("completed_at", "is", null),
      sb.from("flashcards").select("*").eq("session_id", sessionId).order("next_review_at", { ascending: true }),
    ]);
    attempts = a || [];
    cards = c || [];
  } catch (e) {
    console.error(e);
  }

  const main = qs("#suivi-main");

  if (attempts.length === 0 && cards.length === 0) {
    main.innerHTML = `<div class="screen-empty"><div class="ico">📊</div><h2>Rien à afficher pour l'instant</h2><p>Fais un premier QCM : tes scores et tes points à retravailler apparaîtront ici.</p></div>`;
    return;
  }

  // Scores par chapitre
  const byChapter = {};
  attempts.forEach((a) => {
    byChapter[a.chapter] = byChapter[a.chapter] || { score: 0, total: 0 };
    byChapter[a.chapter].score += a.score;
    byChapter[a.chapter].total += a.total;
  });

  // Notions / flashcards par chapitre
  const cardsByChapter = {};
  cards.forEach((c) => { (cardsByChapter[c.chapter] = cardsByChapter[c.chapter] || []).push(c); });

  const now = new Date();
  const dueCards = cards.filter((c) => new Date(c.next_review_at) <= now);

  main.innerHTML = `
    <h3 class="section-title">Scores par chapitre</h3>
    <div class="score-grid">
      ${Object.entries(byChapter).map(([chapter, s]) => {
        const pct = Math.round((s.score / s.total) * 100);
        const level = pct >= 80 ? "good" : pct >= 50 ? "warn" : "bad";
        return `<div class="score-chip ${level}"><strong>${pct}%</strong><span>${esc(chapter)}</span></div>`;
      }).join("")}
    </div>

    ${dueCards.length > 0 ? `
      <h3 class="section-title">Flashcards à réviser aujourd'hui (${dueCards.length})</h3>
      <div id="flashcard-zone"></div>
    ` : cards.length > 0 ? `<h3 class="section-title">Flashcards</h3><p class="muted-note">Rien à réviser aujourd'hui — prochaines échéances à venir.</p>` : ""}

    ${Object.keys(cardsByChapter).length > 0 ? `
      <h3 class="section-title">Notions à travailler</h3>
      ${Object.entries(cardsByChapter).map(([chapter, list]) => {
        const concepts = [...new Set(list.map((c) => c.concept))];
        return `
          <div class="weak-chapter-card">
            <p class="weak-chapter-title">${esc(chapter)}</p>
            <ul class="weak-concepts">${concepts.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
            <a class="btn secondary block" href="#/qcm?chapter=${encodeURIComponent(chapter)}&focus=${encodeURIComponent(concepts.join("|||"))}">🎯 QCM sur mes points faibles</a>
          </div>`;
      }).join("")}
    ` : ""}
  `;

  if (dueCards.length > 0) renderFlashcardZone(dueCards, 0);

  function renderFlashcardZone(queue, idx) {
    const zone = qs("#flashcard-zone");
    if (!zone) return;
    if (idx >= queue.length) {
      zone.innerHTML = `<div class="screen-empty"><div class="ico">✅</div><h2>Révision terminée</h2><p>Reviens demain pour la suite.</p></div>`;
      return;
    }
    const card = queue[idx];
    zone.innerHTML = `
      <div class="flashcard" id="flashcard-el">
        <p class="flashcard-chapter">${esc(card.chapter)} · ${esc(card.concept)}</p>
        <p class="flashcard-front"><strong>${esc(card.proposition_label)}.</strong> ${esc(card.proposition_text)}</p>
        <button class="btn secondary block" id="flashcard-flip">Retourner la carte</button>
        <div class="flashcard-back" id="flashcard-back" hidden>
          <p>${esc(card.justification)}</p>
          <div class="flashcard-actions">
            <button class="btn destructive" id="flashcard-no">Je ne savais pas</button>
            <button class="btn" id="flashcard-yes">Je savais ✓</button>
          </div>
        </div>
      </div>
      <p class="muted-note" style="text-align:center;margin-top:0.5rem">${idx + 1} / ${queue.length}</p>
    `;
    qs("#flashcard-flip").addEventListener("click", () => {
      qs("#flashcard-back").hidden = false;
      qs("#flashcard-flip").hidden = true;
    });
    qs("#flashcard-yes").addEventListener("click", () => reviewCard(card, true, queue, idx));
    qs("#flashcard-no").addEventListener("click", () => reviewCard(card, false, queue, idx));
  }

  async function reviewCard(card, knew, queue, idx) {
    const newInterval = knew ? Math.min((card.interval_days || 1) * 2, 60) : 1;
    const nextReview = new Date(Date.now() + newInterval * 86400000).toISOString();
    try {
      await sb.from("flashcards").update({ interval_days: newInterval, next_review_at: nextReview }).eq("id", card.id);
    } catch (e) { console.error(e); }
    renderFlashcardZone(queue, idx + 1);
  }
}

/* ---------- Routeur ---------- */
async function render() {
  const root = document.getElementById("app");
  const hash = (location.hash || "#/").replace(/^#/, "");
  const path = hash.split("?")[0];
  const query = new URLSearchParams(hash.split("?")[1] || "");
  if (path === "/coffre") {
    await renderCoffre(root);
  } else if (path === "/") {
    await renderChat(root);
  } else if (path === "/atlas") {
    renderPlaceholder(root, "atlas");
  } else if (path === "/qcm") {
    const presetChapter = query.get("chapter") || undefined;
    const focusConcepts = query.get("focus") ? query.get("focus").split("|||") : undefined;
    await renderQcm(root, presetChapter, focusConcepts);
  } else if (path === "/suivi") {
    await renderSuivi(root);
  } else {
    location.hash = "#/";
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
