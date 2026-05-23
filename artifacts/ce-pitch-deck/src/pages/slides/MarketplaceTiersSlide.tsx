export default function MarketplaceTiersSlide() {
  const tiers = [
    { name: "Open", desc: "Anyone with Stripe Connect onboarded", takeRate: "20%", color: "#64748b", note: "Auto-approved" },
    { name: "Verified Analyst", desc: "Admin-vetted consultants & researchers", takeRate: "15%", color: "#3b82f6", note: "Badge + lower fees" },
    { name: "Featured Author", desc: "Curated showcase tier", takeRate: "12%", color: "#f59e0b", note: "Top placement + amber ring" },
  ];

  const listingTypes = ["Reports (PDF, watermarked)", "Datasets (CSV / Parquet)", "Templates (analysis frameworks)", "Services (consulting hours)"];

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: "linear-gradient(180deg, #0a1628 0%, #0f1f3a 100%)" }}>
      <div className="absolute top-[5vh] left-[6vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.3vw" }}>Marketplace + multi-tenant</p>
        <h2 className="font-display font-bold text-text tracking-tight" style={{ fontSize: "3.5vw", marginTop: "1vh", lineHeight: 1.05 }}>
          Revenue mechanism on top of the moat.
        </h2>
        <p className="font-body text-muted mt-[1vh]" style={{ fontSize: "1.4vw", maxWidth: "70vw" }}>
          CVI data is the platform's moat. The marketplace is how third-party analysts <em>build on it</em> and
          how the platform earns recurring revenue without owning every research artifact.
        </p>
      </div>

      {/* Three-tier seller diagram */}
      <div className="absolute" style={{ top: "26vh", left: "6vw", right: "6vw" }}>
        <p className="font-body font-medium text-primary uppercase tracking-widest mb-[2vh]" style={{ fontSize: "0.95vw" }}>Three seller tiers</p>
        <div className="grid grid-cols-3 gap-[2vw]">
          {tiers.map(t => (
            <div key={t.name} className="rounded-sm" style={{ border: `1px solid ${t.color}40`, background: `${t.color}08`, padding: "2.5vh 1.8vw" }}>
              <div className="flex items-center gap-[0.6vw] mb-[1vh]">
                <div className="rounded-full" style={{ width: "0.8vw", height: "0.8vw", background: t.color }} />
                <p className="font-display font-bold text-text" style={{ fontSize: "1.6vw" }}>{t.name}</p>
              </div>
              <p className="font-body text-muted" style={{ fontSize: "1vw", marginBottom: "1.5vh", lineHeight: 1.4 }}>{t.desc}</p>
              <div className="flex items-baseline justify-between" style={{ paddingTop: "1.5vh", borderTop: "1px solid rgba(232,234,240,0.08)" }}>
                <span className="font-body text-muted uppercase tracking-widest" style={{ fontSize: "0.75vw" }}>Take rate</span>
                <span className="font-display font-bold" style={{ color: t.color, fontSize: "2vw" }}>{t.takeRate}</span>
              </div>
              <p className="font-body text-text mt-[1vh]" style={{ fontSize: "0.85vw", letterSpacing: "0.05em" }}>{t.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-tenant + listing types row */}
      <div className="absolute" style={{ bottom: "10vh", left: "6vw", right: "6vw" }}>
        <div className="grid grid-cols-2 gap-[3vw]">
          <div className="rounded-sm" style={{ background: "rgba(79,110,247,0.05)", border: "1px solid rgba(79,110,247,0.25)", padding: "2.5vh 2vw" }}>
            <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "0.85vw" }}>Multi-tenant workspace</p>
            <p className="font-display font-bold text-text mt-[0.8vh]" style={{ fontSize: "1.5vw", lineHeight: 1.25 }}>
              Purchases attributed to your Clerk org.
            </p>
            <p className="font-body text-text mt-[1.2vh]" style={{ fontSize: "1vw", lineHeight: 1.5 }}>
              When a buyer purchases on behalf of a team, every Clerk-org member sees the file in their library, watermarked with
              the downloading user's identity. SaaS-only — on-prem deployments fall back to per-user.
            </p>
          </div>
          <div className="rounded-sm" style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.25)", padding: "2.5vh 2vw" }}>
            <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "0.85vw", color: "#f59e0b" }}>Listing types</p>
            <ul className="mt-[1.2vh] space-y-[0.8vh]">
              {listingTypes.map((l, i) => (
                <li key={i} className="font-body text-text flex items-start gap-[0.5vw]" style={{ fontSize: "1vw", lineHeight: 1.4 }}>
                  <span style={{ color: "#f59e0b" }}>▸</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[3vh] right-[6vw]">
        <p className="font-body text-muted" style={{ fontSize: "0.95vw" }}>Stripe Connect destination charges · KYC via Didit · auto-archive at 30d post-approval</p>
      </div>
    </div>
  );
}
