/* QCM GESTOCI v2.0 — lecteur de fichiers Excel (.xlsx), sans bibliothèque externe.
 * Un .xlsx est une archive ZIP de fichiers XML : on lit l'archive, on décompresse
 * (DecompressionStream, intégré aux navigateurs récents) et on extrait les cellules.
 * LireExcel(fichier, "Questions") -> Promise<Array<Array<string>>> (lignes x colonnes)
 */
(() => {
  "use strict";

  const echec = (m) => { throw new Error(m); };

  // ---------- archive ZIP ----------
  function lireZip(buf) {
    const v = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) echec("Ce fichier n'est pas un classeur Excel (.xlsx) valide.");
    const nb = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entrees = new Map();
    for (let k = 0; k < nb; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) echec("Archive Excel endommagée.");
      const methode = v.getUint16(p + 10, true);
      const tailleC = v.getUint32(p + 20, true);
      const lgNom = v.getUint16(p + 28, true);
      const lgExtra = v.getUint16(p + 30, true);
      const lgCom = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const nom = dec.decode(new Uint8Array(buf, p + 46, lgNom));
      entrees.set(nom, { methode, tailleC, local });
      p += 46 + lgNom + lgExtra + lgCom;
    }
    async function lire(nom) {
      const e = entrees.get(nom);
      if (!e) return null;
      const debut = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
      const brut = new Uint8Array(buf, debut, e.tailleC);
      if (e.methode === 0) return dec.decode(brut);
      if (e.methode !== 8) echec("Compression non prise en charge dans ce fichier Excel.");
      if (typeof DecompressionStream === "undefined") echec("Navigateur trop ancien : utilisez une version récente de Chrome, Edge ou Firefox.");
      const flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(flux).text();
    }
    return { lire, noms: () => [...entrees.keys()] };
  }

  // ---------- XML ----------
  const xml = (txt) => {
    const d = new DOMParser().parseFromString(txt, "application/xml");
    if (d.getElementsByTagName("parsererror").length) echec("Contenu Excel illisible.");
    return d;
  };
  const tous = (el, nom) => Array.from(el.getElementsByTagNameNS("*", nom));
  const texteRiche = (el) => tous(el, "t").filter((t) => !t.closest || !t.closest("rPh")).map((t) => t.textContent).join("");

  function colonne(ref) {
    const m = /^([A-Z]+)/.exec(ref || "");
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function LireExcel(fichier, feuilleVoulue) {
    if (/\.xls$/i.test(fichier.name)) echec("Ancien format .xls : dans Excel, faites « Enregistrer sous » au format .xlsx.");
    if (/\.(csv|ods)$/i.test(fichier.name)) echec("Importez le modèle au format Excel .xlsx.");
    const zip = lireZip(await fichier.arrayBuffer());

    // Feuille à lire : celle nommée feuilleVoulue, sinon la première.
    const wb = xml((await zip.lire("xl/workbook.xml")) || echec("Ce fichier n'est pas un classeur Excel (.xlsx) valide."));
    const feuilles = tous(wb, "sheet");
    if (!feuilles.length) echec("Le classeur ne contient aucune feuille.");
    const norm = (s) => String(s).trim().toLowerCase();
    const choisie = feuilles.find((s) => norm(s.getAttribute("name")) === norm(feuilleVoulue)) || feuilles[0];
    const rid = choisie.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || choisie.getAttribute("r:id");
    const rels = xml((await zip.lire("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
    const rel = tous(rels, "Relationship").find((r) => r.getAttribute("Id") === rid);
    let chemin = rel ? rel.getAttribute("Target") : "worksheets/sheet1.xml";
    chemin = chemin.startsWith("/") ? chemin.slice(1) : "xl/" + chemin.replace(/^\.\//, "");

    const partages = [];
    const ss = await zip.lire("xl/sharedStrings.xml");
    if (ss) for (const si of tous(xml(ss), "si")) partages.push(texteRiche(si));

    const feuille = xml((await zip.lire(chemin)) || echec("Feuille introuvable dans le classeur."));
    const lignes = [];
    for (const row of tous(feuille, "row")) {
      const r = Number(row.getAttribute("r")) || lignes.length + 1;
      const ligne = [];
      let col = 0;
      for (const c of tous(row, "c")) {
        const ref = c.getAttribute("r");
        if (ref) col = colonne(ref);
        const t = c.getAttribute("t");
        const vEl = tous(c, "v")[0];
        let val = "";
        if (t === "s") val = partages[Number(vEl && vEl.textContent)] ?? "";
        else if (t === "inlineStr") val = texteRiche(c);
        else if (t === "b") val = vEl && vEl.textContent === "1" ? "VRAI" : "FAUX";
        else if (vEl) val = vEl.textContent;
        ligne[col] = String(val);
        col++;
      }
      lignes[r - 1] = Array.from(ligne, (x) => x ?? "");
    }
    return Array.from(lignes, (x) => x || []);
  }

  window.LireExcel = LireExcel;
})();
