/* Kamera-Foto (zuschneiden, drehen, aufhellen) und „Meine Aufgabe einfügen“. */
(function () {
  const GT = window.GT;
  const MAX_KANTE = 1600;

  /** Karte (für Server oder Angebot) aus einem Eintrag von meineAufgaben/aufgabenVon. */
  GT.karteAus = (a) => ({ titel: a.titel, aufgabentyp: a.typ, niveau: a.niveau, inhalt: a.inhalt });

  // ---------- AB-Antworten als HTML (Vorschau in Dialogen und im Dashboard) ----------
  GT.abVorschau = (a) => {
    const d = a.inhalt || {};
    let koerper = "";
    if (a.typ === "lueckentext" && d.segmente) {
      koerper = d.segmente.map((s) => (s.luecke !== undefined ? `<mark>${GT.esc(s.luecke)}</mark>` : GT.esc(s.text))).join("");
    } else if (a.typ === "zuordnung" && d.paare) {
      koerper = d.paare.map(([l, r]) => `${GT.esc(l)} → <b>${GT.esc(r)}</b>`).join("<br>") || "<i>noch leer</i>";
    } else koerper = GT.esc(d.text || "") || "<i>noch leer</i>";
    return `<div class="gt-abkarte"><div class="gt-abkarte-kopf"><b>${GT.esc(a.titel)}</b>${a.niveau ? " · Niveau " + GT.esc(a.niveau) : ""}</div>${koerper}</div>`;
  };

  GT.abDialog = async (app) => {
    app.status("ab_antwort");
    const inhalt = document.createElement("div");
    inhalt.className = "gt-abwahl";
    inhalt.innerHTML = '<div class="gt-hinweis">Lade deine Aufgaben …</div>';
    let gewaehlt = null;
    const d = app.dialog({
      titel: "📥 Meine Aufgabe einfügen", inhalt, breit: true, beimSchliessen: () => app.status(null),
      knoepfe: [{ text: "Auf die Tafel", name: "ok", haupt: true, aktion: async (api) => {
        if (!gewaehlt) return;
        const id = GT.uid("ab");
        const m = app.buehne.mitte();
        app.nachEinfuegenWaehlen = id;
        const a = await app.emit("tafel:ab_karte", { aufgabe_id: gewaehlt.aufgabe_id, id, x: Math.round(m.x - 290), y: Math.round(m.y - 150),
          karte: GT.abAdapter ? GT.karteAus(gewaehlt) : undefined });
        if (a.ok) api.schliessen(); else GT.toast(a.grund || "Das hat nicht geklappt.", "fehler");
      } }],
    });
    d.knopf("ok").disabled = true;
    try {
      const aufgaben = GT.abAdapter ? await GT.abAdapter.meineAufgaben() : (await GT.api("GET", "/tafel/api/meine_aufgaben")).aufgaben;
      inhalt.innerHTML = '<div class="gt-abliste"></div><div class="gt-abvorschau"><div class="gt-hinweis">Wähle links eine bearbeitete Aufgabe.</div></div>';
      const liste = inhalt.querySelector(".gt-abliste");
      aufgaben.forEach((a) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "gt-abeintrag";
        b.disabled = !a.bearbeitet;
        b.innerHTML = `<b>${GT.esc(a.titel)}</b><small>${a.niveau ? "Niveau " + GT.esc(a.niveau) : ""}</small><span class="${a.bearbeitet ? "ok" : "leer"}">${a.bearbeitet ? "bearbeitet" : "noch leer"}</span>`;
        b.onclick = () => {
          gewaehlt = a;
          liste.querySelectorAll("button").forEach((x) => x.classList.toggle("aktiv", x === b));
          inhalt.querySelector(".gt-abvorschau").innerHTML = '<div class="gt-hinweis">So erscheint sie auf der Tafel:</div>' + GT.abVorschau(a);
          d.knopf("ok").disabled = false;
        };
        liste.appendChild(b);
      });
    } catch (e) { inhalt.innerHTML = `<div class="gt-fehler">${GT.esc(e.message)}</div>`; }
  };

  GT.registriere("ab_antwort", { icon: "📥", titel: "Meine Aufgabe einfügen", art: "aktion", klick: (app) => GT.abDialog(app) });

  // ---------- Kamera ----------
  function aufhellen(ctx, w, h) {
    const bild = ctx.getImageData(0, 0, w, h), px = bild.data;
    for (let i = 0; i < px.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        let v = (px[i + k] - 128) * 1.5 + 128 + 30;
        px[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(bild, 0, 0);
  }

  function drehen(quelle) {
    const c = document.createElement("canvas");
    c.width = quelle.height; c.height = quelle.width;
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(quelle, 0, 0);
    return c;
  }

  function alsCanvas(img) {
    const s = Math.min(1, 3000 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  GT.kameraStarten = (app) => {
    const eingabe = document.createElement("input");
    eingabe.type = "file";
    eingabe.accept = "image/*";
    eingabe.setAttribute("capture", "environment");
    eingabe.style.display = "none";
    document.body.appendChild(eingabe);
    app.status("foto");
    eingabe.onchange = async () => {
      const datei = eingabe.files && eingabe.files[0];
      eingabe.remove();
      if (!datei) { app.status(null); return; }
      try {
        const url = URL.createObjectURL(datei);
        const img = await GT.ladeBild(url);
        URL.revokeObjectURL(url);
        GT.kameraDialog(app, alsCanvas(img));
      } catch (e) { GT.toast("Das Foto konnte nicht gelesen werden.", "fehler"); app.status(null); }
    };
    eingabe.click();
    // Wenn der Dialog abgebrochen wird, kommt kein change-Ereignis – Status nach einer Weile zurücksetzen
    setTimeout(() => { if (document.body.contains(eingabe)) { eingabe.remove(); app.status(null); } }, 120000);
  };

  GT.kameraDialog = (app, startQuelle) => {
    let quelle = startQuelle, hell = false;
    let rahmen = { l: 0.03, t: 0.03, r: 0.97, b: 0.97 };
    const inhalt = document.createElement("div");
    inhalt.innerHTML = `<div class="gt-zuschnitt"><canvas></canvas><div class="gt-rahmen"><i data-e="lt"></i><i data-e="rt"></i><i data-e="lb"></i><i data-e="rb"></i></div></div>
      <div class="gt-tasten"><button type="button" data-a="drehen">↺ Drehen</button><button type="button" data-a="hell">☀ Aufhellen</button><button type="button" data-a="neu">🔁 Neu aufnehmen</button></div>
      <div class="gt-hinweis">Ziehe die gelben Ecken, um den Ausschnitt zu wählen.</div>`;
    const canvas = inhalt.querySelector("canvas");
    const rahmenEl = inhalt.querySelector(".gt-rahmen");
    const d = app.dialog({
      titel: "📷 Foto zuschneiden", inhalt, breit: true, beimSchliessen: () => app.status(null),
      knoepfe: [{ text: "Auf die Tafel", name: "ok", haupt: true, aktion: async (api) => {
        const knopf = api.knopf("ok");
        knopf.disabled = true; knopf.textContent = "Lädt hoch …";
        try {
          const sx = rahmen.l * quelle.width, sy = rahmen.t * quelle.height;
          const sw = (rahmen.r - rahmen.l) * quelle.width, sh = (rahmen.b - rahmen.t) * quelle.height;
          const s = Math.min(1, MAX_KANTE / Math.max(sw, sh));
          const aus = document.createElement("canvas");
          aus.width = Math.round(sw * s); aus.height = Math.round(sh * s);
          const ctx = aus.getContext("2d");
          ctx.drawImage(quelle, sx, sy, sw, sh, 0, 0, aus.width, aus.height);
          if (hell) aufhellen(ctx, aus.width, aus.height);
          const blob = await new Promise((ok) => aus.toBlob(ok, "image/jpeg", 0.85));
          const fd = new FormData();
          fd.append("datei", blob, "foto.jpg");
          const { url } = await GT.api("POST", "/tafel/api/foto", fd);
          const f = Math.min(760 / aus.width, 560 / aus.height);
          const breite = Math.round(aus.width * f), hoehe = Math.round(aus.height * f);
          api.schliessen();
          app.einfuegenMitte({ id: GT.uid("b"), typ: "bild", url, breite, hoehe }, breite, hoehe);
        } catch (e) {
          GT.toast(e.message, "fehler");
          knopf.disabled = false; knopf.textContent = "Auf die Tafel";
        }
      } }],
    });
    const zeichnen = () => {
      const maxB = Math.min(720, window.innerWidth - 80), maxH = Math.min(440, window.innerHeight - 280);
      const s = Math.min(maxB / quelle.width, maxH / quelle.height);
      canvas.width = Math.round(quelle.width * s); canvas.height = Math.round(quelle.height * s);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(quelle, 0, 0, canvas.width, canvas.height);
      if (hell) aufhellen(ctx, canvas.width, canvas.height);
      rahmenSetzen();
    };
    const rahmenSetzen = () => {
      Object.assign(rahmenEl.style, { left: rahmen.l * canvas.width + "px", top: rahmen.t * canvas.height + "px",
        width: (rahmen.r - rahmen.l) * canvas.width + "px", height: (rahmen.b - rahmen.t) * canvas.height + "px" });
    };
    rahmenEl.addEventListener("pointerdown", (e) => {
      const ecke = e.target.dataset.e;
      if (!ecke) return;
      e.preventDefault();
      e.target.setPointerCapture(e.pointerId);
      const bewegen = (m) => {
        const r = canvas.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (m.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (m.clientY - r.top) / r.height));
        if (ecke[0] === "l") rahmen.l = Math.min(x, rahmen.r - 0.08); else rahmen.r = Math.max(x, rahmen.l + 0.08);
        if (ecke[1] === "t") rahmen.t = Math.min(y, rahmen.b - 0.08); else rahmen.b = Math.max(y, rahmen.t + 0.08);
        rahmenSetzen();
      };
      const los = () => { e.target.removeEventListener("pointermove", bewegen); e.target.removeEventListener("pointerup", los); };
      e.target.addEventListener("pointermove", bewegen);
      e.target.addEventListener("pointerup", los);
    });
    inhalt.querySelector(".gt-tasten").onclick = (e) => {
      const a = e.target.dataset.a;
      if (a === "drehen") { quelle = drehen(quelle); rahmen = { l: rahmen.t, t: 1 - rahmen.r, r: rahmen.b, b: 1 - rahmen.l }; zeichnen(); }
      if (a === "hell") { hell = !hell; e.target.classList.toggle("aktiv", hell); zeichnen(); }
      if (a === "neu") { d.schliessen(); GT.kameraStarten(app); }
    };
    app.status("foto");
    zeichnen();
  };

  GT.registriere("kamera", { icon: "📷", titel: "Foto vom Heft", art: "aktion", klick: (app) => GT.kameraStarten(app) });
})();
