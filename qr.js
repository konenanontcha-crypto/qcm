/* QCM GESTOCI v2.0 — QR code unique : encode l'adresse du site (dossier de cette page) */
(() => {
  "use strict";
  const canvas = document.getElementById("qr");
  const input = document.getElementById("url");
  const warn = document.getElementById("warn");
  const logo = new Image();
  let logoReady = false;
  const siteUrl = () => new URL("./", location.href).href.split("#")[0];

  function draw() {
    const text = input.value.trim() || siteUrl();
    warn.hidden = !/^(file:|https?:\/\/(localhost|127\.))/i.test(text);
    // Correction d'erreur H : le QR reste lisible malgré le logo au centre.
    const qr = qrcode(0, "H");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.floor(canvas.width / (n + quiet * 2));
    const size = cell * (n + quiet * 2);
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#10602f";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
      }
    }
    if (logoReady) {
      const box = Math.round(size * 0.22); // ~5 % de la surface : bien sous la limite du niveau H
      const x = (size - box) / 2;
      ctx.fillStyle = "#fff";
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x - 6, x - 6, box + 12, box + 12, 14);
        ctx.fill();
      } else {
        ctx.fillRect(x - 6, x - 6, box + 12, box + 12);
      }
      const ratio = logo.width / logo.height;
      const w = ratio >= 1 ? box : box * ratio;
      const h = ratio >= 1 ? box / ratio : box;
      ctx.drawImage(logo, (size - w) / 2, (size - h) / 2, w, h);
    }
  }

  input.value = siteUrl();
  input.addEventListener("input", draw);
  logo.onload = () => { logoReady = true; draw(); };
  logo.src = "logo.png";
  draw();

  document.getElementById("btnPng").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "qr_qcm_gestoci.png";
    document.body.append(a);
    a.click();
    a.remove();
  });
  document.getElementById("btnPrint").addEventListener("click", () => window.print());
})();
