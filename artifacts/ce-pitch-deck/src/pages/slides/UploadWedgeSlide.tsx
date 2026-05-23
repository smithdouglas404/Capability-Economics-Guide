export default function UploadWedgeSlide() {
  const stages = [
    {
      x: 6,
      label: "DROP",
      color: "#3b82f6",
      title: "Drag your doc",
      detail: "10-K, board deck, S-1, pitch memo, customer-call transcript. PDF or DOCX, any size.",
    },
    {
      x: 30,
      label: "EXTRACT",
      color: "#8b5cf6",
      title: "Capabilities surfaced",
      detail: "Claude reads the doc, pulls every capability mentioned, scores each against the CVI graph.",
    },
    {
      x: 54,
      label: "MATCH",
      color: "#10b981",
      title: "Industry + peer set",
      detail: "Capability fingerprint matched to industries + closest peers; gaps highlighted automatically.",
    },
    {
      x: 78,
      label: "REPORT",
      color: "#f59e0b",
      title: "Streams in front of you",
      detail: "Vercel AI SDK streams a diligence-grade report sentence-by-sentence. Cite, export, share.",
    },
  ];

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a1628 0%, #0f1f3a 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>The wedge</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh", lineHeight: 1.05 }}>
          Drag a doc in &mdash; the report writes itself.
        </h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw", maxWidth: "75vw" }}>
          The fastest path from cold prospect to diligence-grade output. Zero forms,
          zero setup &mdash; a single drag-and-drop turns any document into a capability-indexed report.
        </p>
      </div>

      {/* Four-stage pipeline */}
      <div className="absolute" style={{ top: "30vh", left: "5vw", right: "5vw" }}>
        <div className="grid grid-cols-4 gap-[1.5vw]">
          {stages.map(s => (
            <div key={s.label} className="rounded-sm relative" style={{ border: `1px solid ${s.color}40`, background: `${s.color}08`, padding: "2.5vh 1.5vw", minHeight: "30vh" }}>
              <div className="flex items-center gap-[0.6vw] mb-[1.5vh]">
                <div className="rounded-full flex items-center justify-center font-display font-bold text-text" style={{ width: "2vw", height: "2vw", background: s.color, fontSize: "1.1vw" }}>
                  {stages.indexOf(s) + 1}
                </div>
                <span className="font-body font-bold tracking-widest" style={{ color: s.color, fontSize: "1vw" }}>{s.label}</span>
              </div>
              <p className="font-display font-bold text-text" style={{ fontSize: "1.4vw", lineHeight: 1.2, marginBottom: "1vh" }}>{s.title}</p>
              <p className="font-body text-muted" style={{ fontSize: "0.9vw", lineHeight: 1.45 }}>{s.detail}</p>
            </div>
          ))}
        </div>

        {/* Connecting arrows */}
        <div className="relative" style={{ height: "0" }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="absolute font-display text-muted" style={{ top: "-18vh", left: `calc(${(i + 1) * 25}% - 0.6vw)`, fontSize: "1.5vw" }}>→</div>
          ))}
        </div>
      </div>

      {/* Why-it-matters callout */}
      <div className="absolute" style={{ bottom: "8vh", left: "6vw", right: "6vw" }}>
        <div className="grid grid-cols-3 gap-[1.5vw]">
          <div className="px-[1.5vw] py-[1.5vh] rounded-sm" style={{ background: "rgba(79,110,247,0.06)", border: "1px solid rgba(79,110,247,0.25)" }}>
            <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "0.8vw" }}>Time to first report</p>
            <p className="font-display font-bold text-text mt-[0.5vh]" style={{ fontSize: "1.6vw" }}>&lt; 90 seconds</p>
          </div>
          <div className="px-[1.5vw] py-[1.5vh] rounded-sm" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <p className="font-body font-medium uppercase tracking-widest" style={{ fontSize: "0.8vw", color: "#10b981" }}>Streaming UX</p>
            <p className="font-display font-bold text-text mt-[0.5vh]" style={{ fontSize: "1.6vw" }}>Vercel AI SDK</p>
          </div>
          <div className="px-[1.5vw] py-[1.5vh] rounded-sm" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <p className="font-body font-medium uppercase tracking-widest" style={{ fontSize: "0.8vw", color: "#f59e0b" }}>Conversion lever</p>
            <p className="font-display font-bold text-text mt-[0.5vh]" style={{ fontSize: "1.6vw" }}>Try-before-signup</p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[1vh] right-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "0.95vw" }}>One drop &middot; capability extraction &middot; matched report streams live</p>
      </div>
    </div>
  );
}
