export default function TheOldWay() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a1628 0%, #0f1f3a 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>The Problem</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.8vw", marginTop: "1vh" }}>The Old Way</h2>
      </div>
      <div className="absolute top-[24vh] left-[6vw] w-[38vw]">
        <p className="font-body font-semibold text-text" style={{ fontSize: "1.8vw", marginBottom: "3vh" }}>Traditional Top-Down Funnel</p>
        <div className="flex flex-col gap-[1.5vh]">
          <div className="flex items-center gap-[1vw] px-[1.5vw] py-[1.5vh] rounded" style={{ background: "rgba(79,110,247,0.08)", borderLeft: "3px solid rgba(79,110,247,0.3)" }}>
            <span className="font-body font-bold text-primary" style={{ fontSize: "1.5vw", minWidth: "2vw" }}>1</span>
            <span className="font-body text-text" style={{ fontSize: "1.5vw" }}>Screen by financials (P/E, revenue)</span>
          </div>
          <div className="flex items-center gap-[1vw] px-[1.5vw] py-[1.5vh] rounded" style={{ background: "rgba(79,110,247,0.06)", borderLeft: "3px solid rgba(79,110,247,0.25)" }}>
            <span className="font-body font-bold text-primary" style={{ fontSize: "1.5vw", minWidth: "2vw" }}>2</span>
            <span className="font-body text-text" style={{ fontSize: "1.5vw" }}>Filter by sector / geography</span>
          </div>
          <div className="flex items-center gap-[1vw] px-[1.5vw] py-[1.5vh] rounded" style={{ background: "rgba(79,110,247,0.04)", borderLeft: "3px solid rgba(79,110,247,0.2)" }}>
            <span className="font-body font-bold text-primary" style={{ fontSize: "1.5vw", minWidth: "2vw" }}>3</span>
            <span className="font-body text-text" style={{ fontSize: "1.5vw" }}>Rank by market cap</span>
          </div>
          <div className="flex items-center gap-[1vw] px-[1.5vw] py-[1.5vh] rounded" style={{ background: "rgba(79,110,247,0.03)", borderLeft: "3px solid rgba(79,110,247,0.15)" }}>
            <span className="font-body font-bold text-primary" style={{ fontSize: "1.5vw", minWidth: "2vw" }}>4</span>
            <span className="font-body text-text" style={{ fontSize: "1.5vw" }}>Manual management review</span>
          </div>
          <div className="flex items-center gap-[1vw] px-[1.5vw] py-[1.5vh] rounded" style={{ background: "rgba(79,110,247,0.02)", borderLeft: "3px solid rgba(79,110,247,0.1)" }}>
            <span className="font-body font-bold text-primary" style={{ fontSize: "1.5vw", minWidth: "2vw" }}>5</span>
            <span className="font-body text-text" style={{ fontSize: "1.5vw" }}>Static quarterly report</span>
          </div>
          <div className="flex items-center gap-[1vw] px-[1.5vw] py-[1.5vh] rounded" style={{ background: "rgba(79,110,247,0.01)", borderLeft: "3px solid rgba(79,110,247,0.05)" }}>
            <span className="font-body font-bold text-primary" style={{ fontSize: "1.5vw", minWidth: "2vw" }}>6</span>
            <span className="font-body text-text" style={{ fontSize: "1.5vw" }}>Company shortlist</span>
          </div>
        </div>
      </div>
      <div className="absolute top-[24vh] right-[6vw] w-[38vw]">
        <p className="font-body font-semibold text-hot" style={{ fontSize: "1.8vw", marginBottom: "3vh" }}>What You Miss</p>
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
          <p className="font-display font-bold text-hot tracking-tight" style={{ fontSize: "8vw", lineHeight: "1" }}>80%</p>
          <p className="font-body text-text mt-[2vh]" style={{ fontSize: "1.8vw" }}>below the line of visibility</p>
          <div className="mt-[3vh] w-full h-[0.3vh]" style={{ background: "rgba(245,158,11,0.2)" }} />
          <p className="font-body text-muted mt-[2vh]" style={{ fontSize: "1.5vw" }}>Capability gaps, operational moats, disruption trajectories, cross-industry pattern shifts</p>
        </div>
      </div>
      <div className="absolute bottom-[4vh] left-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "1.3vw" }}>Financials tell you where a company has been. Capabilities tell you where it's going.</p>
      </div>
    </div>
  );
}
