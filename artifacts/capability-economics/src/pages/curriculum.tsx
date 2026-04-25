import { motion } from "framer-motion";
import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CurriculumPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Curriculum</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <GraduationCap className="w-8 h-8 text-primary" />
          Curriculum Packs
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Course-ready bundles built around live Capability Economics data.
        </p>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Coming soon</CardTitle>
          <CardDescription>Case-study and assignment bundles for Banking, Insurance, and Healthcare.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">
            Each pack will include a teaching note, a live data exercise, and a short assignment template.
            Email <a className="text-primary underline" href="mailto:education@capabilityeconomics.com">education@capabilityeconomics.com</a> to be notified when the first pack ships.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
