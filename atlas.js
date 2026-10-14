"use strict";
/*
 * HistoRévise — Onglet Atlas (Phase 5)
 * Dépend de app.js (chargé avant) : sb, esc, qs, qsa, toast, openModal, shellHTML, navHTML,
 * getSessionId, fmtDate. N'altère aucun autre écran.
 *
 * Sécurité : AUCUNE écriture directe dans les tables. Tout ajout / suppression de coupe passe
 * par les fonctions SQL atlas_add_section / atlas_delete_section, qui exigent le code d'ajout.
 * Le code n'est jamais stocké côté appareil.
 */

const ATLAS_BUCKET = "atlas";
const ATLAS_MAX_BYTES = 5 * 1024 * 1024; // = limite du bucket
const ATLAS_MAX_SIDE = 2400; // px, côté le plus long après réduction éventuelle
const ATLAS_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ATLAS_CACHE_KEY = "histo_atlas_cache_v1";
const ATLAS_NAME_KEY = "histo_atlas_contributor_v1";

/* Organes fixes (même clés que la table atlas_organs). Repères généraux uniquement :
   à confronter au cours du Professeur ; aucune image n'est inventée. */
const ATLAS_ORGANS_FALLBACK = [
  { key: "peau", name: "Peau", icon: "🧴", position: 1 },
  { key: "rein", name: "Rein", icon: "🫘", position: 2 },
  { key: "intestin", name: "Intestin", icon: "🌀", position: 3 },
];
const ATLAS_REPERES = {
  peau: [
    "Épiderme : épithélium pavimenteux stratifié kératinisé",
    "Derme : couches papillaire et réticulaire (tissu conjonctif)",
    "Hypoderme : tissu adipeux",
    "Annexes : follicules pileux, glandes sébacées, glandes sudoripares",
  ],
  rein: [
    "Cortex : corpuscules rénaux (glomérule + capsule de Bowman), tubes contournés",
    "Médullaire : pyramides, tubes droits, anses de Henlé, tubes collecteurs",
    "Repère d'identification : corpuscule rénal = cortex",
  ],
  intestin: [
    "Muqueuse : villosités et cryptes (glandes de Lieberkühn) dans l'intestin grêle",
    "Épithélium prismatique simple à plateau strié avec cellules caliciformes",
    "Chorion, musculaire muqueuse, sous-muqueuse, musculeuse, séreuse",
  ],
};

const ATLAS_ERRORS = {
  CODE_INVALIDE: "Code d'ajout incorrect.",
  CODE_NON_CONFIGURE: "Le code d'ajout n'est pas encore configuré côté serveur.",
  ORGANE_INCONNU: "Organe inconnu.",
  FICHIER_ABSENT: "Le fichier image n'a pas été trouvé sur le serveur. Réessaie.",
  SECTION_INTROUVABLE: "Cette coupe n'existe plus (déjà supprimée ?).",
};
function atlasErrorMessage(err) {
  const msg = (err && (err.message || err.error_description || err.msg)) || "";
  const m = msg.match(/DONNEES_INVALIDES:\s*(.+)$/);
  if (m) return "Données invalides — " + m[1];
  for (const k of Object.keys(ATLAS_ERRORS)) if (msg.includes(k)) return ATLAS_ERRORS[k];
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Connexion impossible. Vérifie ton réseau.";
  if (/duplicate|unique|23505/i.test(msg)) return "Cette image est déjà enregistrée.";
  return msg || "erreur inconnue";
}

/* ---------- Accès données ---------- */
const AtlasData = {
  readCache() {
    try { return JSON.parse(localStorage.getItem(ATLAS_CACHE_KEY) || "null"); } catch { return null; }
  },
  async load() {
    const [o, s] = await Promise.all([
      sb.from("atlas_organs").select("*").order("position", { ascending: true }),
      sb.from("atlas_sections").select("*").order("created_at", { ascending: false }),
    ]);
    if (o.error) throw o.error;
    if (s.error) throw s.error;
    const data = { organs: o.data || [], sections: s.data || [] };
    try { localStorage.setItem(ATLAS_CACHE_KEY, JSON.stringify(data)); } catch { /* quota : on ignore */ }
    return data;
  },
  publicUrl(path) {
    return sb.storage.from(ATLAS_BUCKET).getPublicUrl(path).data.publicUrl;
  },
  async checkCode(code) {
    const { error } = await sb.rpc("atlas_check_code", { p_code: code });
    if (error) throw error;
  },
  async uploadImage(blob) {
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = `sections/${Date.now()}_${rnd}.${ext}`;
    const { error } = await sb.storage.from(ATLAS_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw error;
    return path;
  },
  async removeFile(path) {
    const { error } = await sb.storage.from(ATLAS_BUCKET).remove([path]);
    if (error) throw error;
  },
  async addSection(code, f, path) {
    const { error } = await sb.rpc("atlas_add_section", {
      p_code: code,
      p_organ_key: f.organ,
      p_title: f.title,
      p_description: f.description,
      p_stain: f.stain,
      p_magnification: f.magnification,
      p_image_path: path,
      p_contributor_name: f.name,
      p_session_id: getSessionId(),
    });
    if (error) throw error;
  },
  async deleteSection(code, id) {
    const { data, error } = await sb.rpc("atlas_delete_section", {
      p_code: code, p_section_id: id, p_session_id: getSessionId(),
    });
    if (error) throw error;
    return data; // chemin du fichier devenu orphelin
  },
};

/* ---------- Préparation de l'image (validation + réduction locale) ---------- */
function atlasMimeOf(file) {
  if (ATLAS_ALLOWED_TYPES.includes(file.type)) return file.type;
  if (!file.type) {
    const n = (file.name || "").toLowerCase();
    if (/\.jpe?g$/.test(n)) return "image/jpeg";
    if (/\.png$/.test(n)) return "image/png";
    if (/\.webp$/.test(n)) return "image/webp";
  }
  return null;
}
async function atlasPrepareImage(file) {
  const mime = atlasMimeOf(file);
  if (!mime) throw new Error("Format non pris en charge : utilise une image JPEG, PNG ou WebP.");
  let bmp = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (file.size > ATLAS_MAX_BYTES) throw new Error("Image trop lourde (5 Mo max) et impossible à réduire sur cet appareil.");
    return file.type ? file : new Blob([file], { type: mime });
  }
  const side = Math.max(bmp.width, bmp.height);
  if (file.size <= ATLAS_MAX_BYTES && side <= ATLAS_MAX_SIDE) {
    bmp.close && bmp.close();
    return file.type ? file : new Blob([file], { type: mime });
  }
  const ratio = Math.min(1, ATLAS_MAX_SIDE / side);
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // fond blanc (PNG transparents → JPEG)
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  for (const q of [0.88, 0.75, 0.6]) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
    if (blob && blob.size <= ATLAS_MAX_BYTES) return blob;
  }
  throw new Error("Image trop lourde même après réduction. Choisis une image plus petite.");
}

/* ---------- Module écran ---------- */
const AtlasModule = (() => {
  let iframe = null;
  let token = 0; // invalide les rendus asynchrones périmés
  let memData = null;

  function teardown() {
    token++;
    if (iframe) {
      try { iframe.src = "about:blank"; } catch { /* ignore */ }
      iframe.remove();
      iframe = null;
    }
  }

  function segHTML(view) {
    return `
      <div class="atlas-seg" role="tablist" aria-label="Volets de l'atlas">
        <a role="tab" aria-selected="${view === "2d"}" data-active="${view === "2d"}" href="#/atlas?view=2d">Lames histologiques 2D</a>
        <a role="tab" aria-selected="${view === "3d"}" data-active="${view === "3d"}" href="#/atlas?view=3d">Exploration 3D</a>
      </div>`;
  }

  async function render(root, query) {
    teardown();
    const my = token;
    const view = query.get("view") === "3d" ? "3d" : "2d";
    root.innerHTML = `
      <div class="screen">
        ${shellHTML("atlas", "HistoRévise", "Atlas")}
        <main class="main">
          ${segHTML(view)}
          <div id="atlas-body"></div>
        </main>
        ${view === "2d" ? `<button class="fab" id="atlas-add" aria-label="Ajouter une coupe">+</button>` : ""}
        ${navHTML("atlas")}
      </div>`;
    const body = qs("#atlas-body", root);
    if (view === "3d") { render3D(body, () => my === token); return; }
    render2D(root, body, query.get("organ"), () => my === token);
  }

  /* ----- Volet 3D ----- */
  function render3D(body, alive) {
    body.innerHTML = `
      <div class="atlas-3d-note">Modèles <strong>schématiques</strong> (biologie cellulaire, histologie, embryologie) : ils ne remplacent ni les lames réelles ni le cours. Le moteur 3D se charge depuis Internet.</div>
      <div class="atlas-3d-wrap" id="atlas-3d-wrap">
        <div class="atlas-3d-loading" id="atlas-3d-loading">Chargement…</div>
      </div>`;
    if (!alive()) return;
    const wrap = qs("#atlas-3d-wrap", body);
    const f = document.createElement("iframe");
    f.className = "atlas-3d-frame";
    f.title = "Exploration 3D";
    f.setAttribute("sandbox", "allow-scripts"); // pas d'accès au stockage ni au DOM de l'app
    f.addEventListener("load", () => {
      const l = qs("#atlas-3d-loading", body);
      if (l) l.remove();
    });
    f.src = "atlas-3d.html?embed=1";
    wrap.appendChild(f);
    iframe = f;
  }

  /* ----- Volet 2D ----- */
  async function render2D(root, body, organParam, alive) {
    const cached = memData || AtlasData.readCache();
    let state = { data: cached, offline: false, loading: !cached, failed: false };
    const organKeyOf = (data) => {
      const organs = (data && data.organs && data.organs.length ? data.organs : ATLAS_ORGANS_FALLBACK);
      return organs.some((o) => o.key === organParam) ? organParam : organs[0].key;
    };
    let current = organKeyOf(cached);
    qs("#atlas-add", root).addEventListener("click", () => openAddModal(state.data, current, refresh));

    function paint() {
      if (!alive()) return;
      const organs = state.data && state.data.organs && state.data.organs.length ? state.data.organs : ATLAS_ORGANS_FALLBACK;
      current = organKeyOf(state.data);
      const organ = organs.find((o) => o.key === current) || organs[0];
      const sections = ((state.data && state.data.sections) || []).filter((s) => s.organ_key === organ.key);
      const reperes = ATLAS_REPERES[organ.key] || [];
      body.innerHTML = `
        ${state.offline ? `<div class="atlas-banner">Connexion impossible — affichage de la dernière liste enregistrée (les images peuvent ne pas s'afficher).</div>` : ""}
        <div class="atlas-chips" role="tablist" aria-label="Organes">
          ${organs.map((o) => `<a role="tab" class="atlas-chip" aria-selected="${o.key === organ.key}" data-active="${o.key === organ.key}" href="#/atlas?view=2d&amp;organ=${encodeURIComponent(o.key)}"><span>${esc(o.icon || "")}</span> ${esc(o.name)}</a>`).join("")}
        </div>
        <section class="atlas-card">
          <h2>${esc(organ.name)} — repères à observer</h2>
          ${reperes.length ? `<ul>${reperes.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
          <p class="atlas-small">Repères généraux, à confronter à ton cours. Les coupes ci-dessous sont de vraies lames ajoutées par le Professeur, son assistant ou des étudiants.</p>
        </section>
        <h3 class="atlas-h3">Coupes réelles${state.loading ? "" : ` (${sections.length})`}</h3>
        ${state.loading
          ? `<div class="atlas-empty"><span class="spinner"></span> Chargement…</div>`
          : state.failed
            ? `<div class="atlas-empty">Impossible de charger l'atlas pour le moment.<br><button class="btn secondary" id="atlas-retry" style="margin-top:.7rem">Réessayer</button></div>`
            : sections.length
              ? `<div class="atlas-grid">${sections.map((s) => `
                  <button class="atlas-thumb" data-id="${esc(s.id)}">
                    <img loading="lazy" src="${esc(AtlasData.publicUrl(s.image_path))}" alt="${esc(s.title)}" />
                    <span class="atlas-thumb-title">${esc(s.title)}</span>
                    <span class="atlas-thumb-meta">${esc([s.stain, s.magnification].filter(Boolean).join(" · ") || "—")}</span>
                  </button>`).join("")}</div>`
              : `<div class="atlas-empty"><div class="ico">🔬</div><strong>Aucune coupe réelle pour ${esc(organ.name.toLowerCase())} pour l'instant.</strong><br>Le Professeur ou son assistant peut en ajouter avec le bouton <b>+</b> (code d'ajout requis).</div>`}
      `;
      qsa(".atlas-thumb", body).forEach((b) => b.addEventListener("click", () => {
        const sec = sections.find((s) => s.id === b.dataset.id);
        if (sec) openViewer(sec, refresh);
      }));
      const retry = qs("#atlas-retry", body);
      if (retry) retry.addEventListener("click", refresh);
    }

    async function refresh() {
      state.loading = !state.data; state.failed = false; paint();
      try {
        const fresh = await AtlasData.load();
        if (!alive()) return;
        memData = fresh;
        state = { data: fresh, offline: false, loading: false, failed: false };
      } catch (err) {
        console.warn("Atlas : chargement échoué", err);
        if (!alive()) return;
        state = state.data
          ? { data: state.data, offline: true, loading: false, failed: false }
          : { data: null, offline: false, loading: false, failed: true };
      }
      paint();
    }

    paint();
    await refresh();
  }

  /* ----- Visionneuse + suppression ----- */
  function openViewer(sec, onChanged) {
    const url = AtlasData.publicUrl(sec.image_path);
    const overlay = openModal(`
      <h3>${esc(sec.title)}</h3>
      <img class="atlas-viewer-img" src="${esc(url)}" alt="${esc(sec.title)}" />
      <p class="atlas-meta">${esc([sec.stain && "Coloration : " + sec.stain, sec.magnification && "Grossissement : " + sec.magnification].filter(Boolean).join(" · "))}</p>
      ${sec.description ? `<p class="atlas-desc">${esc(sec.description).replace(/\n/g, "<br>")}</p>` : ""}
      <p class="atlas-small">Ajouté par <strong>${esc(sec.contributor_name)}</strong> le ${esc(fmtDate(sec.created_at))}</p>
      <div class="atlas-actions">
        <a class="btn secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ouvrir l'image</a>
        <button class="btn destructive" id="atlas-del">Supprimer…</button>
      </div>`);
    qs("#atlas-del", overlay).addEventListener("click", () => {
      overlay.remove();
      openDeleteModal(sec, onChanged);
    });
  }

  function openDeleteModal(sec, onChanged) {
    const overlay = openModal(`
      <h3>Supprimer cette coupe ?</h3>
      <p class="atlas-small">« ${esc(sec.title)} » sera retirée de l'atlas. Cette action est définitive. Le code d'ajout est requis.</p>
      <form id="atlas-del-form" autocomplete="off">
        <div class="field"><label for="d-code">Code d'ajout</label>
          <input id="d-code" type="password" required autocomplete="off" autocapitalize="none" spellcheck="false" /></div>
        <p class="atlas-err" id="d-err" role="alert"></p>
        <button type="submit" class="btn destructive block" id="d-submit">Supprimer définitivement</button>
      </form>`);
    qs("#atlas-del-form", overlay).addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = qs("#d-err", overlay); err.textContent = "";
      const btn = qs("#d-submit", overlay);
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Suppression…`;
      try {
        const path = await AtlasData.deleteSection(qs("#d-code", overlay).value, sec.id);
        let fileNote = "";
        if (path) {
          try { await AtlasData.removeFile(path); } catch (e2) { console.warn("Fichier orphelin non retiré", e2); fileNote = " (fichier à nettoyer plus tard)"; }
        }
        overlay.remove();
        toast("Coupe supprimée" + fileNote);
        await onChanged();
      } catch (e3) {
        btn.disabled = false; btn.textContent = "Supprimer définitivement";
        err.textContent = "Échec : " + atlasErrorMessage(e3);
      }
    });
  }

  /* ----- Ajout ----- */
  function openAddModal(data, currentOrgan, onChanged) {
    const organs = data && data.organs && data.organs.length ? data.organs : ATLAS_ORGANS_FALLBACK;
    let savedName = "";
    try { savedName = localStorage.getItem(ATLAS_NAME_KEY) || ""; } catch { /* ignore */ }
    const overlay = openModal(`
      <h3>Ajouter une coupe réelle</h3>
      <form id="atlas-add-form" autocomplete="off">
        <div class="field"><label for="a-organ">Organe</label>
          <select id="a-organ" required>${organs.map((o) => `<option value="${esc(o.key)}"${o.key === currentOrgan ? " selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="a-title">Titre</label>
          <input id="a-title" required minlength="3" maxlength="120" placeholder="Ex : Peau fine — coupe verticale" /></div>
        <div class="field"><label for="a-stain">Coloration (facultatif)</label>
          <input id="a-stain" maxlength="60" placeholder="Ex : HE" /></div>
        <div class="field"><label for="a-mag">Grossissement (facultatif)</label>
          <input id="a-mag" maxlength="30" placeholder="Ex : x100" /></div>
        <div class="field"><label for="a-desc">Description (facultatif)</label>
          <textarea id="a-desc" maxlength="1000" rows="3" placeholder="Ce qu'on observe, repères…"></textarea></div>
        <div class="field"><label for="a-name">Ton nom (affiché comme auteur de l'ajout)</label>
          <input id="a-name" required minlength="2" maxlength="80" value="${esc(savedName)}" /></div>
        <div class="field"><label for="a-file">Image (JPEG, PNG ou WebP)</label>
          <input id="a-file" type="file" accept="image/jpeg,image/png,image/webp" required />
          <span class="atlas-small">5 Mo max — les photos plus lourdes sont réduites automatiquement. Uniquement de vraies coupes.</span></div>
        <div class="field"><label for="a-code">Code d'ajout</label>
          <input id="a-code" type="password" required autocomplete="off" autocapitalize="none" spellcheck="false" /></div>
        <p class="atlas-err" id="a-err" role="alert"></p>
        <button type="submit" class="btn block" id="a-submit">Ajouter à l'atlas</button>
      </form>`);
    qs("#atlas-add-form", overlay).addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = qs("#a-err", overlay); err.textContent = "";
      const btn = qs("#a-submit", overlay);
      const fail = (m) => { err.textContent = m; btn.disabled = false; btn.textContent = "Ajouter à l'atlas"; };
      const file = qs("#a-file", overlay).files[0];
      if (!file) return fail("Choisis une image.");
      const fields = {
        organ: qs("#a-organ", overlay).value,
        title: qs("#a-title", overlay).value.trim(),
        stain: qs("#a-stain", overlay).value.trim(),
        magnification: qs("#a-mag", overlay).value.trim(),
        description: qs("#a-desc", overlay).value.trim(),
        name: qs("#a-name", overlay).value.trim(),
      };
      const code = qs("#a-code", overlay).value;
      if (fields.title.length < 3) return fail("Le titre doit faire au moins 3 caractères.");
      if (fields.name.length < 2) return fail("Indique ton nom (2 caractères minimum).");

      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Vérification…`;
      let uploadedPath = null;
      try {
        const blob = await atlasPrepareImage(file);          // validation locale du type + taille
        await AtlasData.checkCode(code);                     // échoue vite si le code est faux
        btn.innerHTML = `<span class="spinner"></span> Envoi de l'image…`;
        uploadedPath = await AtlasData.uploadImage(blob);
        btn.innerHTML = `<span class="spinner"></span> Enregistrement…`;
        await AtlasData.addSection(code, fields, uploadedPath);
        uploadedPath = null; // référencé : ne pas nettoyer
        try { localStorage.setItem(ATLAS_NAME_KEY, fields.name); } catch { /* ignore */ }
        overlay.remove();
        toast("Coupe ajoutée à l'atlas");
        await onChanged();
      } catch (e2) {
        if (uploadedPath) { AtlasData.removeFile(uploadedPath).catch(() => {}); } // retire l'orphelin
        fail("Échec : " + atlasErrorMessage(e2));
      }
    });
  }

  return { render, teardown, _hasFrame: () => !!iframe };
})();
