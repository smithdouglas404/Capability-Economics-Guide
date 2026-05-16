export default function PlatformOverview() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[6vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Architecture</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh" }}>Five Interconnected Modules</h2>
      </div>
      <svg className="absolute" style={{ top: "22vh", left: "5vw", width: "90vw", height: "72vh" }} viewBox="0 0 900 500" fill="none">
        <line x1="450" y1="120" x2="200" y2="280" stroke="rgba(79,110,247,0.3)" strokeWidth="1.5" strokeDasharray="6,4" />
        <line x1="450" y1="120" x2="700" y2="280" stroke="rgba(79,110,247,0.3)" strokeWidth="1.5" strokeDasharray="6,4" />
        <line x1="200" y1="280" x2="320" y2="430" stroke="rgba(79,110,247,0.3)" strokeWidth="1.5" strokeDasharray="6,4" />
        <line x1="700" y1="280" x2="580" y2="430" stroke="rgba(79,110,247,0.3)" strokeWidth="1.5" strokeDasharray="6,4" />
        <line x1="200" y1="280" x2="700" y2="280" stroke="rgba(79,110,247,0.15)" strokeWidth="1" strokeDasharray="4,4" />
        <line x1="320" y1="430" x2="580" y2="430" stroke="rgba(79,110,247,0.15)" strokeWidth="1" strokeDasharray="4,4" />
        <circle cx="450" cy="110" r="55" fill="rgba(79,110,247,0.1)" stroke="rgba(79,110,247,0.4)" strokeWidth="2" />
        <text x="450" y="105" textAnchor="middle" fill="#4f6ef7" fontFamily="DM Sans" fontWeight="700" fontSize="14">CVI</text>
        <text x="450" y="122" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontWeight="500" fontSize="11">Index</text>
        <circle cx="200" cy="280" r="55" fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.35)" strokeWidth="2" />
        <text x="200" y="273" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontWeight="700" fontSize="13">Knowledge</text>
        <text x="200" y="292" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontWeight="500" fontSize="11">Graph</text>
        <circle cx="700" cy="280" r="55" fill="rgba(59,130,246,0.08)" stroke="rgba(59,130,246,0.35)" strokeWidth="2" />
        <text x="700" y="273" textAnchor="middle" fill="#3b82f6" fontFamily="DM Sans" fontWeight="700" fontSize="13">Capability</text>
        <text x="700" y="292" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontWeight="500" fontSize="11">Assessment</text>
        <circle cx="320" cy="430" r="55" fill="rgba(99,102,241,0.08)" stroke="rgba(99,102,241,0.35)" strokeWidth="2" />
        <text x="320" y="423" textAnchor="middle" fill="#6366f1" fontFamily="DM Sans" fontWeight="700" fontSize="13">C-Suite</text>
        <text x="320" y="442" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontWeight="500" fontSize="11">Intelligence</text>
        <circle cx="580" cy="430" r="55" fill="rgba(100,116,139,0.1)" stroke="rgba(100,116,139,0.35)" strokeWidth="2" />
        <text x="580" y="423" textAnchor="middle" fill="#94a3b8" fontFamily="DM Sans" fontWeight="700" fontSize="13">Insights</text>
        <text x="580" y="442" textAnchor="middle" fill="#e8eaf0" fontFamily="DM Sans" fontWeight="500" fontSize="11">&amp; Alerts</text>
      </svg>
      <div className="absolute bottom-[4vh] right-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "1.3vw" }}>All modules share a unified capability ontology and research memory layer</p>
      </div>
    </div>
  );
}
