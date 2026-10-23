/* QCM GESTOCI v2.0 — espace administrateur
 * v2.0 : connexion par compte Supabase, plusieurs QCM (un par présentation),
 *        import des questions depuis le modèle Excel, choix du QCM en cours,
 *        résultats par QCM, export CSV généré dans le navigateur.
 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const api = window.QcmApi;
  const DEMO = api.mode === "demo";
  const LETTRES = ["A", "B", "C", "D"];

  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const fr = (n) => (n == null ? "–" : String(n).replace(".", ","));
  const plur = (n, mot) => n + " " + mot + (n > 1 ? "s" : "");
  const fmtDateJour = (iso) => { const [y, m, d] = String(iso).split("-"); return d && m && y ? d + "/" + m + "/" + y : iso; };
  const aujourdhui = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  let qcms = [];
  let courant = null;          // QCM affiché (résultats ou édition)
  let resultats = [];
  let importees = null;        // questions lues dans le fichier Excel
  let sortKey = "created_at";
  let sortDir = "desc";

  // ---------- interface commune ----------
  const vues = ["loginBox", "vList", "vEdit", "vRes"];
  function vue(id) {
    vues.forEach((v) => { $("#" + v).hidden = v !== id; });
    $("#btnLogout").hidden = id === "loginBox";
    window.scrollTo({ top: 0 });
  }

  let toastTimer;
  function toast(msg, ms = 3200) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function confirmer(message, libelle = "Confirmer") {
    return new Promise((resolve) => {
      const m = $("#modal");
      $("#modalText").textContent = message;
      $("#modalYes").textContent = libelle;
      m.hidden = false;
      $("#modalNo").focus();
      const fin = (v) => { m.hidden = true; $("#modalYes").onclick = $("#modalNo").onclick = null; document.removeEventListener("keydown", esc); resolve(v); };
      const esc = (e) => { if (e.key === "Escape") fin(false); };
      $("#modalYes").onclick = () => fin(true);
      $("#modalNo").onclick = () => fin(false);
      document.addEventListener("keydown", esc);
    });
  }

  function erreur(el, e) {
    if (e && e.sessionExpiree) return deconnecte(e.message);
    el.textContent = (e && e.message) || String(e);
    el.hidden = false;
  }

  function telecharger(nomFichier, contenu, type) {
    const url = URL.createObjectURL(new Blob([contenu], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomFichier;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (DEMO) toast("Si rien ne se télécharge, c'est l'aperçu de la démo qui bloque les téléchargements. Sur votre site, le fichier sera enregistré.", 6000);
  }

  // ---------- connexion ----------
  function deconnecte(msg) {
    vue("loginBox");
    const e = $("#loginError");
    if (msg) { e.textContent = msg; e.hidden = false; } else e.hidden = true;
  }

  $("#loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const e = $("#loginError");
    e.hidden = true;
    const btn = $("#btnLogin");
    btn.disabled = true;
    try {
      await api.connexion($("#email").value, $("#pwd").value);
      $("#pwd").value = "";
      await ouvrirListe();
    } catch (err) {
      e.textContent = err.message;
      e.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  $("#btnLogout").addEventListener("click", async () => { await api.deconnexion(); deconnecte(); });
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => ouvrirListe()));

  // ---------- liste des QCM ----------
  async function ouvrirListe() {
    vue("vList");
    const err = $("#listError");
    err.hidden = true;
    try {
      qcms = await api.listeQcm();
      rendreListe();
    } catch (e) { erreur(err, e); }
  }
  $("#btnRefreshList").addEventListener("click", ouvrirListe);

  function bouton(texte, cls, fn, aria) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small " + cls;
    b.textContent = texte;
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", fn);
    return b;
  }

  function rendreListe() {
    const actif = qcms.find((q) => q.actif);
    $("#currentTitle").textContent = actif ? actif.titre : "Aucun QCM en cours";
    $("#currentMeta").textContent = actif
      ? "Présentation du " + fmtDateJour(actif.date_presentation) + " · " + plur(actif.nb_questions, "question") + " · " + plur(actif.nb_passages, "passage")
      : "Les participants voient « Aucun QCM en cours ». Choisissez un QCM ci-dessous avec « Mettre en cours ».";
    $("#currentCard").classList.toggle("on", !!actif);
    $("#btnStop").hidden = !actif;

    const tb = $("#listBody");
    tb.textContent = "";
    if (!qcms.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "empty";
      td.textContent = "Aucun QCM pour le moment. Cliquez sur « Nouveau QCM » pour importer vos questions.";
      tr.append(td);
      tb.append(tr);
      return;
    }
    for (const q of qcms) {
      const tr = document.createElement("tr");
      if (q.actif) tr.className = "row-on";
      const cell = (t, cls, label) => { const td = document.createElement("td"); if (cls) td.className = cls; if (label) td.dataset.label = label; td.textContent = t; return td; };
      const tdT = cell(q.titre, "nom");
      tr.append(tdT, cell(fmtDateJour(q.date_presentation), "", "Date"), cell(String(q.nb_questions), "num", "Questions"),
        cell(String(q.nb_passages), "num", "Passages"), cell(fr(q.moyenne), "num", "Moyenne /20"));
      const tdS = document.createElement("td");
      tdS.dataset.label = "Statut";
      const pill = document.createElement("span");
      pill.className = "pill " + (q.actif ? "pass" : "idle");
      pill.textContent = q.actif ? "En cours" : "—";
      tdS.append(pill);
      tr.append(tdS);
      const tdA = document.createElement("td");
      tdA.className = "actions";
      const acts = document.createElement("div");
      acts.className = "acts";
      tdA.append(acts);
      acts.append(
        bouton("Résultats", "btn-ghost", () => ouvrirResultats(q), "Résultats de " + q.titre),
        bouton("Modifier", "btn-ghost", () => ouvrirEdition(q), "Modifier " + q.titre),
        q.actif
          ? bouton("Retirer", "btn-ghost", () => activer(null), "Retirer " + q.titre)
          : bouton("Mettre en cours", "btn-primary", () => activer(q), "Mettre en cours " + q.titre),
        bouton("Supprimer", "btn-ghost danger", () => supprimerQcm(q), "Supprimer " + q.titre)
      );
      tr.append(tdA);
      tb.append(tr);
    }
  }

  async function activer(q) {
    const err = $("#listError");
    err.hidden = true;
    try {
      await api.activerQcm(q ? q.id : null);
      toast(q ? "« " + q.titre + " » est maintenant proposé aux participants." : "Plus aucun QCM n'est proposé aux participants.");
      await ouvrirListe();
    } catch (e) { erreur(err, e); }
  }
  $("#btnStop").addEventListener("click", () => activer(null));

  async function supprimerQcm(q) {
    const ok = await confirmer("Supprimer « " + q.titre + " », ses " + plur(q.nb_questions, "question") + " et ses " + plur(q.nb_passages, "résultat") + " ? Cette action est définitive.", "Supprimer");
    if (!ok) return;
    try {
      await api.supprimerQcm(q.id);
      toast("QCM supprimé.");
      await ouvrirListe();
    } catch (e) { erreur($("#listError"), e); }
  }

  // ---------- création / modification ----------
  async function ouvrirEdition(q) {
    courant = q || null;
    importees = null;
    $("#editForm").reset();
    $("#editError").hidden = true;
    $("#importBox").hidden = true;
    $("#previewBox").hidden = true;
    $("#fichierNom").textContent = "";
    $("#editTitle").textContent = q ? "Modifier le QCM" : "Nouveau QCM";
    $("#fTitre").value = q ? q.titre : "";
    $("#fDate").value = q ? q.date_presentation : aujourdhui();
    $("#fSeuil").value = q ? String(q.seuil) : "14";
    vue("vEdit");
    $("#fTitre").focus();
    if (q) {
      try {
        const d = await api.getQcm(q.id);
        apercu(d.questions, "Questions actuelles (" + d.questions.length + ")");
        resume("Ce QCM contient " + plur(d.questions.length, "question") + ". Importez un nouveau fichier seulement si vous voulez les remplacer.", []);
      } catch (e) { erreur($("#editError"), e); }
    }
  }
  $("#btnNew").addEventListener("click", () => ouvrirEdition(null));

  function resume(texte, erreurs, ok) {
    $("#importBox").hidden = false;
    const s = $("#importSummary");
    s.textContent = texte;
    s.className = "import-summary" + (erreurs.length ? " ko" : ok ? " ok" : "");
    const ul = $("#importErrors");
    ul.textContent = "";
    erreurs.slice(0, 30).forEach((m) => { const li = document.createElement("li"); li.textContent = m; ul.append(li); });
    if (erreurs.length > 30) { const li = document.createElement("li"); li.textContent = "… et " + (erreurs.length - 30) + " autre(s) erreur(s)."; ul.append(li); }
  }

  function apercu(questions, titre) {
    const box = $("#previewBox");
    box.hidden = !questions.length;
    $("#previewSummary").textContent = titre;
    const ol = $("#previewList");
    ol.textContent = "";
    for (const q of questions) {
      const li = document.createElement("li");
      const p = document.createElement("p");
      p.className = "pq";
      p.textContent = q.texte;
      const ul = document.createElement("ul");
      q.options.forEach((o, i) => {
        const r = document.createElement("li");
        r.textContent = LETTRES[i] + ". " + o;
        if (i === q.bonne) r.className = "good";
        ul.append(r);
      });
      li.append(p, ul);
      if (q.explication) { const e = document.createElement("p"); e.className = "pe"; e.textContent = q.explication; li.append(e); }
      ol.append(li);
    }
  }

  // Lecture de la feuille « Questions » du modèle
  function analyserFeuille(lignes) {
    const cles = {
      question: ["question"], A: ["reponse a"], B: ["reponse b"], C: ["reponse c"], D: ["reponse d"],
      bonne: ["bonne reponse", "bonne"], explication: ["explication", "explications"]
    };
    const n = (s) => norm(s).replace(/[°º]/g, "").replace(/\s+/g, " ").trim();
    let h = -1, col = {};
    for (let i = 0; i < Math.min(lignes.length, 10); i++) {
      const row = (lignes[i] || []).map(n);
      const c = {};
      for (const [k, noms] of Object.entries(cles)) { const j = row.findIndex((x) => noms.includes(x)); if (j >= 0) c[k] = j; }
      if (c.question !== undefined && c.bonne !== undefined) { h = i; col = c; break; }
    }
    if (h < 0) return { questions: [], erreurs: ["Ligne de titres introuvable : utilisez le modèle sans modifier la ligne 1 (Question, Réponse A… Bonne réponse)."] };
    const manquantes = ["A", "B"].filter((k) => col[k] === undefined).map((k) => "Réponse " + k);
    if (manquantes.length) return { questions: [], erreurs: ["Colonne(s) manquante(s) : " + manquantes.join(", ") + "."] };

    const questions = [], erreurs = [];
    for (let i = h + 1; i < lignes.length; i++) {
      const row = lignes[i] || [];
      const val = (k) => (col[k] === undefined ? "" : String(row[col[k]] ?? "").trim());
      const texte = val("question");
      const reps = ["A", "B", "C", "D"].map(val);
      if (!texte && reps.every((x) => !x) && !val("explication")) continue; // ligne vide
      const L = "Ligne " + (i + 1) + " : ";
      const errs = [];
      if (!texte) errs.push(L + "la question est vide.");
      else if (texte.length > 1000) errs.push(L + "la question dépasse 1 000 caractères.");
      let fin = reps.length;
      while (fin > 0 && !reps[fin - 1]) fin--;
      const options = reps.slice(0, fin);
      if (!reps[0] || !reps[1]) errs.push(L + "les réponses A et B sont obligatoires.");
      const trou = options.findIndex((x) => !x);
      if (trou >= 0 && reps[0] && reps[1]) errs.push(L + "la réponse " + LETTRES[trou] + " est vide alors qu'une réponse suivante est remplie.");
      if (options.some((x) => x.length > 300)) errs.push(L + "une réponse dépasse 300 caractères.");
      const dbl = options.filter(Boolean).map(norm);
      if (new Set(dbl).size !== dbl.length) errs.push(L + "deux réponses sont identiques.");
      const b = norm(val("bonne")).toUpperCase().replace(/^REPONSE\s*/, "").trim();
      let bonne = LETTRES.indexOf(b);
      if (bonne < 0 && /^[1-4]$/.test(b)) bonne = Number(b) - 1;
      if (!b) errs.push(L + "la bonne réponse n'est pas indiquée (A, B, C ou D).");
      else if (bonne < 0) errs.push(L + "bonne réponse « " + val("bonne") + " » invalide : choisissez A, B, C ou D.");
      else if (!reps[bonne]) errs.push(L + "la bonne réponse " + LETTRES[bonne] + " désigne une réponse vide.");
      const explication = val("explication");
      if (explication.length > 1000) errs.push(L + "l'explication dépasse 1 000 caractères.");
      if (errs.length) erreurs.push(...errs);
      else questions.push({ texte, options, bonne, explication });
    }
    if (!questions.length && !erreurs.length) erreurs.push("Aucune question trouvée dans la feuille « Questions ».");
    if (questions.length + erreurs.length > 200) erreurs.push("Maximum 200 questions par QCM.");
    return { questions, erreurs };
  }

  $("#fFichier").addEventListener("change", async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    $("#fichierNom").textContent = f.name;
    $("#editError").hidden = true;
    importees = null;
    try {
      const lignes = await window.LireExcel(f, "Questions");
      const { questions, erreurs } = analyserFeuille(lignes);
      if (erreurs.length) {
        resume("Le fichier contient " + plur(erreurs.length, "erreur") + ". Corrigez-les dans Excel puis importez-le de nouveau. Rien n'a été enregistré.", erreurs);
        apercu([], "");
      } else {
        importees = questions;
        resume(plur(questions.length, "question") + " prête" + (questions.length > 1 ? "s" : "") + " à être enregistrée" + (questions.length > 1 ? "s" : "") +
          (courant ? ". Elles remplaceront les questions actuelles quand vous cliquerez sur « Enregistrer »." : ". Vérifiez l'aperçu puis cliquez sur « Enregistrer »."), [], true);
        apercu(questions, "Aperçu des " + plur(questions.length, "question") + " importée" + (questions.length > 1 ? "s" : ""));
      }
    } catch (e) {
      resume(e.message, []);
      $("#importSummary").className = "import-summary ko";
      apercu([], "");
    } finally {
      ev.target.value = "";
    }
  });

  $("#editForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("#editError");
    err.hidden = true;
    const titre = $("#fTitre").value.trim();
    const date = $("#fDate").value;
    const seuil = Number(String($("#fSeuil").value).replace(",", "."));
    if (titre.length < 2) return erreur(err, "Indiquez le titre de la présentation.");
    if (!date) return erreur(err, "Indiquez la date de la présentation.");
    if (!(seuil >= 0 && seuil <= 20)) return erreur(err, "Le seuil de réussite doit être compris entre 0 et 20.");
    if (!courant && !importees) return erreur(err, "Importez le fichier Excel des questions avant d'enregistrer.");
    if (courant && importees && courant.nb_passages > 0) {
      const ok = await confirmer("Ce QCM a déjà " + plur(courant.nb_passages, "résultat") + ". Remplacer ses questions ? Les notes déjà enregistrées ne changeront pas.", "Remplacer");
      if (!ok) return;
    }
    const btn = $("#btnSave");
    btn.disabled = true;
    try {
      await api.enregistrerQcm(courant ? courant.id : null, titre, date, seuil, importees);
      toast(courant ? "QCM modifié." : "QCM créé. Cliquez sur « Mettre en cours » pour le proposer aux participants.", 4500);
      await ouvrirListe();
    } catch (e) { erreur(err, e); }
    finally { btn.disabled = false; }
  });

  // ---------- résultats ----------
  async function ouvrirResultats(q) {
    courant = q;
    vue("vRes");
    $("#search").value = "";
    $("#resTitle").textContent = q.titre;
    $("#resMeta").textContent = "Présentation du " + fmtDateJour(q.date_presentation) + " · " + plur(q.nb_questions, "question") + " · seuil " + fr(q.seuil) + "/20" + (q.actif ? " · en cours" : "");
    await chargerResultats();
  }

  async function chargerResultats() {
    const err = $("#resError");
    err.hidden = true;
    try {
      resultats = (await api.resultats(courant.id)).map((r) => ({ ...r, note: Number(r.note) }));
      rendreKpis();
      rendreGraphe();
      rendreTableau();
    } catch (e) { erreur(err, e); }
  }
  $("#btnRefresh").addEventListener("click", chargerResultats);

  function stats() {
    const n = resultats.length;
    if (!n) return { participants: 0, moyenne: null, max: null, taux: null };
    const sum = resultats.reduce((s, r) => s + r.note, 0);
    return {
      participants: new Set(resultats.map((r) => r.matricule)).size,
      moyenne: Math.round((sum / n) * 10) / 10,
      max: Math.max(...resultats.map((r) => r.note)),
      taux: Math.round((resultats.filter((r) => r.reussi).length / n) * 100)
    };
  }

  function rendreKpis() {
    const s = stats();
    const items = [
      [s.participants, "Participants (matricules distincts)"],
      [fr(s.moyenne), "Moyenne /20"],
      [s.taux == null ? "–" : s.taux + " %", "Taux de réussite (≥ " + fr(courant.seuil) + "/20)"],
      [fr(s.max), "Meilleure note /20"]
    ];
    const box = $("#kpis");
    box.textContent = "";
    for (const [v, label] of items) {
      const d = document.createElement("div");
      d.className = "kpi";
      const b = document.createElement("b");
      b.textContent = v;
      const sp = document.createElement("span");
      sp.textContent = label;
      d.append(b, sp);
      box.append(d);
    }
  }

  function rendreGraphe() {
    const total = Math.max(courant.nb_questions, ...resultats.map((r) => r.total), 1);
    const dist = new Array(total + 1).fill(0);
    resultats.forEach((r) => { if (r.total === total) dist[r.score]++; else dist[Math.round((r.score / r.total) * total)]++; });
    const max = Math.max(1, ...dist);
    const box = $("#chart");
    box.textContent = "";
    $("#axisMax").textContent = String(total);
    const passScore = (courant.seuil / 20) * total;
    dist.forEach((n, i) => {
      const col = document.createElement("div");
      col.className = "bar-col " + (i >= passScore ? "pass" : "fail");
      col.title = i + " bonne(s) réponse(s) : " + n + " passage(s)";
      const em = document.createElement("em");
      em.textContent = n ? String(n) : "";
      const bar = document.createElement("i");
      bar.style.height = (n / max) * 100 + "%";
      col.append(em, bar);
      box.append(col);
    });
  }

  function fmtDuree(s) {
    if (s == null) return "–";
    return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  function lignesVisibles() {
    const q = norm($("#search").value.trim());
    return resultats
      .filter((r) => !q || norm(r.nom).includes(q) || norm(r.matricule).includes(q))
      .sort((a, b) => {
        let x = a[sortKey], y = b[sortKey];
        if (typeof x === "string" && sortKey !== "created_at") { x = norm(x); y = norm(y); }
        if (x == null) x = -1;
        if (y == null) y = -1;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return sortDir === "asc" ? c : -c;
      });
  }

  function rendreTableau() {
    const rows = lignesVisibles();
    const tb = $("#tbody");
    tb.textContent = "";
    $("#count").textContent = plur(rows.length, "passage") +
      (rows.length !== resultats.length ? " affiché" + (rows.length > 1 ? "s" : "") + " sur " + resultats.length : "");
    document.querySelectorAll("th[data-key]").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.key === sortKey) th.classList.add("sorted-" + sortDir);
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 8;
      td.className = "empty";
      td.textContent = resultats.length ? "Aucun résultat pour cette recherche." : "Aucun passage enregistré pour ce QCM.";
      tr.append(td);
      tb.append(tr);
      return;
    }
    for (const r of rows) {
      const tr = document.createElement("tr");
      const cell = (text, cls) => { const td = document.createElement("td"); if (cls) td.className = cls; td.textContent = text; return td; };
      tr.append(cell(r.nom, "nom"), cell(r.matricule), cell(fr(r.note), "num"), cell(r.score + "/" + r.total, "num"));
      const tdRes = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = "pill " + (r.reussi ? "pass" : "fail");
      pill.textContent = r.reussi ? "Réussi" : "Non réussi";
      tdRes.append(pill);
      tr.append(tdRes, cell(fmtDuree(r.duree_s), "num"), cell(fmtDate(r.created_at)));
      const tdDel = document.createElement("td");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.title = "Supprimer ce passage";
      del.setAttribute("aria-label", "Supprimer le passage de " + r.nom);
      del.textContent = "✕";
      del.addEventListener("click", () => supprimerResultat(r));
      tdDel.append(del);
      tr.append(tdDel);
      tb.append(tr);
    }
  }

  async function supprimerResultat(r) {
    const ok = await confirmer("Supprimer le passage de " + r.nom + " (" + r.matricule + ") ? Cette action est définitive.", "Supprimer");
    if (!ok) return;
    try {
      await api.supprimerResultat(r.id);
      await chargerResultats();
    } catch (e) { erreur($("#resError"), e); }
  }

  function setSort(key) {
    if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortKey = key; sortDir = key === "nom" || key === "matricule" ? "asc" : "desc"; }
    rendreTableau();
  }
  document.querySelectorAll("th[data-key]").forEach((th) => {
    th.addEventListener("click", () => setSort(th.dataset.key));
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort(th.dataset.key); } });
  });
  $("#search").addEventListener("input", rendreTableau);

  // ---------- export CSV ----------
  function csvCell(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise les formules Excel
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $("#btnExport").addEventListener("click", () => {
    const head = ["QCM", "Date de la présentation", "Nom", "Matricule", "Bonnes réponses", "Questions", "Note /20", "Résultat", "Durée (s)", "Date du passage"];
    const lignes = [head.map(csvCell).join(";")];
    for (const r of lignesVisibles()) {
      lignes.push([courant.titre, fmtDateJour(courant.date_presentation), r.nom, r.matricule, r.score, r.total, fr(r.note),
        r.reussi ? "Réussi" : "Non réussi", r.duree_s ?? "", fmtDate(r.created_at)].map(csvCell).join(";"));
    }
    const slug = norm(courant.titre).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "qcm";
    telecharger("resultats_" + slug + "_" + courant.date_presentation + ".csv", "﻿" + lignes.join("\r\n"), "text/csv;charset=utf-8");
  });

  $("#btnModele").addEventListener("click", () => {
    if (DEMO) toast("Si rien ne se télécharge, c'est l'aperçu de la démo qui bloque les téléchargements. Sur votre site, le modèle sera enregistré.", 6000);
  });

  // ---------- démarrage ----------
  if (DEMO) {
    $("#demoBand").hidden = false;
    $("#demoLoginHint").hidden = false;
  }
  if (api.estConnecte()) ouvrirListe(); else deconnecte();
})();
