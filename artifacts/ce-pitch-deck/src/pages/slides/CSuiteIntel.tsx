export default function CSuiteIntel() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>C-Suite Intelligence</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>Same Gap, Four Lenses</h2>
      </div>
      <div className="absolute top-[6vh] right-[6vw] rounded-sm px-[1.5vw] py-[0.8vh]" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
        <p className="font-body font-semibold text-hot" style={{ fontSize: "1.3vw" }}>Gap: AI Underwriting</p>
      </div>
      <div className="absolute top-[22vh] left-[4vw] right-[4vw] grid grid-cols-2 gap-[2vw]">
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(79,110,247,0.05)", border: "1px solid rgba(79,110,247,0.15)" }}>
          <p className="font-body font-bold text-primary" style={{ fontSize: "2vw" }}>CEO</p>
          <p className="font-body font-medium text-text mt-[1vh]" style={{ fontSize: "1.6vw" }}>Strategic Imperative</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>"This gap threatens our market position. Competitors with AI underwriting achieve 40% faster quote cycles."</p>
          <div className="mt-[1.5vh] flex items-center gap-[0.5vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-hot" />
            <span className="font-body text-hot" style={{ fontSize: "1.2vw" }}>Priority: Critical</span>
          </div>
        </div>
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)" }}>
          <p className="font-body font-bold text-hot" style={{ fontSize: "2vw" }}>CFO</p>
          <p className="font-body font-medium text-text mt-[1vh]" style={{ fontSize: "1.6vw" }}>P&L Impact</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>"Closing this gap reduces combined ratio by 3.5 points. ROI breakeven in 14 months."</p>
          <div className="mt-[1.5vh] flex items-center gap-[0.5vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-hot" />
            <span className="font-body text-hot" style={{ fontSize: "1.2vw" }}>Priority: High</span>
          </div>
        </div>
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
          <p className="font-body font-bold text-emerging" style={{ fontSize: "2vw" }}>CTO</p>
          <p className="font-body font-medium text-text mt-[1vh]" style={{ fontSize: "1.6vw" }}>Technical Debt</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>"Legacy underwriting system blocks ML pipeline integration. Requires core platform modernization."</p>
          <div className="mt-[1.5vh] flex items-center gap-[0.5vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-emerging" />
            <span className="font-body text-emerging" style={{ fontSize: "1.2vw" }}>Priority: High</span>
          </div>
        </div>
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(100,116,139,0.05)", border: "1px solid rgba(100,116,139,0.15)" }}>
          <p className="font-body font-bold text-stakes" style={{ fontSize: "2vw" }}>CHRO</p>
          <p className="font-body font-medium text-text mt-[1vh]" style={{ fontSize: "1.6vw" }}>Talent Strategy</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>"Need 12 ML engineers and actuarial data scientists. Current team lacks AI/ML competencies."</p>
          <div className="mt-[1.5vh] flex items-center gap-[0.5vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-cooling" />
            <span className="font-body text-cooling" style={{ fontSize: "1.2vw" }}>Priority: Medium</span>
          </div>
        </div>
      </div>
    </div>
  );
}
