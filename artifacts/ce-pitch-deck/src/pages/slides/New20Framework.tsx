export default function New20Framework() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-hot uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Framework</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>The "New 20%"</h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.5vw" }}>Value chain stages x disruption heat x capability clusters</p>
      </div>
      <div className="absolute top-[25vh] left-[6vw] right-[6vw]">
        <div className="flex gap-[0.4vw]">
          <div className="flex-1 rounded-sm p-[1.2vw]" style={{ background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.3)" }}>
            <p className="font-body font-bold text-hot" style={{ fontSize: "1.5vw" }}>Sourcing</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.2vw" }}>Heat: 92</p>
          </div>
          <div className="flex-1 rounded-sm p-[1.2vw]" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <p className="font-body font-bold text-hot" style={{ fontSize: "1.5vw" }}>Processing</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.2vw" }}>Heat: 88</p>
          </div>
          <div className="flex-1 rounded-sm p-[1.2vw]" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)" }}>
            <p className="font-body font-bold text-emerging" style={{ fontSize: "1.5vw" }}>Delivery</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.2vw" }}>Heat: 72</p>
          </div>
          <div className="flex-1 rounded-sm p-[1.2vw]" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <p className="font-body font-bold text-emerging" style={{ fontSize: "1.5vw" }}>Service</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.2vw" }}>Heat: 65</p>
          </div>
          <div className="flex-1 rounded-sm p-[1.2vw]" style={{ background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.15)" }}>
            <p className="font-body font-bold text-cooling" style={{ fontSize: "1.5vw" }}>Support</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.2vw" }}>Heat: 45</p>
          </div>
          <div className="flex-1 rounded-sm p-[1.2vw]" style={{ background: "rgba(148,163,184,0.06)", border: "1px solid rgba(148,163,184,0.1)" }}>
            <p className="font-body font-bold text-stakes" style={{ fontSize: "1.5vw" }}>Admin</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.2vw" }}>Heat: 28</p>
          </div>
        </div>
        <div className="mt-[3vh] flex items-center gap-[2vw]">
          <div className="flex-1 h-[1.2vh] rounded-full" style={{ background: "linear-gradient(90deg, #f59e0b 0%, #f59e0b 35%, #3b82f6 35%, #3b82f6 65%, #64748b 65%, #64748b 85%, #94a3b8 85%)" }} />
        </div>
        <div className="flex justify-between mt-[1vh]">
          <span className="font-body text-hot" style={{ fontSize: "1.2vw" }}>High Disruption</span>
          <span className="font-body text-stakes" style={{ fontSize: "1.2vw" }}>Low Disruption</span>
        </div>
        <div className="mt-[4vh] grid grid-cols-3 gap-[2vw]">
          <div className="rounded-sm p-[1.5vw]" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)" }}>
            <p className="font-display font-bold text-hot" style={{ fontSize: "3vw" }}>20%</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.5vw" }}>of capabilities drive</p>
            <p className="font-body font-semibold text-text" style={{ fontSize: "1.5vw" }}>80% of value creation</p>
          </div>
          <div className="rounded-sm p-[1.5vw]" style={{ background: "rgba(79,110,247,0.06)", border: "1px solid rgba(79,110,247,0.12)" }}>
            <p className="font-display font-bold text-primary" style={{ fontSize: "3vw" }}>3x</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.5vw" }}>return on capability</p>
            <p className="font-body font-semibold text-text" style={{ fontSize: "1.5vw" }}>investment in hot zones</p>
          </div>
          <div className="rounded-sm p-[1.5vw]" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}>
            <p className="font-display font-bold text-emerging" style={{ fontSize: "3vw" }}>6</p>
            <p className="font-body text-text mt-[0.5vh]" style={{ fontSize: "1.5vw" }}>value chain stages</p>
            <p className="font-body font-semibold text-text" style={{ fontSize: "1.5vw" }}>mapped per industry</p>
          </div>
        </div>
      </div>
    </div>
  );
}
