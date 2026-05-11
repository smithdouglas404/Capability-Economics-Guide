export default function WorkbenchSlide() {
  const lanes = [
    { x: 6, label: "SCAN", color: "#3b82f6", desc: "Observing", cards: ["Agentic AI orchestration", "Real-time fraud detection", "Vector retrieval"] },
    { x: 24, label: "FRAME", color: "#8b5cf6", desc: "Markets", cards: ["Healthcare claims gap", "HIPAA LLM substrate"] },
    { x: 42, label: "IDEATE", color: "#f59e0b", desc: "Concepts", cards: ["Patient claims agent", "EHR coding copilot"] },
    { x: 60, label: "VALIDATE", color: "#10b981", desc: "Evidence", cards: ["Claims pilot · 47 users"] },
    { x: 78, label: "LAUNCH", color: "#ef4444", desc: "Committed", cards: [] },
  ];

  const actions = [
    { label: "10 unexpected applications", x: 6 },
    { label: "Cross-industry analogues", x: 24 },
    { label: "Critique my idea", x: 42 },
    { label: "What to invent (Uber pattern)", x: 60 },
    { label: "Leading or declining?", x: 78 },
  ];

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Ideation engine</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh", lineHeight: 1.05 }}>
          The Capability Workbench
        </h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw", maxWidth: "70vw" }}>
          Drag capabilities through a Double-Diamond pipeline. Claude critiques every card with five
          stable prompt kinds — outputs cached so refresh never re-bills.
        </p>
      </div>

      {/* Kanban diagram */}
      <div className="absolute" style={{ top: "26vh", left: "5vw", right: "5vw" }}>
        <div className="grid grid-cols-5 gap-[1.2vw]">
          {lanes.map(lane => (
            <div key={lane.label} className="rounded-sm" style={{ border: `1px solid ${lane.color}40`, background: `${lane.color}08`, minHeight: "32vh" }}>
              <div className="px-[1vw] py-[1.2vh] border-b" style={{ borderColor: `${lane.color}30` }}>
                <div className="flex items-center gap-[0.6vw]">
                  <div className="rounded-full" style={{ width: "0.7vw", height: "0.7vw", background: lane.color }} />
                  <span className="font-body font-bold tracking-widest" style={{ color: lane.color, fontSize: "1vw" }}>{lane.label}</span>
                </div>
                <p className="font-body text-muted" style={{ fontSize: "0.8vw", marginTop: "0.4vh", letterSpacing: "0.1em" }}>{lane.desc.toUpperCase()}</p>
              </div>
              <div className="p-[0.6vw] space-y-[0.6vh]">
                {lane.cards.length === 0 ? (
                  <p className="font-body italic text-center text-muted" style={{ fontSize: "0.9vw", marginTop: "8vh" }}>—</p>
                ) : (
                  lane.cards.map((c, i) => (
                    <div key={i} className="px-[0.8vw] py-[0.8vh] rounded-sm" style={{ background: "rgba(232,234,240,0.04)", border: "1px solid rgba(232,234,240,0.1)" }}>
                      <span className="font-body text-text" style={{ fontSize: "0.95vw", lineHeight: 1.2 }}>{c}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Claude actions callout strip */}
      <div className="absolute" style={{ bottom: "5vh", left: "5vw", right: "5vw" }}>
        <p className="font-body font-medium text-primary uppercase tracking-widest mb-[1vh]" style={{ fontSize: "0.95vw" }}>Per-card Claude actions</p>
        <div className="grid grid-cols-5 gap-[1.2vw]">
          {actions.map((a, i) => (
            <div key={i} className="px-[1vw] py-[1vh] rounded-sm" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)" }}>
              <div className="font-body font-medium text-text" style={{ fontSize: "0.95vw", lineHeight: 1.25 }}>{a.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-[1vh] right-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "0.95vw" }}>Personal boards · team-shared via Clerk org · insights persist to DB</p>
      </div>
    </div>
  );
}
