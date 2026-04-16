export default function CompanyXRay() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #0f1018 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Company Profile</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.2vw", marginTop: "1vh" }}>Capability X-Ray</h2>
      </div>
      <div className="absolute top-[5vh] right-[6vw] rounded-sm px-[1.5vw] py-[0.8vh]" style={{ background: "rgba(79,110,247,0.08)", border: "1px solid rgba(79,110,247,0.2)" }}>
        <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Sample: Hypothetical InsureTech Corp</p>
      </div>
      <div className="absolute top-[20vh] left-[4vw] w-[44vw]">
        <svg viewBox="0 0 400 400" className="w-full" style={{ maxHeight: "55vh" }}>
          <polygon points="200,40 340,110 340,250 200,320 60,250 60,110" fill="none" stroke="rgba(107,114,128,0.15)" strokeWidth="1" />
          <polygon points="200,90 310,140 310,230 200,280 90,230 90,140" fill="none" stroke="rgba(107,114,128,0.1)" strokeWidth="1" />
          <polygon points="200,140 280,170 280,210 200,240 120,210 120,170" fill="none" stroke="rgba(107,114,128,0.07)" strokeWidth="1" />
          <polygon points="200,60 320,118 312,242 200,296 82,238 88,122" fill="rgba(79,110,247,0.08)" stroke="#4f6ef7" strokeWidth="1.5" />
          <circle cx="200" cy="60" r="4" fill="#f59e0b" />
          <circle cx="320" cy="118" r="4" fill="#3b82f6" />
          <circle cx="312" cy="242" r="4" fill="#f59e0b" />
          <circle cx="200" cy="296" r="4" fill="#64748b" />
          <circle cx="82" cy="238" r="4" fill="#3b82f6" />
          <circle cx="88" cy="122" r="4" fill="#94a3b8" />
          <text x="200" y="28" textAnchor="middle" fill="#f59e0b" fontFamily="DM Sans" fontSize="11" fontWeight="600">Underwriting (85)</text>
          <text x="360" y="115" textAnchor="start" fill="#3b82f6" fontFamily="DM Sans" fontSize="11" fontWeight="600">Claims (72)</text>
          <text x="350" y="248" textAnchor="start" fill="#f59e0b" fontFamily="DM Sans" fontSize="11" fontWeight="600">Risk Mgmt (82)</text>
          <text x="200" y="338" textAnchor="middle" fill="#64748b" fontFamily="DM Sans" fontSize="11" fontWeight="600">Compliance (48)</text>
          <text x="38" y="248" textAnchor="end" fill="#3b82f6" fontFamily="DM Sans" fontSize="11" fontWeight="600">Digital (68)</text>
          <text x="50" y="115" textAnchor="end" fill="#94a3b8" fontFamily="DM Sans" fontSize="11" fontWeight="600">Ops (42)</text>
        </svg>
      </div>
      <div className="absolute top-[20vh] right-[4vw] w-[42vw]">
        <p className="font-body font-semibold text-text" style={{ fontSize: "1.6vw", marginBottom: "2vh" }}>Quadrant Distribution</p>
        <div className="flex gap-[0.3vw] h-[3vh] rounded-sm overflow-hidden">
          <div className="bg-hot" style={{ width: "30%" }} />
          <div className="bg-emerging" style={{ width: "35%" }} />
          <div className="bg-cooling" style={{ width: "20%" }} />
          <div className="bg-stakes" style={{ width: "15%" }} />
        </div>
        <div className="flex justify-between mt-[1vh]">
          <span className="font-body text-hot" style={{ fontSize: "1.1vw" }}>Hot 30%</span>
          <span className="font-body text-emerging" style={{ fontSize: "1.1vw" }}>Emerging 35%</span>
          <span className="font-body text-cooling" style={{ fontSize: "1.1vw" }}>Cooling 20%</span>
          <span className="font-body text-stakes" style={{ fontSize: "1.1vw" }}>Stakes 15%</span>
        </div>
        <p className="font-body font-semibold text-text mt-[4vh]" style={{ fontSize: "1.6vw", marginBottom: "2vh" }}>Investment Implications</p>
        <div className="flex flex-col gap-[1.5vh]">
          <div className="flex items-start gap-[1vw] rounded-sm p-[1.2vw]" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)" }}>
            <span className="font-body font-bold text-hot" style={{ fontSize: "1.5vw" }}>1</span>
            <p className="font-body text-text" style={{ fontSize: "1.3vw" }}>Underwriting AI is a defensible moat -- strong execution in the hottest quadrant</p>
          </div>
          <div className="flex items-start gap-[1vw] rounded-sm p-[1.2vw]" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}>
            <span className="font-body font-bold text-emerging" style={{ fontSize: "1.5vw" }}>2</span>
            <p className="font-body text-text" style={{ fontSize: "1.3vw" }}>Operations gap at 42/100 is a drag on margins -- candidate for build-vs-buy</p>
          </div>
          <div className="flex items-start gap-[1vw] rounded-sm p-[1.2vw]" style={{ background: "rgba(100,116,139,0.06)", border: "1px solid rgba(100,116,139,0.12)" }}>
            <span className="font-body font-bold text-cooling" style={{ fontSize: "1.5vw" }}>3</span>
            <p className="font-body text-text" style={{ fontSize: "1.3vw" }}>Compliance score (48) is below industry median -- regulatory risk flag</p>
          </div>
        </div>
      </div>
    </div>
  );
}
