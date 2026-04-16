export default function KnowledgeGraphSlide() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw] max-w-[40vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Knowledge Graph</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.2vw", marginTop: "1vh" }}>Spider Network</h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.5vw" }}>Capabilities cluster by affinity, not by industry label</p>
      </div>
      <svg className="absolute" style={{ top: "12vh", left: "20vw", width: "72vw", height: "82vh" }} viewBox="0 0 720 600">
        <line x1="360" y1="160" x2="180" y2="100" stroke="rgba(79,110,247,0.25)" strokeWidth="1" />
        <line x1="360" y1="160" x2="540" y2="100" stroke="rgba(79,110,247,0.25)" strokeWidth="1" />
        <line x1="360" y1="160" x2="160" y2="320" stroke="rgba(79,110,247,0.25)" strokeWidth="1" />
        <line x1="360" y1="160" x2="560" y2="320" stroke="rgba(79,110,247,0.25)" strokeWidth="1" />
        <line x1="360" y1="160" x2="360" y2="480" stroke="rgba(79,110,247,0.25)" strokeWidth="1" />
        <line x1="180" y1="100" x2="120" y2="50" stroke="rgba(245,158,11,0.2)" strokeWidth="1" />
        <line x1="180" y1="100" x2="80" y2="140" stroke="rgba(245,158,11,0.2)" strokeWidth="1" />
        <line x1="180" y1="100" x2="220" y2="40" stroke="rgba(59,130,246,0.2)" strokeWidth="1" />
        <line x1="540" y1="100" x2="600" y2="40" stroke="rgba(245,158,11,0.2)" strokeWidth="1" />
        <line x1="540" y1="100" x2="640" y2="140" stroke="rgba(100,116,139,0.2)" strokeWidth="1" />
        <line x1="540" y1="100" x2="490" y2="40" stroke="rgba(59,130,246,0.2)" strokeWidth="1" />
        <line x1="160" y1="320" x2="80" y2="280" stroke="rgba(59,130,246,0.2)" strokeWidth="1" />
        <line x1="160" y1="320" x2="100" y2="400" stroke="rgba(148,163,184,0.2)" strokeWidth="1" />
        <line x1="160" y1="320" x2="220" y2="380" stroke="rgba(245,158,11,0.2)" strokeWidth="1" />
        <line x1="560" y1="320" x2="640" y2="280" stroke="rgba(100,116,139,0.2)" strokeWidth="1" />
        <line x1="560" y1="320" x2="620" y2="400" stroke="rgba(245,158,11,0.2)" strokeWidth="1" />
        <line x1="560" y1="320" x2="500" y2="380" stroke="rgba(59,130,246,0.2)" strokeWidth="1" />
        <line x1="360" y1="480" x2="300" y2="530" stroke="rgba(148,163,184,0.2)" strokeWidth="1" />
        <line x1="360" y1="480" x2="420" y2="530" stroke="rgba(100,116,139,0.2)" strokeWidth="1" />
        <line x1="360" y1="480" x2="280" y2="460" stroke="rgba(59,130,246,0.2)" strokeWidth="1" />
        <line x1="120" y1="50" x2="220" y2="40" stroke="rgba(245,158,11,0.12)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="600" y1="40" x2="640" y2="140" stroke="rgba(100,116,139,0.12)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="220" y1="380" x2="100" y2="400" stroke="rgba(148,163,184,0.12)" strokeWidth="1" strokeDasharray="3,3" />
        <circle cx="360" cy="160" r="30" fill="rgba(79,110,247,0.15)" stroke="#4f6ef7" strokeWidth="2" />
        <text x="360" y="155" textAnchor="middle" fill="#4f6ef7" fontFamily="DM Sans" fontWeight="700" fontSize="10">Insurance</text>
        <text x="360" y="168" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontSize="8">Hub</text>
        <circle cx="180" cy="100" r="26" fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="2" />
        <text x="180" y="97" textAnchor="middle" fill="#3b82f6" fontFamily="DM Sans" fontWeight="700" fontSize="9">Healthcare</text>
        <text x="180" y="108" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontSize="8">Hub</text>
        <circle cx="540" cy="100" r="26" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth="2" />
        <text x="540" y="97" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontWeight="700" fontSize="9">Banking</text>
        <text x="540" y="108" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontSize="8">Hub</text>
        <circle cx="160" cy="320" r="24" fill="rgba(100,116,139,0.12)" stroke="#64748b" strokeWidth="2" />
        <text x="160" y="317" textAnchor="middle" fill="#94a3b8" fontFamily="DM Sans" fontWeight="700" fontSize="9">Mfg</text>
        <text x="160" y="328" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontSize="8">Hub</text>
        <circle cx="560" cy="320" r="24" fill="rgba(99,102,241,0.12)" stroke="#6366f1" strokeWidth="2" />
        <text x="560" y="317" textAnchor="middle" fill="#6366f1" fontFamily="DM Sans" fontWeight="700" fontSize="9">Tech</text>
        <text x="560" y="328" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontSize="8">Hub</text>
        <circle cx="360" cy="480" r="22" fill="rgba(148,163,184,0.1)" stroke="#94a3b8" strokeWidth="2" />
        <text x="360" y="477" textAnchor="middle" fill="#94a3b8" fontFamily="DM Sans" fontWeight="700" fontSize="9">Retail</text>
        <text x="360" y="488" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontSize="8">Hub</text>
        <circle cx="120" cy="50" r="12" fill="rgba(245,158,11,0.2)" stroke="#f59e0b" strokeWidth="1" />
        <circle cx="80" cy="140" r="10" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth="1" />
        <circle cx="220" cy="40" r="14" fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth="1" />
        <circle cx="600" cy="40" r="13" fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth="1" />
        <circle cx="640" cy="140" r="11" fill="rgba(100,116,139,0.15)" stroke="#64748b" strokeWidth="1" />
        <circle cx="490" cy="40" r="10" fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1" />
        <circle cx="80" cy="280" r="11" fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1" />
        <circle cx="100" cy="400" r="10" fill="rgba(148,163,184,0.1)" stroke="#94a3b8" strokeWidth="1" />
        <circle cx="220" cy="380" r="13" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth="1" />
        <circle cx="640" cy="280" r="10" fill="rgba(100,116,139,0.12)" stroke="#64748b" strokeWidth="1" />
        <circle cx="620" cy="400" r="12" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth="1" />
        <circle cx="500" cy="380" r="11" fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1" />
        <circle cx="300" cy="530" r="10" fill="rgba(148,163,184,0.1)" stroke="#94a3b8" strokeWidth="1" />
        <circle cx="420" cy="530" r="11" fill="rgba(100,116,139,0.12)" stroke="#64748b" strokeWidth="1" />
        <circle cx="280" cy="460" r="9" fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeWidth="1" />
      </svg>
      <div className="absolute bottom-[5vh] left-[6vw]">
        <p className="font-body text-muted italic" style={{ fontSize: "1.4vw" }}>"Birds of a feather" -- capabilities that co-evolve cluster together across industry boundaries</p>
      </div>
    </div>
  );
}
