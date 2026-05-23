export default function NetworkSlide() {
  const feedColumns = [
    {
      label: "Connections",
      color: "#3b82f6",
      items: [
        "Sarah K. · CFO, FinTech II — followed Healthcare",
        "Marc L. · VC partner — published \"AI ops moat\"",
        "Priya R. · CTO, ClaimsCo — joined 3 forums",
      ],
    },
    {
      label: "Activity feed",
      color: "#8b5cf6",
      items: [
        "Anya posted: \"Retail's σ jumped 0.18 this week\"",
        "@regulatory-shifts trending in Banking",
        "Carlos replied to your thread on EVaR",
        "New disruption alert in Health Payers",
      ],
    },
    {
      label: "Suggestions",
      color: "#f59e0b",
      items: [
        "Connect with 4 analysts in your industry",
        "Forum: \"Claims automation 2026\" (12 active)",
        "DM Priya — both watching ClaimsCo capability",
      ],
    },
  ];

  const primitives = [
    { label: "Member microsites", desc: "Profile + activity + capabilities followed" },
    { label: "Direct messages", desc: "1:1 + group threads attributed to Clerk org" },
    { label: "Per-industry forums", desc: "Discussion threads scoped to an industry" },
    { label: "Hashtags + mentions", desc: "@user + #topic notifications" },
  ];

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a1628 0%, #0f1f3a 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Network &amp; community</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh", lineHeight: 1.05 }}>
          Capability intelligence is more useful with the people who own it.
        </h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw", maxWidth: "70vw" }}>
          A LinkedIn-style member graph layered on top of CVI &mdash; profiles, DMs, forums, and a three-column
          feed of who's signaling what across the industries you watch.
        </p>
      </div>

      {/* Three-column feed mockup */}
      <div className="absolute" style={{ top: "26vh", left: "6vw", right: "6vw" }}>
        <p className="font-body font-medium text-primary uppercase tracking-widest mb-[2vh]" style={{ fontSize: "0.95vw" }}>The feed</p>
        <div className="grid grid-cols-3 gap-[1.5vw]">
          {feedColumns.map(col => (
            <div key={col.label} className="rounded-sm" style={{ border: `1px solid ${col.color}40`, background: `${col.color}08`, minHeight: "32vh" }}>
              <div className="px-[1vw] py-[1.2vh] border-b" style={{ borderColor: `${col.color}30` }}>
                <div className="flex items-center gap-[0.6vw]">
                  <div className="rounded-full" style={{ width: "0.7vw", height: "0.7vw", background: col.color }} />
                  <span className="font-body font-bold tracking-widest" style={{ color: col.color, fontSize: "1vw" }}>{col.label.toUpperCase()}</span>
                </div>
              </div>
              <div className="p-[0.8vw] space-y-[0.8vh]">
                {col.items.map((item, i) => (
                  <div key={i} className="px-[0.8vw] py-[0.9vh] rounded-sm" style={{ background: "rgba(232,234,240,0.04)", border: "1px solid rgba(232,234,240,0.1)" }}>
                    <span className="font-body text-text" style={{ fontSize: "0.9vw", lineHeight: 1.35 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Primitives strip */}
      <div className="absolute" style={{ bottom: "5vh", left: "6vw", right: "6vw" }}>
        <p className="font-body font-medium text-primary uppercase tracking-widest mb-[1vh]" style={{ fontSize: "0.95vw" }}>Network primitives</p>
        <div className="grid grid-cols-4 gap-[1.2vw]">
          {primitives.map((p, i) => (
            <div key={i} className="px-[1vw] py-[1.2vh] rounded-sm" style={{ background: "rgba(79,110,247,0.06)", border: "1px solid rgba(79,110,247,0.25)" }}>
              <p className="font-display font-bold text-text" style={{ fontSize: "1.05vw", lineHeight: 1.2 }}>{p.label}</p>
              <p className="font-body text-muted mt-[0.5vh]" style={{ fontSize: "0.85vw", lineHeight: 1.35 }}>{p.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-[1vh] right-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "0.95vw" }}>Member profiles &middot; DMs &middot; forums per industry &middot; mention notifications</p>
      </div>
    </div>
  );
}
