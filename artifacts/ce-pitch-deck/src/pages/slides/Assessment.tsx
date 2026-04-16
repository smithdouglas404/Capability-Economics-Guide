export default function Assessment() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Capability Assessment</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>Three-Stage Analysis</h2>
      </div>
      <div className="absolute top-[26vh] left-[6vw] right-[6vw] flex items-start gap-[2vw]">
        <div className="flex-1 text-center">
          <div className="mx-auto w-[8vw] h-[8vw] rounded-full flex items-center justify-center" style={{ background: "rgba(79,110,247,0.1)", border: "2px solid rgba(79,110,247,0.3)" }}>
            <span className="font-display font-bold text-primary" style={{ fontSize: "2.5vw" }}>1</span>
          </div>
          <p className="font-body font-semibold text-text mt-[2vh]" style={{ fontSize: "2vw" }}>Input</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>Company name, industry context, specific capability focus areas</p>
          <div className="mt-[2vh] mx-auto rounded-sm p-[1vw]" style={{ background: "rgba(79,110,247,0.05)", border: "1px solid rgba(79,110,247,0.1)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>SEC 10-K filings</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Annual reports</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Earnings calls</p>
          </div>
        </div>
        <div className="flex items-center pt-[4vh]">
          <span className="text-primary font-body" style={{ fontSize: "2vw" }}>→</span>
        </div>
        <div className="flex-1 text-center">
          <div className="mx-auto w-[8vw] h-[8vw] rounded-full flex items-center justify-center" style={{ background: "rgba(245,158,11,0.1)", border: "2px solid rgba(245,158,11,0.3)" }}>
            <span className="font-display font-bold text-hot" style={{ fontSize: "2.5vw" }}>2</span>
          </div>
          <p className="font-body font-semibold text-text mt-[2vh]" style={{ fontSize: "2vw" }}>Questions</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>Agent generates targeted diagnostic questions per capability</p>
          <div className="mt-[2vh] mx-auto rounded-sm p-[1vw]" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.1)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Perplexity research</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Multi-source validation</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Gap identification</p>
          </div>
        </div>
        <div className="flex items-center pt-[4vh]">
          <span className="text-primary font-body" style={{ fontSize: "2vw" }}>→</span>
        </div>
        <div className="flex-1 text-center">
          <div className="mx-auto w-[8vw] h-[8vw] rounded-full flex items-center justify-center" style={{ background: "rgba(59,130,246,0.1)", border: "2px solid rgba(59,130,246,0.3)" }}>
            <span className="font-display font-bold text-emerging" style={{ fontSize: "2.5vw" }}>3</span>
          </div>
          <p className="font-body font-semibold text-text mt-[2vh]" style={{ fontSize: "2vw" }}>Analysis</p>
          <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw" }}>Claude reasoning synthesizes a 12-month capability roadmap</p>
          <div className="mt-[2vh] mx-auto rounded-sm p-[1vw]" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.1)" }}>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Capability scores</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Investment priorities</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Risk assessment</p>
          </div>
        </div>
      </div>
      <div className="absolute bottom-[5vh] left-[6vw] right-[6vw]">
        <div className="w-full h-[0.2vh]" style={{ background: "rgba(79,110,247,0.15)" }} />
        <p className="font-body text-muted mt-[1.5vh]" style={{ fontSize: "1.3vw" }}>Triangulates SEC 10-K data, Perplexity research, and Claude reasoning into actionable intelligence</p>
      </div>
    </div>
  );
}
