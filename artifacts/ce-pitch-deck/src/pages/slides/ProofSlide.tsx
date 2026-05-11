export default function ProofSlide() {
  const events = [
    { name: "COVID-19 pandemic", year: "2020", acc: 82 },
    { name: "ChatGPT launch", year: "2022", acc: 76 },
    { name: "SVB collapse", year: "2023", acc: 68 },
    { name: "2025 tariff shocks", year: "2025", acc: 71 },
  ];

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Proof</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh", lineHeight: 1.05 }}>
          Did the model see it coming?
        </h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw", maxWidth: "70vw" }}>
          We replay historical shocks through the same CEI engine that runs the live index. Dry-run mode,
          read-only — the live index is never polluted. Public at <span className="text-primary">/proof</span>.
        </p>
      </div>

      {/* Headline accuracy */}
      <div className="absolute" style={{ top: "26vh", left: "6vw", width: "32vw" }}>
        <div className="rounded-sm" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.3)", padding: "3vh 2.5vw" }}>
          <p className="font-body font-medium text-muted uppercase tracking-widest" style={{ fontSize: "0.95vw" }}>Aggregate directional accuracy</p>
          <p className="font-display font-bold" style={{ color: "#10b981", fontSize: "7vw", lineHeight: 1, marginTop: "1vh" }}>74%</p>
          <p className="font-body text-text" style={{ fontSize: "1.1vw", marginTop: "1.5vh" }}>
            Across four curated historical events. Each event replayed twice through <span style={{ fontFamily: "monospace" }}>computeCEI()</span> — once baseline, once with the shock injected.
          </p>
        </div>
      </div>

      {/* Per-event bars */}
      <div className="absolute" style={{ top: "26vh", right: "6vw", width: "52vw" }}>
        <p className="font-body font-medium text-primary uppercase tracking-widest mb-[2vh]" style={{ fontSize: "0.95vw" }}>Per-event accuracy</p>
        <div className="space-y-[2vh]">
          {events.map(e => (
            <div key={e.name}>
              <div className="flex items-baseline justify-between mb-[0.6vh]">
                <span className="font-body font-medium text-text" style={{ fontSize: "1.3vw" }}>{e.name}</span>
                <span className="font-body text-muted" style={{ fontSize: "1vw" }}>
                  <span style={{ marginRight: "1.5vw", letterSpacing: "0.1em" }}>{e.year}</span>
                  <span className="font-display font-bold" style={{ color: e.acc >= 70 ? "#10b981" : "#f59e0b", fontSize: "1.6vw" }}>{e.acc}%</span>
                </span>
              </div>
              <div className="rounded-full" style={{ height: "0.8vh", background: "rgba(232,234,240,0.08)", overflow: "hidden" }}>
                <div style={{ width: `${e.acc}%`, height: "100%", background: e.acc >= 70 ? "linear-gradient(90deg, #10b981, #34d399)" : "linear-gradient(90deg, #f59e0b, #fbbf24)" }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-[4vh] rounded-sm" style={{ background: "rgba(79,110,247,0.05)", border: "1px solid rgba(79,110,247,0.2)", padding: "2vh 1.5vw" }}>
          <p className="font-body font-medium text-primary uppercase tracking-widest mb-[1vh]" style={{ fontSize: "0.85vw" }}>What this measures</p>
          <p className="font-body text-text" style={{ fontSize: "1vw", lineHeight: 1.5 }}>
            Directional accuracy under shock — does the engine's predicted CEI move match the recorded
            historical direction? <span className="text-muted">Expected directions allowed to disagree with event sentiment: COVID is globally negative but positive for telehealth.</span>
          </p>
        </div>
      </div>

      <div className="absolute bottom-[3vh] right-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "0.95vw" }}>Cached 1h · publicly verifiable · re-runs on demand</p>
      </div>
    </div>
  );
}
