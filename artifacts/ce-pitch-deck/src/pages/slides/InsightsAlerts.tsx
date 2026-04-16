export default function InsightsAlerts() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Insights &amp; Alerts</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>Agent Radar</h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.5vw" }}>Surfacing signals before they become consensus</p>
      </div>
      <div className="absolute top-[24vh] left-[6vw] right-[6vw]">
        <div className="flex items-end gap-[0.5vw]" style={{ height: "55vh" }}>
          <div className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full rounded-t-sm" style={{ height: "15%", background: "rgba(148,163,184,0.15)", border: "1px solid rgba(148,163,184,0.2)", borderBottom: "none" }} />
            <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.1vw" }}>Q1</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full rounded-t-sm" style={{ height: "25%", background: "rgba(148,163,184,0.2)", border: "1px solid rgba(148,163,184,0.25)", borderBottom: "none" }} />
            <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.1vw" }}>Q2</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-end h-full relative">
            <div className="absolute top-[10%] left-1/2 -translate-x-1/2 rounded-sm px-[0.8vw] py-[0.4vh]" style={{ background: "rgba(79,110,247,0.15)", border: "1px solid rgba(79,110,247,0.3)" }}>
              <p className="font-body font-semibold text-primary whitespace-nowrap" style={{ fontSize: "1vw" }}>CE detects signal</p>
            </div>
            <div className="w-full rounded-t-sm" style={{ height: "40%", background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.2)", borderBottom: "none" }} />
            <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.1vw" }}>Q3</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full rounded-t-sm" style={{ height: "55%", background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.25)", borderBottom: "none" }} />
            <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.1vw" }}>Q4</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full rounded-t-sm" style={{ height: "70%", background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.25)", borderBottom: "none" }} />
            <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.1vw" }}>Q5</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-end h-full relative">
            <div className="absolute top-[5%] left-1/2 -translate-x-1/2 rounded-sm px-[0.8vw] py-[0.4vh]" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <p className="font-body font-semibold text-hot whitespace-nowrap" style={{ fontSize: "1vw" }}>Market consensus</p>
            </div>
            <div className="w-full rounded-t-sm" style={{ height: "85%", background: "rgba(245,158,11,0.25)", border: "1px solid rgba(245,158,11,0.3)", borderBottom: "none" }} />
            <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.1vw" }}>Q6</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full rounded-t-sm" style={{ height: "90%", background: "rgba(245,158,11,0.3)", border: "1px solid rgba(245,158,11,0.35)", borderBottom: "none" }} />
            <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.1vw" }}>Q7</p>
          </div>
        </div>
        <div className="w-full h-[0.2vh]" style={{ background: "rgba(107,114,128,0.3)" }} />
      </div>
      <div className="absolute bottom-[4vh] left-[6vw] right-[6vw] flex justify-between items-center">
        <p className="font-body text-muted" style={{ fontSize: "1.3vw" }}>3-quarter early detection advantage over traditional analysis</p>
        <div className="flex gap-[2vw]">
          <div className="flex items-center gap-[0.5vw]">
            <div className="w-[1.5vw] h-[0.6vh] rounded bg-primary" />
            <span className="font-body text-muted" style={{ fontSize: "1.1vw" }}>CE Detection</span>
          </div>
          <div className="flex items-center gap-[0.5vw]">
            <div className="w-[1.5vw] h-[0.6vh] rounded bg-hot" />
            <span className="font-body text-muted" style={{ fontSize: "1.1vw" }}>Market Consensus</span>
          </div>
        </div>
      </div>
    </div>
  );
}
