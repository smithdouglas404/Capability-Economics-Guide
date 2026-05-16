export default function NextSteps() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0d0d14 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Next Steps</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>Three Paths Forward</h2>
      </div>
      <div className="absolute top-[24vh] left-[4vw] right-[4vw] flex gap-[2vw]">
        <div className="flex-1 rounded-sm p-[2vw] flex flex-col" style={{ background: "rgba(148,163,184,0.04)", border: "1px solid rgba(148,163,184,0.12)" }}>
          <p className="font-body font-bold text-stakes" style={{ fontSize: "1.3vw" }}>PATH 1</p>
          <p className="font-display font-bold text-text mt-[1vh]" style={{ fontSize: "2.2vw" }}>Quick Assessment</p>
          <p className="font-body text-muted mt-[1.5vh]" style={{ fontSize: "1.5vw" }}>15-minute guided session targeting one company across key capability dimensions</p>
          <div className="mt-auto pt-[3vh]">
            <div className="w-full h-[0.2vh]" style={{ background: "rgba(148,163,184,0.15)" }} />
            <p className="font-body text-muted mt-[1.5vh]" style={{ fontSize: "1.3vw" }}>Ideal for: Initial evaluation</p>
          </div>
        </div>
        <div className="flex-1 rounded-sm p-[2vw] flex flex-col" style={{ background: "rgba(79,110,247,0.05)", border: "1px solid rgba(79,110,247,0.2)" }}>
          <p className="font-body font-bold text-primary" style={{ fontSize: "1.3vw" }}>PATH 2</p>
          <p className="font-display font-bold text-text mt-[1vh]" style={{ fontSize: "2.2vw" }}>Deep-Dive Workshop</p>
          <p className="font-body text-muted mt-[1.5vh]" style={{ fontSize: "1.5vw" }}>Half-day working session across your portfolio with full capability X-ray and C-suite intelligence</p>
          <div className="mt-auto pt-[3vh]">
            <div className="w-full h-[0.2vh]" style={{ background: "rgba(79,110,247,0.2)" }} />
            <p className="font-body text-muted mt-[1.5vh]" style={{ fontSize: "1.3vw" }}>Ideal for: Portfolio analysis</p>
          </div>
        </div>
        <div className="flex-1 rounded-sm p-[2vw] flex flex-col" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <p className="font-body font-bold text-hot" style={{ fontSize: "1.3vw" }}>PATH 3</p>
          <p className="font-display font-bold text-text mt-[1vh]" style={{ fontSize: "2.2vw" }}>Platform License</p>
          <p className="font-body text-muted mt-[1.5vh]" style={{ fontSize: "1.5vw" }}>Full workbench access with continuous monitoring, alerts, and persistent memory across your thesis</p>
          <div className="mt-auto pt-[3vh]">
            <div className="w-full h-[0.2vh]" style={{ background: "rgba(245,158,11,0.2)" }} />
            <p className="font-body text-muted mt-[1.5vh]" style={{ fontSize: "1.3vw" }}>Ideal for: Ongoing intelligence</p>
          </div>
        </div>
      </div>
      <div className="absolute bottom-[6vh] left-[6vw] right-[6vw] flex justify-between items-center">
        <div className="flex items-center gap-[1vw]">
          <div className="w-[2.8vw] h-[2.8vw] rounded-sm flex items-center justify-center" style={{ background: "linear-gradient(135deg, #4f6ef7, #6366f1)" }}>
            <span className="font-display font-bold text-white" style={{ fontSize: "1.4vw" }}>CE</span>
          </div>
          <span className="font-body font-medium text-text" style={{ fontSize: "1.5vw" }}>Inflexcvi</span>
        </div>
        <p className="font-body text-muted" style={{ fontSize: "1.3vw" }}>The Capability Lens: What Others Can't See</p>
      </div>
    </div>
  );
}
