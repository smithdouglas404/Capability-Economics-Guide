export default function WhatWeSee() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Differentiation</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>What We See That Others Don't</h2>
      </div>
      <div className="absolute top-[24vh] left-[4vw] right-[4vw] grid grid-cols-2 gap-[2vw]">
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(79,110,247,0.05)", border: "1px solid rgba(79,110,247,0.15)" }}>
          <div className="w-[3vw] h-[3vw] rounded-sm flex items-center justify-center mb-[1.5vh]" style={{ background: "rgba(79,110,247,0.12)" }}>
            <span className="font-body font-bold text-primary" style={{ fontSize: "1.5vw" }}>1</span>
          </div>
          <p className="font-body font-semibold text-text" style={{ fontSize: "1.8vw" }}>Sub-Company Resolution</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>We analyze individual capabilities within a company, not just the company as a whole</p>
        </div>
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)" }}>
          <div className="w-[3vw] h-[3vw] rounded-sm flex items-center justify-center mb-[1.5vh]" style={{ background: "rgba(245,158,11,0.12)" }}>
            <span className="font-body font-bold text-hot" style={{ fontSize: "1.5vw" }}>2</span>
          </div>
          <p className="font-body font-semibold text-text" style={{ fontSize: "1.8vw" }}>Cross-Industry Patterns</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>Recognize capability patterns that repeat across healthcare, banking, manufacturing, and more</p>
        </div>
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
          <div className="w-[3vw] h-[3vw] rounded-sm flex items-center justify-center mb-[1.5vh]" style={{ background: "rgba(59,130,246,0.12)" }}>
            <span className="font-body font-bold text-emerging" style={{ fontSize: "1.5vw" }}>3</span>
          </div>
          <p className="font-body font-semibold text-text" style={{ fontSize: "1.8vw" }}>Temporal Trajectory</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>Track capability evolution over time, not just current state -- where are things heading</p>
        </div>
        <div className="rounded-sm p-[2vw]" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)" }}>
          <div className="w-[3vw] h-[3vw] rounded-sm flex items-center justify-center mb-[1.5vh]" style={{ background: "rgba(99,102,241,0.12)" }}>
            <span className="font-body font-bold text-accent" style={{ fontSize: "1.5vw" }}>4</span>
          </div>
          <p className="font-body font-semibold text-text" style={{ fontSize: "1.8vw" }}>Autonomous Research</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>Continuous agentic research with Mem0 memory -- intelligence that compounds over time</p>
        </div>
      </div>
    </div>
  );
}
