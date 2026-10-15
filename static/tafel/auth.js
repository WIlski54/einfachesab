/* Identität pro Browserfenster: Token in sessionStorage, Schlüssel inkl. ?konto= (für die Testansicht). */
(function () {
  const GT = (window.GT = window.GT || {});
  const params = new URLSearchParams(location.search);
  GT.params = params;
  GT.konto = params.get("konto") || "";
  const schluessel = "gt_token" + (GT.konto ? "_" + GT.konto : "");

  GT.token = () => { try { return sessionStorage.getItem(schluessel); } catch (e) { return null; } };
  GT.setToken = (t) => { try { t ? sessionStorage.setItem(schluessel, t) : sessionStorage.removeItem(schluessel); } catch (e) {} };

  /** Hängt konto/auto an interne Links, damit Testfenster ihre Identität behalten. */
  GT.link = (url) => {
    const u = new URL(url, location.origin);
    if (GT.konto) u.searchParams.set("konto", GT.konto);
    if (params.get("auto")) u.searchParams.set("auto", params.get("auto"));
    return u.pathname + u.search;
  };

  /** Anmeldedaten für HTTP und Live-Verbindung – ein AB überschreibt diese beiden Funktionen
      (Schüler: Session-Cookie, Lehrkraft: X-Lehrer-Token). */
  /** Seitenpfade der Lehrkraft – ein AB kann sie überschreiben. */
  GT.pfade = Object.assign({ dashboard: "/lehrer", tafel: "/lehrer/tafel", rueckblick: "/lehrer/rueckblick" }, GT.pfade || {});

  GT.authKopf = GT.authKopf || (() => ({ "X-Tafel-Token": GT.token() || "" }));
  GT.socketAuth = GT.socketAuth || (() => ({ token: GT.token() }));

  /** Live-Verbindung im eigenen Tafel-Namespace; erst Polling, dann Upgrade (hinter Traefik nötig). */
  GT.verbindung = () => io("/tafel", { auth: GT.socketAuth(), transports: ["polling", "websocket"] });

  GT.api = async (methode, url, body) => {
    const optionen = { method: methode, headers: Object.assign({}, GT.authKopf()), credentials: "same-origin" };
    if (body instanceof FormData) optionen.body = body;
    else if (body !== undefined) {
      optionen.headers["Content-Type"] = "application/json";
      optionen.body = JSON.stringify(body);
    }
    const r = await fetch(url, optionen);
    let daten = {};
    try { daten = await r.json(); } catch (e) { daten = { ok: false, grund: "Serverfehler (" + r.status + ")" }; }
    if (r.status === 401) { GT.abmelden(); throw new Error(daten.grund || "Bitte neu anmelden."); }
    if (!r.ok || daten.ok === false) throw new Error(daten.grund || "Fehler " + r.status);
    return daten;
  };

  /** Testansicht: ?auto=Name meldet das Fenster automatisch an. */
  GT.autoLogin = async () => {
    const auto = params.get("auto");
    if (!auto || GT.token()) return;
    const r = await fetch("/api/testlogin", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: auto }) });
    if (r.ok) GT.setToken((await r.json()).token);
  };

  GT.loginSeite = () => (location.pathname.startsWith("/lehrer") || location.pathname === "/beamer" ? "/lehrer/login" : "/login");

  GT.abmelden = () => {
    GT.setToken(null);
    if (params.get("auto")) { location.reload(); return; }
    location.href = GT.link(GT.loginSeite() + "?weiter=" + encodeURIComponent(location.pathname));
  };

  /** Seiten rufen das zuerst auf. Liefert die Person oder leitet zum Login. */
  GT.anmeldungPruefen = async (rolle) => {
    await GT.autoLogin();
    if (!GT.token()) { GT.abmelden(); return new Promise(() => {}); }
    try {
      const { person } = await GT.api("GET", "/api/ich");
      if (rolle && person.rolle !== rolle) { GT.abmelden(); return new Promise(() => {}); }
      GT.ich = person;
      return person;
    } catch (e) { return new Promise(() => {}); }
  };

  /** Kurze Meldung unten in der Mitte. */
  GT.toast = (text, art) => {
    let box = document.getElementById("gt-toast");
    if (!box) { box = document.createElement("div"); box.id = "gt-toast"; document.body.appendChild(box); }
    // dieselbe Meldung nicht doppelt zeigen (z. B. Ablehnung per Ereignis und per Antwort)
    if ([...box.children].some((c) => c.textContent === text && !c.classList.contains("weg"))) return;
    const el = document.createElement("div");
    el.className = "gt-toast " + (art || "");
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.classList.add("weg"), 2600);
    setTimeout(() => el.remove(), 3200);
  };

  GT.uid = (praefix) => (praefix || "o") + "-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

  GT.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
})();
