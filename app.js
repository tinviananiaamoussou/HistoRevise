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
  qcm: {
    title: "QCM",
    icon: "📝",
    desc: "Générez des QCM de niveau concours à partir de vos documents, avec correction détaillée.",
  },
  suivi: {
    title: "Suivi",
    icon: "📊",
    desc: "Vos scores par chapitre, vos points faibles, et des flashcards de révision espacée.",
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
function shellHTML(activeKey, title, subtitle) {
  return `
    <header class="header">
      <div class="header-inner">
        <div>
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
        </div>
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
  return `
    <div class="chat-row ${isUser ? "user" : "assistant"}">
      <div class="chat-bubble ${isUser ? "user" : "assistant"}">${esc(content).replace(/\n/g, "<br>")}</div>
      ${!isUser ? `
        <div class="chat-actions" data-for="${msgIndex}">
          <button class="link-btn" data-action="unclear" data-idx="${msgIndex}">Pas clair 🤔</button>
          <div class="whatsapp-wrap" data-wa-for="${msgIndex}" hidden></div>
        </div>` : ""}
    </div>`;
}

async function renderChat(root) {
  const sessionId = getSessionId();
  root.innerHTML = `
    <div class="screen">
      ${shellHTML("chat", "HistoRévise", "Chat IA — répond à partir de votre coffre-fort")}
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

/* ---------- Routeur ---------- */
async function render() {
  const root = document.getElementById("app");
  const hash = (location.hash || "#/").replace(/^#/, "");
  const path = hash.split("?")[0];
  if (path === "/coffre") {
    await renderCoffre(root);
  } else if (path === "/") {
    await renderChat(root);
  } else if (path === "/atlas") {
    renderPlaceholder(root, "atlas");
  } else if (path === "/qcm") {
    renderPlaceholder(root, "qcm");
  } else if (path === "/suivi") {
    renderPlaceholder(root, "suivi");
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
