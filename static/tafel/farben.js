/* Farbpaletten: gespeichert wird nur der Index 0–5, dargestellt je nach Hintergrund. */
(function () {
  const GT = (window.GT = window.GT || {});
  GT.farben = {
    kreide: ["#f4f1e6", "#ffd966", "#ff8a80", "#8ecbff", "#a5e6a0", "#ffb366"],
    weiss: ["#1d1d1d", "#1f5fbf", "#d32f2f", "#2e7d32", "#ef6c00", "#7b1fa2"],
    karten: { gelb: "#ffe27a", gruen: "#9be7b0", blau: "#a9d4ff", rosa: "#ffb3c7" },
    tafel: { kreide: "#23402f", weiss: "#fbfbf8" },
    linien: { kreide: "rgba(244,241,230,0.16)", weiss: "rgba(40,60,90,0.16)" },
    achsen: { kreide: "rgba(244,241,230,0.7)", weiss: "rgba(30,30,30,0.7)" },
    laser: "#ff2a2a",
  };
  GT.theme = (hintergrund) => (hintergrund === "weiss" ? "weiss" : "kreide");
  GT.farbe = (index, theme) => {
    const p = GT.farben[theme] || GT.farben.kreide;
    return p[Math.max(0, Math.min(5, index | 0))];
  };
  GT.markerDeckkraft = (theme) => (theme === "weiss" ? 0.38 : 0.55);
  GT.staerken = { stift: [4, 8, 14], marker: [18, 28, 40], form: [4, 7, 11] };
})();
