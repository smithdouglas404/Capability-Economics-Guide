export default function VcPePortfolioSlide() {
  const surfaces = [
    {
      label: "Source",
      color: "#3b82f6",
      tagline: "Find the company before the deck arrives.",
      bullets: [
        "Industry → capability heat map",
        "Companies ranked by capability strength + momentum",
        "Filter by EVaR, disruption risk, regulatory exposure",
        "One-click shortlist export to deal pipeline",
      ],
    },
    {
      label: "Comparables",
      color: "#8b5cf6",
      tagline: "Cap-fingerprint CCA, not just SIC code.",
      bullets: [
        "Match peers by capability vector, not industry code",
        "Adjusts for moat strength + disruption posture",
        "Shows the 5 closest peers + 3 surprising ones",
        "Diligence-grade citations on every dimension",
      ],
    },
    {
      label: "Portfolio",
      color: "#f59e0b",
      tagline: "Monitor 30 companies the way you'd cover 3.",
      bullets: [
        "CVI trajectory for every portfolio company",
        "Macro events auto-tagged to affected holdings",
        "Quarterly capability-decay alerts",
        "LP-ready exports without manual digging",
      ],
    },
  ];

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a1628 0%, #0f1f3a 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>VC / PE workflow</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh", lineHeight: 1.05 }}>
          Source. Compare. Monitor.
        </h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw", maxWidth: "75vw" }}>
          Three surfaces that turn capability intelligence into the daily VC/PE workflow &mdash;
          from first-look sourcing through ongoing portfolio monitoring.
        </p>
      </div>

      {/* Three-surface deep dive */}
      <div className="absolute" style={{ top: "26vh", left: "6vw", right: "6vw" }}>
        <div className="grid grid-cols-3 gap-[2vw]">
          {surfaces.map(s => (
            <div key={s.label} className="rounded-sm" style={{ border: `1px solid ${s.color}40`, background: `${s.color}08`, padding: "3vh 1.8vw" }}>
              <div className="flex items-center gap-[0.6vw] mb-[1vh]">
                <div className="rounded-full" style={{ width: "0.8vw", height: "0.8vw", background: s.color }} />
                <p className="font-display font-bold text-text" style={{ fontSize: "1.7vw" }}>{s.label}</p>
              </div>
              <p className="font-body italic text-text mb-[2vh]" style={{ fontSize: "1.05vw", lineHeight: 1.35, color: s.color }}>
                {s.tagline}
              </p>
              <ul className="space-y-[1vh]">
                {s.bullets.map((b, i) => (
                  <li key={i} className="font-body text-text flex items-start gap-[0.6vw]" style={{ fontSize: "0.95vw", lineHeight: 1.4 }}>
                    <span style={{ color: s.color, marginTop: "0.2vh" }}>▸</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Connector pipeline strip */}
      <div className="absolute" style={{ bottom: "8vh", left: "6vw", right: "6vw" }}>
        <p className="font-body font-medium text-primary uppercase tracking-widest mb-[1.2vh]" style={{ fontSize: "0.95vw" }}>One pipeline, one data model</p>
        <div className="flex items-center gap-[1.5vw]">
          <div className="flex-1 px-[1.2vw] py-[1.2vh] rounded-sm" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)" }}>
            <span className="font-body text-text" style={{ fontSize: "1vw" }}>Surface a target in <span style={{ color: "#3b82f6" }}>Source</span></span>
          </div>
          <span className="font-display text-muted" style={{ fontSize: "1.5vw" }}>→</span>
          <div className="flex-1 px-[1.2vw] py-[1.2vh] rounded-sm" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}>
            <span className="font-body text-text" style={{ fontSize: "1vw" }}>Vet against <span style={{ color: "#8b5cf6" }}>Comparables</span></span>
          </div>
          <span className="font-display text-muted" style={{ fontSize: "1.5vw" }}>→</span>
          <div className="flex-1 px-[1.2vw] py-[1.2vh] rounded-sm" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <span className="font-body text-text" style={{ fontSize: "1vw" }}>Track in <span style={{ color: "#f59e0b" }}>Portfolio</span></span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[1vh] right-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "0.95vw" }}>Same capability graph powers all three &middot; no silos &middot; LP-ready exports</p>
      </div>
    </div>
  );
}
