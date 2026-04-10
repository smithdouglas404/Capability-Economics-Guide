import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useListIndustries, useCreateOrganization, useGetIndustry, useUpsertAssessments, getGetIndustryQueryKey } from "@workspace/api-client-react";
import type { Industry, Capability } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield, Heart, Landmark, Factory, Cpu, ShoppingCart,
  Building2, ArrowRight, CheckCircle2, Upload, Loader2,
  Sliders
} from "lucide-react";
import { useLocation } from "wouter";
import { Slider } from "@/components/ui/slider";

const iconMap: Record<string, React.ElementType> = {
  Shield, Heart, Landmark, Factory, Cpu, ShoppingCart,
};

const investmentLevels = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "strategic", label: "Strategic" },
];

const importanceLevels = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export default function OrganizationSetup() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<"create" | "assess">("create");
  const [orgName, setOrgName] = useState("");
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [orgSize, setOrgSize] = useState<"small" | "mid" | "large" | "enterprise">("mid");
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ce_session_token");
    }
    return null;
  });
  const [scores, setScores] = useState<Record<number, { score: number; investment: string; strategicImportance: string }>>({});

  const { data: industries } = useListIndustries();
  const createOrg = useCreateOrganization();

  const selectedIndustryId = sessionToken ? null : industryId;
  const storedIndustryId = sessionToken ? parseInt(localStorage.getItem("ce_industry_id") || "0") : (industryId || 0);

  const { data: industryDetail } = useGetIndustry(storedIndustryId || 0, {
    query: { queryKey: getGetIndustryQueryKey(storedIndustryId || 0), enabled: !!storedIndustryId },
  });

  const upsertAssessments = useUpsertAssessments();

  useEffect(() => {
    if (sessionToken) {
      setStep("assess");
    }
  }, [sessionToken]);

  useEffect(() => {
    if (industryDetail && Object.keys(scores).length === 0) {
      const defaults: Record<number, { score: number; investment: string; strategicImportance: string }> = {};
      industryDetail.capabilities.forEach((cap: Capability) => {
        defaults[cap.id] = { score: cap.benchmarkScore, investment: "moderate", strategicImportance: "medium" };
      });
      setScores(defaults);
    }
  }, [industryDetail]);

  const handleCreateOrg = async () => {
    if (!orgName || !industryId) return;

    try {
      const result = await createOrg.mutateAsync({
        data: { name: orgName, industryId, size: orgSize }
      });
      setSessionToken(result.sessionToken);
      localStorage.setItem("ce_session_token", result.sessionToken);
      localStorage.setItem("ce_industry_id", industryId.toString());
      setStep("assess");
    } catch (error) {
      console.error("Failed to create organization:", error);
    }
  };

  const handleSaveAssessments = async () => {
    if (!sessionToken || Object.keys(scores).length === 0) return;

    const assessments = Object.entries(scores).map(([capId, data]) => ({
      capabilityId: parseInt(capId),
      maturityScore: data.score,
      investmentLevel: data.investment as "minimal" | "low" | "moderate" | "high" | "strategic",
      strategicImportance: data.strategicImportance as "low" | "medium" | "high" | "critical",
    }));

    try {
      await upsertAssessments.mutateAsync({ data: { assessments }, sessionToken: sessionToken! });
      navigate("/dashboard");
    } catch (error) {
      console.error("Failed to save assessments:", error);
    }
  };

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !sessionToken) return;

    const text = await file.text();

    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/organizations/${sessionToken}/upload-csv`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const result = await response.json();
      if (result.imported > 0) {
        navigate("/dashboard");
      }
    } catch (error) {
      console.error("CSV upload failed:", error);
    }
  };

  if (step === "create" && !sessionToken) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <section className="bg-muted/30 py-16 border-b">
          <div className="container mx-auto px-4 max-w-3xl">
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary mb-4">
              Step 1 of 2
            </div>
            <h1 className="text-3xl md:text-5xl font-serif font-medium tracking-tight mb-4 text-foreground">
              Set Up Your Organization
            </h1>
            <p className="text-lg text-muted-foreground">
              Create your organization profile to begin assessing your capabilities against industry benchmarks.
            </p>
          </div>
        </section>

        <section className="py-12 container mx-auto px-4 max-w-xl">
          <Card className="rounded-none shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Organization Details
              </CardTitle>
              <CardDescription>Tell us about your organization to tailor the assessment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="orgName">Organization Name</Label>
                <Input
                  id="orgName"
                  placeholder="e.g. Acme Insurance Co."
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Industry</Label>
                <div className="grid grid-cols-2 gap-2">
                  {industries?.map((ind: Industry) => {
                    const Icon = iconMap[ind.icon] || Shield;
                    const selected = industryId === ind.id;
                    return (
                      <button
                        key={ind.id}
                        onClick={() => setIndustryId(ind.id)}
                        className={`flex items-center gap-2 p-3 border rounded-sm text-left text-sm transition-all cursor-pointer ${
                          selected
                            ? "border-primary bg-primary/5 text-primary"
                            : "hover:border-primary/30 text-foreground"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{ind.name}</span>
                        {selected && <CheckCircle2 className="w-4 h-4 ml-auto shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Organization Size</Label>
                <Select value={orgSize} onValueChange={(val) => setOrgSize(val as "small" | "mid" | "large" | "enterprise")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small (1-100 employees)</SelectItem>
                    <SelectItem value="mid">Mid-Market (100-1,000)</SelectItem>
                    <SelectItem value="large">Large (1,000-10,000)</SelectItem>
                    <SelectItem value="enterprise">Enterprise (10,000+)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleCreateOrg}
                disabled={!orgName || !industryId || createOrg.isPending}
                className="w-full h-12 rounded-none bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {createOrg.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Continue to Assessment
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <section className="bg-muted/30 py-12 border-b">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary mb-4">
            Step 2 of 2
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-medium tracking-tight mb-4 text-foreground">
            Assess Your Capabilities
          </h1>
          <p className="text-lg text-muted-foreground">
            Rate your organization's maturity for each capability. You can also upload a CSV file with your assessments.
          </p>

          <div className="mt-6 flex items-center gap-4">
            <label className="inline-flex items-center gap-2 px-4 py-2 border border-primary/30 rounded-sm text-primary text-sm font-medium hover:bg-primary/5 transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Upload CSV
              <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
            </label>
            <span className="text-xs text-muted-foreground">Format: capability_slug, maturity_score, investment_level</span>
          </div>
        </div>
      </section>

      <section className="py-8 container mx-auto px-4 max-w-5xl">
        {industryDetail ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {industryDetail.capabilities.map((cap: Capability) => {
              const current = scores[cap.id] || { score: cap.benchmarkScore, investment: "moderate", strategicImportance: "medium" };
              return (
                <Card key={cap.id} className="rounded-none">
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground">{cap.name}</h3>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{cap.description}</p>
                          <div className="text-xs text-primary/70 mt-1">Benchmark: {cap.benchmarkScore}</div>
                        </div>
                      </div>
                      <div className="grid md:grid-cols-12 gap-4 items-center">
                        <div className="md:col-span-5">
                          <Label className="text-xs text-muted-foreground mb-1 block">Maturity Score</Label>
                          <div className="flex items-center gap-3">
                            <Sliders className="w-4 h-4 text-muted-foreground shrink-0" />
                            <Slider
                              value={[current.score]}
                              min={0}
                              max={100}
                              step={5}
                              onValueChange={([val]) => setScores(prev => ({
                                ...prev,
                                [cap.id]: { ...current, score: val }
                              }))}
                            />
                            <span className="font-mono text-sm w-8 text-right">{current.score}</span>
                          </div>
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-xs text-muted-foreground mb-1 block">Investment Level</Label>
                          <Select
                            value={current.investment}
                            onValueChange={(val) => setScores(prev => ({
                              ...prev,
                              [cap.id]: { ...current, investment: val }
                            }))}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {investmentLevels.map((lvl) => (
                                <SelectItem key={lvl.value} value={lvl.value}>{lvl.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="md:col-span-3">
                          <Label className="text-xs text-muted-foreground mb-1 block">Strategic Importance</Label>
                          <Select
                            value={current.strategicImportance}
                            onValueChange={(val) => setScores(prev => ({
                              ...prev,
                              [cap.id]: { ...current, strategicImportance: val }
                            }))}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {importanceLevels.map((lvl) => (
                                <SelectItem key={lvl.value} value={lvl.value}>{lvl.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <div className="flex justify-end pt-6">
              <Button
                onClick={handleSaveAssessments}
                disabled={Object.keys(scores).length === 0 || upsertAssessments.isPending}
                className="h-12 px-8 rounded-none bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {upsertAssessments.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Save & View Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </motion.div>
        ) : (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}
      </section>
    </div>
  );
}
