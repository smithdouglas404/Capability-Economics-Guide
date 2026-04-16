export default function CEIQuadrant() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>CEI Index</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.2vw", marginTop: "1vh" }}>Quadrant xRay</h2>
      </div>
      <div className="absolute top-[4vh] right-[6vw] flex gap-[1.5vw]">
        <div className="flex items-center gap-[0.5vw]">
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-hot" />
          <span className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Hot</span>
        </div>
        <div className="flex items-center gap-[0.5vw]">
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-emerging" />
          <span className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Emerging</span>
        </div>
        <div className="flex items-center gap-[0.5vw]">
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-cooling" />
          <span className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Cooling</span>
        </div>
        <div className="flex items-center gap-[0.5vw]">
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-stakes" />
          <span className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Table Stakes</span>
        </div>
      </div>
      <svg className="absolute" style={{ top: "18vh", left: "8vw", width: "84vw", height: "76vh" }} viewBox="0 0 840 600">
        <defs>
          <linearGradient id="qBg1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="rgba(245,158,11,0.04)" /><stop offset="1" stopColor="rgba(245,158,11,0.01)" /></linearGradient>
          <linearGradient id="qBg2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="rgba(59,130,246,0.01)" /><stop offset="1" stopColor="rgba(59,130,246,0.04)" /></linearGradient>
        </defs>
        <rect x="420" y="0" width="420" height="300" fill="url(#qBg1)" />
        <rect x="0" y="0" width="420" height="300" fill="url(#qBg2)" />
        <line x1="420" y1="0" x2="420" y2="580" stroke="rgba(107,114,128,0.2)" strokeWidth="1" strokeDasharray="4,4" />
        <line x1="0" y1="300" x2="840" y2="300" stroke="rgba(107,114,128,0.2)" strokeWidth="1" strokeDasharray="4,4" />
        <text x="210" y="25" textAnchor="middle" fill="rgba(107,114,128,0.5)" fontFamily="DM Sans" fontSize="12" fontWeight="600">EMERGING</text>
        <text x="630" y="25" textAnchor="middle" fill="rgba(107,114,128,0.5)" fontFamily="DM Sans" fontSize="12" fontWeight="600">HOT</text>
        <text x="210" y="580" textAnchor="middle" fill="rgba(107,114,128,0.5)" fontFamily="DM Sans" fontSize="12" fontWeight="600">TABLE STAKES</text>
        <text x="630" y="580" textAnchor="middle" fill="rgba(107,114,128,0.5)" fontFamily="DM Sans" fontSize="12" fontWeight="600">COOLING</text>
        <text x="420" y="598" textAnchor="middle" fill="rgba(107,114,128,0.4)" fontFamily="DM Sans" fontSize="11">Economic Impact Score →</text>
        <text x="12" y="300" fill="rgba(107,114,128,0.4)" fontFamily="DM Sans" fontSize="11" transform="rotate(-90,12,300)">Adoption Momentum →</text>
        <circle cx="620" cy="80" r="28" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth="1.5" />
        <text x="620" y="76" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontSize="9" fontWeight="600">AI</text>
        <text x="620" y="88" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontSize="8">Underwriting</text>
        <circle cx="700" cy="140" r="22" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth="1.5" />
        <text x="700" y="137" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontSize="8" fontWeight="600">Predictive</text>
        <text x="700" y="148" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontSize="7">Analytics</text>
        <circle cx="540" cy="120" r="20" fill="rgba(245,158,11,0.1)" stroke="#f59e0b" strokeWidth="1.5" />
        <text x="540" y="122" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontSize="8" fontWeight="600">Claims AI</text>
        <circle cx="250" cy="100" r="24" fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth="1.5" />
        <text x="250" y="97" textAnchor="middle" fill="#3b82f6" fontFamily="DM Sans" fontSize="8" fontWeight="600">Digital</text>
        <text x="250" y="108" textAnchor="middle" fill="#3b82f6" fontFamily="DM Sans" fontSize="7">Twins</text>
        <circle cx="320" cy="180" r="18" fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeWidth="1.5" />
        <text x="320" y="182" textAnchor="middle" fill="#3b82f6" fontFamily="DM Sans" fontSize="8" fontWeight="600">IoT Sensing</text>
        <circle cx="160" cy="200" r="16" fill="rgba(59,130,246,0.08)" stroke="#3b82f6" strokeWidth="1.5" />
        <text x="160" y="202" textAnchor="middle" fill="#3b82f6" fontFamily="DM Sans" fontSize="7" fontWeight="600">GenAI Ops</text>
        <circle cx="600" cy="380" r="24" fill="rgba(100,116,139,0.1)" stroke="#64748b" strokeWidth="1.5" />
        <text x="600" y="377" textAnchor="middle" fill="#64748b" fontFamily="DM Sans" fontSize="8" fontWeight="600">Legacy</text>
        <text x="600" y="388" textAnchor="middle" fill="#64748b" fontFamily="DM Sans" fontSize="7">ERP</text>
        <circle cx="700" cy="440" r="18" fill="rgba(100,116,139,0.08)" stroke="#64748b" strokeWidth="1.5" />
        <text x="700" y="442" textAnchor="middle" fill="#64748b" fontFamily="DM Sans" fontSize="8" fontWeight="600">Batch Proc</text>
        <circle cx="200" cy="420" r="26" fill="rgba(148,163,184,0.08)" stroke="#94a3b8" strokeWidth="1.5" />
        <text x="200" y="417" textAnchor="middle" fill="#94a3b8" fontFamily="DM Sans" fontSize="8" fontWeight="600">Core</text>
        <text x="200" y="428" textAnchor="middle" fill="#94a3b8" fontFamily="DM Sans" fontSize="7">Banking</text>
        <circle cx="300" cy="480" r="20" fill="rgba(148,163,184,0.06)" stroke="#94a3b8" strokeWidth="1.5" />
        <text x="300" y="482" textAnchor="middle" fill="#94a3b8" fontFamily="DM Sans" fontSize="8" fontWeight="600">Compliance</text>
        <circle cx="130" cy="500" r="16" fill="rgba(148,163,184,0.05)" stroke="#94a3b8" strokeWidth="1.5" />
        <text x="130" y="502" textAnchor="middle" fill="#94a3b8" fontFamily="DM Sans" fontSize="7" fontWeight="600">Call Center</text>
      </svg>
    </div>
  );
}
