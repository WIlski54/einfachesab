/* Digitale Tafel auf der Schülerseite.
   - Overlay: übernimmt den Bildschirm, solange die Lehrkraft die Tafel live geschaltet hat
     (je nach Freigabe darf die Person dann schreiben oder nur zusehen).
   - Hinweis „Tafelbild der Stunde“, sobald die Lehrkraft eines bereitstellt.
   Die Anmeldung läuft über das Session-Cookie dieses Arbeitsblatts.
   „Möchte ich vorstellen“ steht weiter im AB-Rand (ab.js) und legt ein Angebot an der Tafel an. */
(function () {
  "use strict";
  if (!window.GT || !GT.TafelApp || !window.AB_ICH) return;
  GT.authKopf = () => ({ "X-Rolle": "schueler" });      // nur Schüler-Rechte, auch wenn dieser Browser zugleich Lehrkraft ist
  GT.socketAuth = () => ({ rolle: "schueler" });
  GT.abmelden = () => { location.href = "/login"; };
  GT.ich = window.AB_ICH;

  const overlay = document.getElementById("tafel-overlay");
  const app = (window.tafelApp = new GT.TafelApp(document.getElementById("tafel-flaeche"), { rolle: "schueler" }));

  function tafelbildHinweis(url) {
    let a = document.getElementById("tafelbild-link");
    if (!a) {
      a = document.createElement("a");
      a.id = "tafelbild-link";
      a.className = "tafelbild-link";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "📋 Tafelbild der Stunde";
      document.body.appendChild(a);
    }
    a.href = url;
  }

  app.onSocket = (s) => {
    s.on("ab:tafelbild", (d) => { tafelbildHinweis(d.url); GT.toast("📋 Das Tafelbild ist jetzt da (oben rechts)."); });
  };
  app.onZustand = (z) => {
    const zeigen = z.modus === "live";
    if (overlay.hidden === zeigen) {
      overlay.hidden = !zeigen;
      document.body.classList.toggle("tafel-aktiv", zeigen);
      if (zeigen) { if (document.activeElement) document.activeElement.blur(); setTimeout(() => app.buehne.anpassen(), 0); }
    }
  };
  app.starten();
  GT.api("GET", "/tafel/api/status").then((s) => { if (s.tafelbild_url) tafelbildHinweis(s.tafelbild_url); }).catch(() => {});
})();
