/* QCM GESTOCI v2.1 — page participant
 * v2.0 : QCM chargé depuis Supabase (QCM en cours choisi dans l'admin),
 *        questions et réponses mélangées pour chaque participant,
 *        notation côté serveur, explication facultative.
 * v2.1 : nom et matricule saisis au début, envoi direct après la dernière question.
 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const LETTERS = ["A", "B", "C", "D", "E", "F"];
  const STORE_KEY = "gestoci-qcm-v2";
  const IDENT_KEY = "gestoci-qcm-ident";
  const RING = 377; // circonférence du cercle (r = 60)
  const api = window.QcmApi;

  const screens = {
    home: $("#screen-home"),
    question: $("#screen-question"),
    result: $("#screen-result")
  };

  const state = {
    qcmId: null,
    titre: "",
    seuil: 14,
    nom: "",
    matricule: "",
    questions: [], // dans l'ordre affiché
    optOrder: {},  // id question -> ordre d'affichage des options (indices d'origine)
    answers: {},   // id question -> indice d'origine de l'option choisie
    idx: 0,
    startedAt: 0,
    sending: false
  };

  // ---------- utilitaires ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const fr = (n) => String(n).replace(".", ",");

  function show(name, focusEl) {
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
    $("#topbar").hidden = name === "home" || name === "result";
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    const target = focusEl || screens[name].querySelector("h1, h2");
    if (target) target.focus({ preventScroll: true });
  }

  function save() {
    try {
      sessionStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          qcmId: state.qcmId,
          nom: state.nom,
          matricule: state.matricule,
          order: state.questions.map((q) => q.id),
          optOrder: state.optOrder,
          answers: state.answers,
          idx: state.idx,
          startedAt: state.startedAt
        })
      );
    } catch { /* stockage indisponible : sans conséquence */ }
  }
  function clearSaved() {
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  }
  function loadSaved() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setProgress() {
    const total = state.questions.length;
    const done = Object.keys(state.answers).length;
    $("#progressFill").style.width = Math.round((done / total) * 100) + "%";
    $("#progressBar").setAttribute("aria-valuenow", String(Math.round((done / total) * 100)));
    $("#progressLabel").textContent = "Question " + (state.idx + 1) + " sur " + total;
  }

  // ---------- questions ----------
  function renderQuestion() {
    const q = state.questions[state.idx];
    const total = state.questions.length;
    $("#qText").textContent = q.q;

    const box = $("#qOptions");
    box.textContent = "";
    state.optOrder[q.id].forEach((origIdx, pos) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", state.answers[q.id] === origIdx ? "true" : "false");
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = LETTERS[pos];
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = q.options[origIdx];
      b.append(letter, label);
      b.addEventListener("click", () => choose(q.id, origIdx));
      box.append(b);
    });

    $("#btnPrev").hidden = state.idx === 0;
    const next = $("#btnNext");
    next.textContent = state.idx === total - 1 ? "Valider mes réponses" : "Suivant";
    next.disabled = state.answers[q.id] === undefined;
    $("#qError").hidden = true;
    setProgress();
  }

  function choose(qid, origIdx) {
    state.answers[qid] = origIdx;
    save();
    document.querySelectorAll("#qOptions .option").forEach((el, pos) => {
      const orig = state.optOrder[qid][pos];
      el.setAttribute("aria-checked", orig === origIdx ? "true" : "false");
    });
    $("#btnNext").disabled = false;
    setProgress();
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function goTo(i) {
    state.idx = i;
    save();
    show("question", $("#qText"));
    renderQuestion();
    $("#qText").focus({ preventScroll: true });
  }

  function next() {
    const total = state.questions.length;
    if (state.idx < total - 1) return goTo(state.idx + 1);
    submit();
  }

  // ---------- envoi ----------
  async function submit() {
    if (state.sending) return;
    const err = $("#qError");
    err.hidden = true;
    state.sending = true;
    const btn = $("#btnNext");
    const prev = $("#btnPrev");
    btn.disabled = true;
    prev.disabled = true;
    btn.textContent = "Envoi en cours…";
    try {
      const duree = Math.round((Date.now() - state.startedAt) / 1000);
      const data = await api.soumettre(state.qcmId, state.nom, state.matricule, state.answers, duree);
      clearSaved();
      showResult(data);
    } catch (e) {
      err.textContent = (e && e.message) || "Une erreur est survenue. Réessayez.";
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = "Valider mes réponses";
    } finally {
      prev.disabled = false;
      state.sending = false;
    }
  }

  // ---------- résultat ----------
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showResult(r) {
    const note = Number(r.note);
    const seuil = Number(r.seuil);
    $("#resultName").textContent = r.nom;
    $("#resultMatricule").textContent = "Matricule " + r.matricule;
    const pass = r.reussi;
    const badge = $("#resultBadge");
    badge.textContent = pass ? "RÉUSSI" : "À REVOIR";
    badge.className = "badge " + (pass ? "pass" : "fail");
    $("#resultDetail").textContent =
      r.score + " bonne" + (r.score > 1 ? "s" : "") + " réponse" + (r.score > 1 ? "s" : "") + " sur " + r.total +
      (pass ? ". Bravo !" : ". Seuil de réussite : " + fr(seuil) + "/20. Consultez la correction puis retentez le QCM.");

    const fg = $("#ringFg");
    fg.classList.toggle("pass", pass);
    fg.style.strokeDashoffset = String(RING);
    $("#ringNote").textContent = "0";
    show("result", $("#resultName"));

    requestAnimationFrame(() => requestAnimationFrame(() => {
      fg.style.strokeDashoffset = String(RING * (1 - note / 20));
    }));
    countUp($("#ringNote"), note, reduced ? 0 : 1300);
    if (pass) confetti();
    // Correction dans l'ordre où le participant a vu les questions
    const pos = new Map(state.questions.map((q, i) => [q.id, i]));
    buildReview(r.revue.slice().sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)));
  }

  function countUp(el, target, ms) {
    const fmt = (v) => (Number.isInteger(target) ? String(Math.round(v)) : v.toFixed(1)).replace(".", ",");
    if (!ms) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  function confetti() {
    if (reduced) return;
    const box = $("#confetti");
    box.textContent = "";
    const colors = ["#10602f", "#e86828", "#f4b183", "#6fbf8b", "#ffd166"];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--x", (Math.random() * 160 - 80) + "px");
      p.style.setProperty("--r", (Math.random() * 900 - 300) + "deg");
      p.style.setProperty("--d", 2.2 + Math.random() * 1.8 + "s");
      p.style.setProperty("--delay", Math.random() * 0.8 + "s");
      box.append(p);
    }
    setTimeout(() => { box.textContent = ""; }, 5000);
  }

  function buildReview(revue) {
    const list = $("#reviewList");
    list.textContent = "";
    revue.forEach((it, n) => {
      const li = document.createElement("li");
      li.className = "review-item" + (it.ok ? "" : " ko");
      li.dataset.ok = it.ok ? "1" : "0";

      const q = document.createElement("p");
      q.className = "review-q";
      q.textContent = (n + 1) + ". " + it.q;

      const mine = document.createElement("p");
      mine.className = "review-line";
      const t1 = document.createElement("span");
      t1.className = "tag " + (it.ok ? "ok" : "ko");
      t1.textContent = it.ok ? "✓ Votre réponse : " : "✗ Votre réponse : ";
      mine.append(t1, document.createTextNode(it.options[it.choisi]));

      li.append(q, mine);
      if (!it.ok) {
        const good = document.createElement("p");
        good.className = "review-line";
        const t2 = document.createElement("span");
        t2.className = "tag ok";
        t2.textContent = "✓ Bonne réponse : ";
        good.append(t2, document.createTextNode(it.options[it.correct]));
        li.append(good);
      }
      if (it.explication) {
        const why = document.createElement("p");
        why.className = "review-why";
        why.textContent = it.explication;
        li.append(why);
      }
      list.append(li);
    });
    $("#review").hidden = true;
    $("#onlyErrors").checked = false;
    $("#btnReview").textContent = "Voir la correction";
  }

  function applyFilter() {
    const only = $("#onlyErrors").checked;
    document.querySelectorAll("#reviewList .review-item").forEach((li) => {
      li.hidden = only && li.dataset.ok === "1";
    });
  }

  // ---------- démarrage ----------
  function begin(ev) {
    ev.preventDefault();
    const nom = $("#nom").value.replace(/\s+/g, " ").trim();
    const matricule = $("#matricule").value.trim().toUpperCase();
    const err = $("#identError");
    err.hidden = true;
    const fail = (msg, champ) => { err.textContent = msg; err.hidden = false; champ.focus(); };
    if (nom.length < 2) return fail("Indiquez votre nom et vos prénoms.", $("#nom"));
    if (matricule.length < 2) return fail("Indiquez votre matricule.", $("#matricule"));
    state.nom = nom;
    state.matricule = matricule;
    try { sessionStorage.setItem(IDENT_KEY, JSON.stringify({ nom, matricule })); } catch { /* ignore */ }
    state.questions = shuffle(state.questions);
    state.optOrder = {};
    state.questions.forEach((q) => { state.optOrder[q.id] = shuffle(q.options.map((_, i) => i)); });
    state.answers = {};
    state.startedAt = Date.now();
    goTo(0);
  }

  async function load() {
    const e = $("#homeError");
    e.hidden = true;
    $("#homeReady").hidden = true;
    $("#homeEmpty").hidden = true;
    $("#homeTitle").textContent = "Chargement du QCM…";
    try {
      const data = await api.getQcmActif();
      if (!data || !data.questions || !data.questions.length) {
        $("#homeTitle").textContent = "Aucun QCM en cours";
        $("#homeEmptyText").hidden = false;
        $("#homeEmpty").hidden = false;
        clearSaved();
        return;
      }
      state.qcmId = data.id;
      state.titre = data.titre;
      state.seuil = Number(data.seuil);
      state.questions = data.questions;
      document.title = data.titre + " · QCM GESTOCI";
      $("#homeTitle").textContent = data.titre;
      $("#homeCount").textContent = String(data.questions.length);
      $("#homeMinutes").textContent = "~" + Math.max(2, Math.round(data.questions.length * 0.25));
      $("#homeReady").hidden = false;
      try {
        const id = JSON.parse(sessionStorage.getItem(IDENT_KEY) || "null");
        if (id) { $("#nom").value = id.nom || ""; $("#matricule").value = id.matricule || ""; }
      } catch { /* ignore */ }

      // Reprise après un rechargement accidentel de la page
      const saved = loadSaved();
      const ids = data.questions.map((q) => q.id).sort().join(",");
      if (saved && saved.qcmId === data.id && saved.order && saved.order.slice().sort().join(",") === ids && Object.keys(saved.answers || {}).length) {
        const byId = new Map(data.questions.map((q) => [q.id, q]));
        state.questions = saved.order.map((id) => byId.get(id));
        state.optOrder = saved.optOrder;
        state.answers = saved.answers;
        state.nom = saved.nom || "";
        state.matricule = saved.matricule || "";
        state.startedAt = saved.startedAt || Date.now();
        const total = state.questions.length;
        if (state.nom && state.matricule) goTo(Math.min(Math.max(0, saved.idx), total - 1));
        else clearSaved();
      } else if (saved) {
        clearSaved();
      }
    } catch (err) {
      $("#homeTitle").textContent = "QCM indisponible";
      e.textContent = (err && err.message) || "Impossible de charger le QCM. Vérifiez votre connexion puis rechargez la page.";
      e.hidden = false;
      $("#homeEmptyText").hidden = true;
      $("#homeEmpty").hidden = false;
    }
  }

  function init() {
    if (api.mode === "demo") $("#demoBand").hidden = false;
    $("#identForm").addEventListener("submit", begin);
    ["#nom", "#matricule"].forEach((sel) => $(sel).addEventListener("input", () => { $("#identError").hidden = true; }));
    $("#btnReload").addEventListener("click", load);
    $("#btnPrev").addEventListener("click", () => goTo(state.idx - 1));
    $("#btnNext").addEventListener("click", next);
    $("#btnReview").addEventListener("click", () => {
      const box = $("#review");
      box.hidden = !box.hidden;
      $("#btnReview").textContent = box.hidden ? "Voir la correction" : "Masquer la correction";
      if (!box.hidden) box.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    $("#onlyErrors").addEventListener("change", applyFilter);
    $("#btnRestart").addEventListener("click", () => { clearSaved(); location.reload(); });
    load();
  }

  init();
})();
