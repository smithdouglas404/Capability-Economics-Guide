const base = import.meta.env.BASE_URL;

export default function Cover() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <img
        src={`${base}hero-bg.png`}
        crossOrigin="anonymous"
        alt="Abstract data network"
        className="absolute inset-0 w-full h-full object-cover opacity-40"
      />
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(10,10,15,0.85) 0%, rgba(10,10,15,0.5) 50%, rgba(10,10,15,0.85) 100%)" }} />
      <div className="absolute top-[6vh] left-[6vw] flex items-center gap-[1vw]">
        <div className="w-[2.8vw] h-[2.8vw] rounded-sm flex items-center justify-center" style={{ background: "linear-gradient(135deg, #4f6ef7, #6366f1)" }}>
          <span className="font-display font-bold text-white" style={{ fontSize: "1.4vw" }}>CE</span>
        </div>
        <span className="font-body font-medium text-text" style={{ fontSize: "1.4vw", letterSpacing: "0.15em" }}>CAPABILITY ECONOMICS</span>
      </div>
      <div className="absolute bottom-[12vh] left-[6vw] max-w-[65vw]">
        <p className="font-body font-medium text-primary uppercase tracking-widest" style={{ fontSize: "1.5vw", marginBottom: "2vh" }}>Investor Briefing</p>
        <h1 className="font-display font-bold text-text tracking-tight leading-none" style={{ fontSize: "5.5vw" }}>The Capability Lens</h1>
        <p className="font-display font-medium tracking-tight leading-tight" style={{ fontSize: "3.2vw", color: "rgba(232,234,240,0.6)", marginTop: "1vh" }}>What Others Can't See</p>
        <div className="mt-[4vh] w-[8vw] h-[0.3vh] bg-primary" />
        <p className="font-body text-muted mt-[2vh]" style={{ fontSize: "1.5vw" }}>Sub-Company Capability Intelligence for VC/PE</p>
      </div>
    </div>
  );
}
