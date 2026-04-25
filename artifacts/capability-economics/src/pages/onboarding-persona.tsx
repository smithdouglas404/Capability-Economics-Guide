import { useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { usePersona } from "@/hooks/use-persona";
import { PERSONA_LIST, PERSONA_META, type PersonaSlug } from "@/lib/persona-nav";

export default function OnboardingPersona() {
  const { isSignedIn, isLoaded } = useUser();
  const { setPersona, activePersonaSlug } = usePersona();
  const [, navigate] = useLocation();
  const [selected, setSelected] = useState<PersonaSlug | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoaded && !isSignedIn) {
    navigate("/sign-in");
    return null;
  }

  const submit = async (slug: PersonaSlug) => {
    setSubmitting(true);
    setError(null);
    try {
      await setPersona(slug);
      navigate(PERSONA_META[slug].defaultRoute);
    } catch (e) {
      setError((e as Error).message ?? "Failed to set persona");
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-16 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center mb-12"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Step 1 of 2 · Personalize your workspace
        </p>
        <h1 className="font-serif text-4xl md:text-5xl tracking-tight mb-3">
          How will you use Capability Economics?
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          We tune your navigation, default landing page, and dashboard composition to match how you work.
          You can switch personas anytime from the top-right menu.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PERSONA_LIST.map((p, i) => {
          const PIcon = p.icon;
          const isSelected = selected === p.slug;
          const isCurrent = activePersonaSlug === p.slug;
          return (
            <motion.div
              key={p.slug}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 * i }}
            >
              <Card
                data-testid={`persona-card-${p.slug}`}
                onClick={() => !submitting && setSelected(p.slug)}
                className={`cursor-pointer h-full transition-all border-2 ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/20 shadow-lg"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between mb-2">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                      <PIcon className="w-5 h-5 text-primary" />
                    </div>
                    {isCurrent && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono uppercase tracking-wider">
                        Current
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <CardTitle className="font-serif text-xl">{p.label}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">{p.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Lands on: <span className="font-mono">{p.defaultRoute}</span>
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {error && (
        <p className="mt-6 text-sm text-destructive text-center">{error}</p>
      )}

      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button
          size="lg"
          data-testid="persona-onboarding-continue"
          disabled={!selected || submitting}
          onClick={() => selected && submit(selected)}
          className="min-w-48"
        >
          {submitting ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting up…</>
          ) : (
            <>Continue <ArrowRight className="w-4 h-4 ml-2" /></>
          )}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          data-testid="persona-onboarding-skip"
          disabled={submitting}
          onClick={() => submit("corporate_exec")}
        >
          Skip — use Corporate Executive default
        </Button>
      </div>
    </div>
  );
}
