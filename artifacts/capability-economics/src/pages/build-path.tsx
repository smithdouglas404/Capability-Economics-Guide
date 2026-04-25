import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Route, Loader2, Target, ChevronRight, GitBranch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type Capability = { id: number; name: string; industryId: number; isLeaf: boolean; parentCapabilityId: number | null };
type Dependency = { id: number; dependsOnId: number; dependsOnName: string; strength: string };
type CapabilityDetail = Capability & { dependencies: Dependency[]; description: string; benchmarkScore: number };

type TreeNode = { id: number; name: string; depth: number; strength: string | null; children: TreeNode[] };

function buildTree(targetId: number, capsById: Map<number, CapabilityDetail>): TreeNode {
  const seen = new Set<number>();
  function recur(id: number, depth: number, strength: string | null): TreeNode {
    if (seen.has(id) || depth > 6) {
      const cap = capsById.get(id);
      return { id, name: cap?.name ?? `#${id}`, depth, strength, children: [] };
    }
    seen.add(id);
    const cap = capsById.get(id);
    const children = (cap?.dependencies ?? []).map((d) => recur(d.dependsOnId, depth + 1, d.strength));
    return { id, name: cap?.name ?? `#${id}`, depth, strength, children };
  }
  return recur(targetId, 0, null);
}

function flattenLeavesFirst(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
  for (const c of node.children) flattenLeavesFirst(c, out);
  out.push(node);
  return out;
}

function strengthClass(s: string | null): string {
  if (s === "strong") return "border-rose-500/40 bg-rose-500/10 text-rose-700";
  if (s === "moderate") return "border-amber-500/40 bg-amber-500/10 text-amber-700";
  if (s === "weak") return "border-sky-500/40 bg-sky-500/10 text-sky-700";
  return "border-primary/40 bg-primary/10 text-primary";
}

export default function BuildPath() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<string>("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [targetId, setTargetId] = useState<string>("");
  const [details, setDetails] = useState<Map<number, CapabilityDetail>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/industries`)
      .then((r) => r.json())
      .then((d) => {
        const list: Industry[] = d.industries ?? d ?? [];
        setIndustries(list);
        if (list.length && !industryId) setIndustryId(String(list[0].id));
      });
  }, []);

  useEffect(() => {
    if (!industryId) return;
    fetch(`${API_BASE}/capabilities?industryId=${industryId}`)
      .then((r) => r.json())
      .then((d) => {
        const list: Capability[] = Array.isArray(d) ? d : (d.capabilities ?? []);
        setCapabilities(list.filter((c) => c.isLeaf !== false));
        setTargetId("");
        setDetails(new Map());
      });
  }, [industryId]);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    setLoading(true);

    async function loadGraph(rootId: number) {
      const visited = new Map<number, CapabilityDetail>();
      const stack = [rootId];
      while (stack.length && visited.size < 60) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        try {
          const res = await fetch(`${API_BASE}/capabilities/${id}`);
          if (!res.ok) continue;
          const detail = await res.json() as CapabilityDetail;
          visited.set(id, detail);
          for (const dep of detail.dependencies ?? []) {
            if (!visited.has(dep.dependsOnId)) stack.push(dep.dependsOnId);
          }
        } catch {
          // skip
        }
      }
      if (!cancelled) {
        setDetails(visited);
        setLoading(false);
      }
    }

    void loadGraph(Number(targetId));
    return () => { cancelled = true; };
  }, [targetId]);

  const tree = useMemo(() => {
    if (!targetId || details.size === 0) return null;
    return buildTree(Number(targetId), details);
  }, [targetId, details]);

  const buildOrder = useMemo(() => {
    if (!tree) return [];
    const seenIds = new Set<number>();
    const ordered: TreeNode[] = [];
    for (const n of flattenLeavesFirst(tree)) {
      if (seenIds.has(n.id)) continue;
      seenIds.add(n.id);
      ordered.push(n);
    }
    return ordered;
  }, [tree]);

  function renderTree(node: TreeNode, isLast = true, prefix = ""): React.ReactNode {
    const branchSymbol = node.depth === 0 ? "" : isLast ? "└─ " : "├─ ";
    const isTarget = node.depth === 0;
    return (
      <div key={`${node.id}-${node.depth}-${prefix}`}>
        <div className="font-mono text-sm flex items-center gap-2 py-1">
          <span className="text-muted-foreground whitespace-pre">{prefix}{branchSymbol}</span>
          <Badge
            variant="outline"
            className={isTarget ? "bg-primary text-primary-foreground border-primary" : strengthClass(node.strength)}
          >
            {isTarget && <Target className="w-3 h-3 mr-1" />}
            {node.name}
          </Badge>
          {node.strength && <span className="text-xs text-muted-foreground">({node.strength})</span>}
        </div>
        {node.children.map((c, i) =>
          renderTree(c, i === node.children.length - 1, prefix + (node.depth === 0 ? "" : isLast ? "   " : "│  "))
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Plan · Build Path</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Route className="w-8 h-8 text-primary" />
          Build Path
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Pick the capability you want to land. We walk the dependency graph and lay out a leaves-first build order
          so you ship the foundations before the keystone.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Industry</p>
            <Select value={industryId} onValueChange={setIndustryId}>
              <SelectTrigger><SelectValue placeholder="Pick industry" /></SelectTrigger>
              <SelectContent>
                {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Target capability</p>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger><SelectValue placeholder={capabilities.length ? "Pick a capability to land" : "Pick an industry first"} /></SelectTrigger>
              <SelectContent>
                {capabilities.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!targetId ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Route className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">Choose a target.</p>
            <p className="text-sm">We'll trace its dependency graph and order the build.</p>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin opacity-50" />
            <p className="text-sm">Walking the dependency graph…</p>
          </CardContent>
        </Card>
      ) : !tree || tree.children.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="font-serif text-lg mb-1">No declared dependencies.</p>
            <p className="text-sm">This capability stands on its own — start building it directly. The full {capabilities.length}-capability inventory for the industry is in the dropdown above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-6">
              <h2 className="font-serif text-xl tracking-tight mb-1 flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-primary" />Dependency tree
              </h2>
              <p className="text-xs text-muted-foreground mb-4">Target at top, dependencies indented below. Strength colour-coded.</p>
              <div className="overflow-x-auto">{renderTree(tree)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h2 className="font-serif text-xl tracking-tight mb-1 flex items-center gap-2">
                <ChevronRight className="w-5 h-5 text-primary" />Build order
              </h2>
              <p className="text-xs text-muted-foreground mb-4">Leaves first. Ship each rung before climbing.</p>
              <ol className="space-y-2">
                {buildOrder.map((n, i) => {
                  const isTarget = i === buildOrder.length - 1;
                  return (
                    <li key={n.id} className={`flex items-center gap-3 px-3 py-2 rounded-md border ${isTarget ? "bg-primary/10 border-primary/40" : "bg-muted/30 border-transparent"}`}>
                      <span className="text-xs font-mono text-muted-foreground w-6">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-sm font-medium flex-1">{n.name}</span>
                      {isTarget && <Badge className="bg-primary text-primary-foreground"><Target className="w-3 h-3 mr-1" />target</Badge>}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
