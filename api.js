/* QCM GESTOCI v2.0 — accès aux données
 * Deux moteurs avec la même interface :
 *   - Supabase (fonctions de supabase/schema.sql, appelées en HTTPS) ;
 *   - démo (données fictives dans le navigateur) quand QCM_CONFIG.DEMO est vrai.
 */
(() => {
  "use strict";
  const C = window.QCM_CONFIG || {};

  class ApiError extends Error {
    constructor(message, opts = {}) {
      super(message);
      this.sessionExpiree = !!opts.sessionExpiree;
    }
  }

  const store = {
    get(k, area = "session") {
      try { const s = area === "local" ? localStorage : sessionStorage; const v = s.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; }
    },
    set(k, v, area = "session") {
      try { const s = area === "local" ? localStorage : sessionStorage; s.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ }
    },
    del(k, area = "session") {
      try { (area === "local" ? localStorage : sessionStorage).removeItem(k); } catch { /* ignore */ }
    }
  };

  const RESEAU = "Connexion impossible. Vérifiez votre réseau puis réessayez.";

  // =====================================================================
  //  Moteur Supabase
  // =====================================================================
  function moteurSupabase() {
    const base = String(C.SUPABASE_URL || "").replace(/\/+$/, "");
    const cle = C.SUPABASE_ANON_KEY || "";
    const SESSION = "qcm-gestoci-session-v2";
    let session = store.get(SESSION);

    async function http(url, opts) {
      let res;
      try { res = await fetch(url, opts); } catch { throw new ApiError(RESEAU); }
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
      return { res, data };
    }

    function garderSession(d) {
      session = {
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expires_at: d.expires_at ? d.expires_at * 1000 : Date.now() + (d.expires_in || 3600) * 1000,
        email: (d.user && d.user.email) || (session && session.email) || ""
      };
      store.set(SESSION, session);
    }
    function oublierSession() { session = null; store.del(SESSION); }

    async function rafraichirSiBesoin() {
      if (!session) throw new ApiError("Session expirée. Reconnectez-vous.", { sessionExpiree: true });
      if (Date.now() < session.expires_at - 60_000) return;
      const { res, data } = await http(base + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: cle, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      if (!res.ok) { oublierSession(); throw new ApiError("Session expirée. Reconnectez-vous.", { sessionExpiree: true }); }
      garderSession(data);
    }

    async function rpc(fn, args = {}, admin = false) {
      if (admin) await rafraichirSiBesoin();
      // Clé « publishable » (sb_publishable_…) : seulement dans apikey.
      // Ancienne clé « anon » (un JWT, eyJ…) : aussi acceptée dans Authorization.
      const headers = { apikey: cle, "Content-Type": "application/json", Accept: "application/json" };
      if (admin) headers.Authorization = "Bearer " + session.access_token;
      else if (/^eyJ/.test(cle)) headers.Authorization = "Bearer " + cle;
      const { res, data } = await http(base + "/rest/v1/rpc/" + fn, { method: "POST", headers, body: JSON.stringify(args) });
      if (!res.ok) {
        const msg = data && typeof data === "object" ? data.message : "";
        if (admin && (res.status === 401 || (data && data.code === "PGRST301"))) {
          oublierSession();
          throw new ApiError("Session expirée. Reconnectez-vous.", { sessionExpiree: true });
        }
        if (res.status === 404) throw new ApiError("Service introuvable : vérifiez config.js et que le script SQL a bien été exécuté dans Supabase.");
        throw new ApiError(msg || "Erreur du serveur (" + res.status + "). Réessayez.");
      }
      return data;
    }

    return {
      mode: "supabase",
      getQcmActif: () => rpc("get_qcm_actif"),
      soumettre: (qcmId, nom, matricule, reponses, duree) =>
        rpc("soumettre_qcm", { p_qcm: qcmId, p_nom: nom, p_matricule: matricule, p_reponses: reponses, p_duree: duree }),

      estConnecte: () => !!session,
      emailConnecte: () => (session ? session.email : ""),
      async connexion(email, motDePasse) {
        const { res, data } = await http(base + "/auth/v1/token?grant_type=password", {
          method: "POST",
          headers: { apikey: cle, "Content-Type": "application/json" },
          body: JSON.stringify({ email: String(email).trim(), password: motDePasse })
        });
        if (!res.ok) {
          const code = data && (data.error_code || data.error || data.code);
          if (res.status === 400 || code === "invalid_credentials" || code === "invalid_grant") throw new ApiError("E-mail ou mot de passe incorrect.");
          if (res.status === 429) throw new ApiError("Trop d'essais. Patientez quelques minutes.");
          throw new ApiError("Connexion impossible (" + res.status + ").");
        }
        garderSession(data);
        const ok = await rpc("admin_verifier", {}, true).catch((e) => { oublierSession(); throw e; });
        if (!ok) { oublierSession(); throw new ApiError("Ce compte n'est pas autorisé à administrer le QCM."); }
      },
      async deconnexion() {
        const s = session;
        oublierSession();
        if (s) fetch(base + "/auth/v1/logout", { method: "POST", headers: { apikey: cle, Authorization: "Bearer " + s.access_token } }).catch(() => {});
      },
      listeQcm: () => rpc("admin_liste_qcm", {}, true),
      getQcm: (id) => rpc("admin_get_qcm", { p_id: id }, true),
      enregistrerQcm: (id, titre, date, seuil, questions) =>
        rpc("admin_enregistrer_qcm", { p_id: id || null, p_titre: titre, p_date: date, p_seuil: seuil, p_questions: questions || null }, true),
      supprimerQcm: (id) => rpc("admin_supprimer_qcm", { p_id: id }, true),
      activerQcm: (id) => rpc("admin_activer_qcm", { p_id: id || null }, true),
      resultats: (id) => rpc("admin_resultats", { p_id: id }, true),
      supprimerResultat: (id) => rpc("admin_supprimer_resultat", { p_id: id }, true)
    };
  }

  // =====================================================================
  //  Moteur démo : mêmes règles que le SQL, données dans ce navigateur
  // =====================================================================
  function moteurDemo() {
    const CLE = "qcm-gestoci-demo-v2";
    const SESSION = "qcm-gestoci-demo-session";
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36));
    const pause = () => new Promise((r) => setTimeout(r, 120));
    const err = (m) => { throw new ApiError(m); };
    const r1 = (x) => Math.round(x * 10) / 10;

    function charger() {
      let d = store.get(CLE, "local");
      if (!d) {
        d = window.QCM_DEMO_SEED ? JSON.parse(JSON.stringify(window.QCM_DEMO_SEED)) : { qcm: [], questions: {}, resultats: [], actif: null, seq: 1 };
        store.set(CLE, d, "local");
      }
      return d;
    }
    let mem = null; // repli si le navigateur refuse le stockage
    const lire = () => mem || (mem = charger());
    const ecrire = (d) => { mem = d; store.set(CLE, d, "local"); };
    // Recharge depuis le stockage à chaque appel pour partager l'état entre les pages.
    const frais = () => { const d = store.get(CLE, "local"); if (d) mem = d; return lire(); };
    const exigerAdmin = () => { if (!store.get(SESSION)) throw new ApiError("Session expirée. Reconnectez-vous.", { sessionExpiree: true }); };

    function validerQuestions(qs) {
      if (!Array.isArray(qs) || !qs.length) err("Le fichier ne contient aucune question.");
      if (qs.length > 200) err("Maximum 200 questions par QCM.");
      qs.forEach((q, i) => {
        const n = i + 1;
        const t = String(q.texte || "").trim();
        if (!t || t.length > 1000) err("Question " + n + ", texte vide ou trop long.");
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) err("Question " + n + ", il faut de 2 à 4 réponses.");
        if (q.options.some((o) => typeof o !== "string" || !o.trim() || o.trim().length > 300)) err("Question " + n + ", une réponse est vide ou trop longue.");
        if (!Number.isInteger(q.bonne) || q.bonne < 0 || q.bonne >= q.options.length) err("Question " + n + ", la bonne réponse ne correspond à aucune réponse saisie.");
        if (String(q.explication || "").length > 1000) err("Question " + n + ", explication trop longue.");
      });
    }

    return {
      mode: "demo",
      async getQcmActif() {
        await pause();
        const d = frais();
        const q = d.qcm.find((x) => x.id === d.actif);
        if (!q) return null;
        return { id: q.id, titre: q.titre, seuil: q.seuil, questions: (d.questions[q.id] || []).map((x) => ({ id: x.id, q: x.texte, options: x.options })) };
      },
      async soumettre(qcmId, nom, matricule, reponses, duree) {
        await pause();
        const d = frais();
        const q = d.qcm.find((x) => x.id === d.actif);
        if (!q || q.id !== qcmId) err("Ce QCM n'est plus ouvert. Rechargez la page.");
        nom = String(nom || "").replace(/\s+/g, " ").trim();
        matricule = String(matricule || "").trim().toUpperCase();
        if (nom.length < 2 || nom.length > 80) err("Indiquez votre nom complet (2 à 80 caractères).");
        if (matricule.length < 2 || matricule.length > 30) err("Matricule invalide (2 à 30 caractères).");
        const qs = d.questions[q.id] || [];
        if (Object.keys(reponses || {}).length !== qs.length) err("Le QCM a été modifié pendant votre passage. Rechargez la page.");
        if (d.resultats.some((r) => r.qcm_id === q.id && r.matricule === matricule && Date.now() - Date.parse(r.created_at) < 10_000)) err("Votre résultat vient déjà d'être enregistré.");
        let score = 0;
        const revue = qs.map((x) => {
          const c = reponses[x.id];
          if (c === undefined) err("Le QCM a été modifié pendant votre passage. Rechargez la page.");
          if (!Number.isInteger(c) || c < 0 || c >= x.options.length) err("Répondez à toutes les questions avant de valider.");
          if (c === x.bonne) score++;
          return { id: x.id, q: x.texte, options: x.options, choisi: c, correct: x.bonne, ok: c === x.bonne, explication: x.explication || null };
        });
        const note = r1((score / qs.length) * 20);
        const reussi = note >= q.seuil;
        d.resultats.push({ id: d.seq++, qcm_id: q.id, nom, matricule, score, total: qs.length, note, reussi,
          duree_s: Number.isInteger(duree) && duree >= 0 && duree < 86400 ? duree : null, created_at: new Date().toISOString() });
        ecrire(d);
        return { nom, matricule, score, total: qs.length, note, seuil: q.seuil, reussi, revue };
      },

      estConnecte: () => !!store.get(SESSION),
      emailConnecte: () => (store.get(SESSION) || {}).email || "",
      async connexion(email, motDePasse) {
        await pause();
        if (!String(email).trim() || !motDePasse) err("Saisissez un e-mail et un mot de passe.");
        store.set(SESSION, { email: String(email).trim() });
      },
      async deconnexion() { store.del(SESSION); },
      async listeQcm() {
        await pause(); exigerAdmin();
        const d = frais();
        return d.qcm.map((q) => {
          const rs = d.resultats.filter((r) => r.qcm_id === q.id);
          return { ...q, nb_questions: (d.questions[q.id] || []).length, nb_passages: rs.length,
            moyenne: rs.length ? r1(rs.reduce((s, r) => s + r.note, 0) / rs.length) : null, actif: q.id === d.actif };
        }).sort((a, b) => (b.date_presentation.localeCompare(a.date_presentation)) || b.created_at.localeCompare(a.created_at));
      },
      async getQcm(id) {
        await pause(); exigerAdmin();
        const d = frais();
        const q = d.qcm.find((x) => x.id === id) || err("QCM introuvable.");
        return { ...q, questions: (d.questions[id] || []).map(({ texte, options, bonne, explication }) => ({ texte, options, bonne, explication })) };
      },
      async enregistrerQcm(id, titre, date, seuil, questions) {
        await pause(); exigerAdmin();
        const d = frais();
        titre = String(titre || "").trim();
        if (titre.length < 2 || titre.length > 150) err("Le titre doit contenir de 2 à 150 caractères.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) err("Indiquez la date de la présentation.");
        seuil = Number(seuil);
        if (!(seuil >= 0 && seuil <= 20)) err("Le seuil de réussite doit être compris entre 0 et 20.");
        if (!id && !questions) err("Importez les questions pour créer le QCM.");
        if (questions) validerQuestions(questions);
        const now = new Date().toISOString();
        let q;
        if (!id) { q = { id: uid(), titre, date_presentation: date, seuil, created_at: now, updated_at: now }; d.qcm.push(q); }
        else { q = d.qcm.find((x) => x.id === id) || err("QCM introuvable."); Object.assign(q, { titre, date_presentation: date, seuil, updated_at: now }); }
        if (questions) d.questions[q.id] = questions.map((x) => ({ id: uid(), texte: x.texte.trim(), options: x.options.map((o) => o.trim()), bonne: x.bonne, explication: String(x.explication || "").trim() || null }));
        ecrire(d);
        return q.id;
      },
      async supprimerQcm(id) {
        await pause(); exigerAdmin();
        const d = frais();
        d.qcm = d.qcm.filter((x) => x.id !== id);
        delete d.questions[id];
        d.resultats = d.resultats.filter((r) => r.qcm_id !== id);
        if (d.actif === id) d.actif = null;
        ecrire(d);
      },
      async activerQcm(id) {
        await pause(); exigerAdmin();
        const d = frais();
        if (id && !d.qcm.some((x) => x.id === id)) err("QCM introuvable.");
        if (id && !(d.questions[id] || []).length) err("Ce QCM ne contient aucune question.");
        d.actif = id || null;
        ecrire(d);
      },
      async resultats(id) {
        await pause(); exigerAdmin();
        return frais().resultats.filter((r) => r.qcm_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
      },
      async supprimerResultat(id) {
        await pause(); exigerAdmin();
        const d = frais();
        d.resultats = d.resultats.filter((r) => r.id !== id);
        ecrire(d);
      },
      reinitialiserDemo() { store.del(CLE, "local"); mem = null; }
    };
  }

  window.ApiError = ApiError;
  window.QcmApi = C.DEMO ? moteurDemo() : moteurSupabase();
})();
