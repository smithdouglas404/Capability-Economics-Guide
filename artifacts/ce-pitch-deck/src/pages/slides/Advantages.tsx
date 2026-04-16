export default function Advantages() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Comparison</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>Static Deck vs. CE Workbench</h2>
      </div>
      <div className="absolute top-[24vh] left-[6vw] right-[6vw]">
        <div className="grid grid-cols-3 gap-0" style={{ border: "1px solid rgba(107,114,128,0.2)" }}>
          <div className="p-[1.5vw]" style={{ background: "rgba(107,114,128,0.05)", borderBottom: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body font-semibold text-muted" style={{ fontSize: "1.5vw" }}>Dimension</p>
          </div>
          <div className="p-[1.5vw]" style={{ background: "rgba(100,116,139,0.05)", borderBottom: "1px solid rgba(107,114,128,0.15)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body font-semibold text-cooling" style={{ fontSize: "1.5vw" }}>Static Deck</p>
          </div>
          <div className="p-[1.5vw]" style={{ background: "rgba(79,110,247,0.05)", borderBottom: "1px solid rgba(107,114,128,0.15)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body font-semibold text-primary" style={{ fontSize: "1.5vw" }}>CE Workbench</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)" }}>
            <p className="font-body text-text" style={{ fontSize: "1.4vw" }}>Research Frequency</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.4vw" }}>Quarterly / ad-hoc</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-primary" style={{ fontSize: "1.4vw" }}>Continuous autonomous</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)" }}>
            <p className="font-body text-text" style={{ fontSize: "1.4vw" }}>Data Sources</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.4vw" }}>Analyst reports, filings</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-primary" style={{ fontSize: "1.4vw" }}>Multi-source triangulation</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)" }}>
            <p className="font-body text-text" style={{ fontSize: "1.4vw" }}>Personalization</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.4vw" }}>One-size-fits-all</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-primary" style={{ fontSize: "1.4vw" }}>Role-specific C-suite views</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)" }}>
            <p className="font-body text-text" style={{ fontSize: "1.4vw" }}>Output Format</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.4vw" }}>PDF / slides</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderBottom: "1px solid rgba(107,114,128,0.1)", borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-primary" style={{ fontSize: "1.4vw" }}>Interactive workbench</p>
          </div>
          <div className="p-[1.5vw]">
            <p className="font-body text-text" style={{ fontSize: "1.4vw" }}>Memory</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.4vw" }}>None -- starts fresh</p>
          </div>
          <div className="p-[1.5vw]" style={{ borderLeft: "1px solid rgba(107,114,128,0.15)" }}>
            <p className="font-body text-primary" style={{ fontSize: "1.4vw" }}>Mem0 persistent context</p>
          </div>
        </div>
      </div>
    </div>
  );
}
