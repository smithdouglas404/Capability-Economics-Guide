/**
 * <AnimatedHeroBackdrop /> — a tasteful Aceternity/Magic-UI-style
 * animated background for the /home hero. Single component, framer-motion
 * (already in the catalog), zero new deps. Used sparingly — one hero only.
 *
 * Layers (back-to-front):
 *   1. Dotted radial grid (subtle, static, masks edges)
 *   2. Two slow-drifting radial gradient orbs (accent + chart-2 hues)
 *   3. Animated horizontal beam that sweeps once on mount
 *
 * Respects prefers-reduced-motion via Tailwind's motion-reduce: variant.
 */
import { motion } from "framer-motion";

export function AnimatedHeroBackdrop({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {/* Layer 1 — dotted radial grid */}
      <div
        className="absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        style={{
          backgroundImage: "radial-gradient(circle, hsl(var(--foreground) / 0.12) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Layer 2 — two drifting orbs */}
      <motion.div
        className="absolute -top-20 -left-20 w-[480px] h-[480px] rounded-full opacity-30 blur-3xl motion-reduce:hidden"
        style={{ background: "radial-gradient(circle at center, hsl(var(--accent)), transparent 65%)" }}
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-20 -right-20 w-[520px] h-[520px] rounded-full opacity-25 blur-3xl motion-reduce:hidden"
        style={{ background: "radial-gradient(circle at center, hsl(var(--chart-2)), transparent 65%)" }}
        animate={{ x: [0, -80, 0], y: [0, -30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />

      {/* Layer 3 — one-shot beam sweep on mount */}
      <motion.div
        className="absolute top-1/3 -left-1/4 w-1/2 h-px motion-reduce:hidden"
        style={{ background: "linear-gradient(90deg, transparent, hsl(var(--accent) / 0.7), transparent)" }}
        initial={{ x: "-30%", opacity: 0 }}
        animate={{ x: "300%", opacity: [0, 1, 0] }}
        transition={{ duration: 2.5, delay: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}
