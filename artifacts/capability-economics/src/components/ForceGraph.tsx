import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { X } from "lucide-react";

interface GraphIndustry {
  id: number;
  name: string;
  slug: string;
  icon: string;
}

interface GraphCapability {
  id: number;
  name: string;
  industryId: number;
  benchmarkScore: number;
  quadrant: string;
  economicImpactScore: number;
  adoptionMomentumScore: number;
  disruptionIntensity: number;
}

interface GraphDependency {
  id: number;
  capabilityId: number;
  dependsOnId: number;
  strength: string;
}

interface GraphData {
  industries: GraphIndustry[];
  capabilities: GraphCapability[];
  dependencies: GraphDependency[];
}

type QuadrantTier = "hot" | "emerging" | "cooling" | "table_stakes";

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  type: "industry" | "capability";
  label: string;
  industryId: number;
  quadrant?: string;
  benchmarkScore?: number;
  economicImpactScore?: number;
  adoptionMomentumScore?: number;
  disruptionIntensity?: number;
  radius: number;
  capId?: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  type: "belongs" | "dependency";
  strength?: string;
}

const QUADRANT_COLORS: Record<string, string> = {
  hot: "var(--color-chart-1)",
  emerging: "var(--color-chart-2)",
  cooling: "var(--color-chart-3)",
  table_stakes: "var(--color-chart-4)",
};

const QUADRANT_LABELS: Record<string, string> = {
  hot: "Hot",
  emerging: "Emerging",
  cooling: "Cooling",
  table_stakes: "Table Stakes",
};

const INDUSTRY_COLORS = [
  "var(--color-primary)",
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

interface ForceGraphProps {
  data: GraphData;
}

interface CapabilityDetail {
  description?: string;
  traditionalView?: string;
  economicView?: string;
  roleMappings?: Array<{ roleTitle: string; roleName: string; relevance: string; perspective: string }>;
}

export default function ForceGraph({ data }: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [highlightIndustry, setHighlightIndustry] = useState<number | null>(null);
  const [activeIndustries, setActiveIndustries] = useState<Set<number>>(() => new Set(data.industries.map(i => i.id)));
  const [activeQuadrants, setActiveQuadrants] = useState<Set<string>>(() => new Set(["hot", "emerging", "cooling", "table_stakes"]));
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [capDetail, setCapDetail] = useState<CapabilityDetail | null>(null);
  const [capDetailLoading, setCapDetailLoading] = useState(false);
  const detailCache = useRef<Map<number, CapabilityDetail>>(new Map());

  const fetchCapabilityDetail = useCallback((capId: number) => {
    if (detailCache.current.has(capId)) {
      setCapDetail(detailCache.current.get(capId)!);
      return;
    }
    setCapDetailLoading(true);
    setCapDetail(null);
    fetch(`/api/capabilities/${capId}`)
      .then(r => { if (!r.ok) throw new Error("fetch failed"); return r.json(); })
      .then(d => {
        const detail: CapabilityDetail = {
          description: d.description,
          traditionalView: d.traditionalView,
          economicView: d.economicView,
          roleMappings: d.roleMappings,
        };
        detailCache.current.set(capId, detail);
        setCapDetail(detail);
      })
      .catch(() => setCapDetail(null))
      .finally(() => setCapDetailLoading(false));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const toggleIndustry = useCallback((id: number) => {
    setActiveIndustries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleQuadrant = useCallback((q: string) => {
    setActiveQuadrants(prev => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q); else next.add(q);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || dimensions.width === 0) return;

    const container = containerRef.current;
    const width = dimensions.width;
    const height = dimensions.height;

    const industryColorMap = new Map<number, string>();
    data.industries.forEach((ind, i) => {
      industryColorMap.set(ind.id, INDUSTRY_COLORS[i % INDUSTRY_COLORS.length]);
    });

    const nodes: SimNode[] = [];
    const links: SimLink[] = [];

    data.industries.forEach(ind => {
      if (!activeIndustries.has(ind.id)) return;
      nodes.push({
        id: `ind-${ind.id}`,
        type: "industry",
        label: ind.name,
        industryId: ind.id,
        radius: 28,
      });
    });

    const capIdSet = new Set<number>();
    data.capabilities.forEach(cap => {
      if (!activeIndustries.has(cap.industryId)) return;
      if (!activeQuadrants.has(cap.quadrant)) return;
      capIdSet.add(cap.id);
      const score = cap.benchmarkScore ?? 50;
      nodes.push({
        id: `cap-${cap.id}`,
        type: "capability",
        label: cap.name,
        industryId: cap.industryId,
        quadrant: cap.quadrant,
        benchmarkScore: cap.benchmarkScore,
        economicImpactScore: cap.economicImpactScore,
        adoptionMomentumScore: cap.adoptionMomentumScore,
        disruptionIntensity: cap.disruptionIntensity,
        radius: 6 + (score / 100) * 14,
        capId: cap.id,
      });
      links.push({
        source: `ind-${cap.industryId}`,
        target: `cap-${cap.id}`,
        type: "belongs",
      });
    });

    data.dependencies.forEach(dep => {
      if (capIdSet.has(dep.capabilityId) && capIdSet.has(dep.dependsOnId)) {
        links.push({
          source: `cap-${dep.capabilityId}`,
          target: `cap-${dep.dependsOnId}`,
          type: "dependency",
          strength: dep.strength,
        });
      }
    });

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -3 6 6")
      .attr("refX", 12)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-3L6,0L0,3")
      .attr("fill", "var(--color-muted-foreground)")
      .attr("opacity", 0.4);

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(d => d.type === "belongs" ? 100 : 150).strength(d => d.type === "belongs" ? 0.6 : 0.2))
      .force("charge", d3.forceManyBody().strength(d => (d as SimNode).type === "industry" ? -600 : -120))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius(d => d.radius + 4))
      .force("x", d3.forceX(width / 2).strength(0.03))
      .force("y", d3.forceY(height / 2).strength(0.03));

    const link = g.append("g")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", d => d.type === "dependency" ? "var(--color-chart-5)" : "var(--color-border)")
      .attr("stroke-opacity", d => d.type === "dependency" ? 0.5 : 0.25)
      .attr("stroke-width", d => d.type === "dependency" ? 1.5 : 1)
      .attr("stroke-dasharray", d => d.type === "dependency" ? "4,3" : "none")
      .attr("marker-end", d => d.type === "dependency" ? "url(#arrow)" : null);

    const node = g.append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(d3.drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    node.each(function(d) {
      const el = d3.select(this);
      if (d.type === "industry") {
        el.append("circle")
          .attr("r", d.radius)
          .attr("fill", industryColorMap.get(d.industryId) || "var(--color-primary)")
          .attr("stroke", "var(--color-background)")
          .attr("stroke-width", 3)
          .attr("opacity", 0.9);
        el.append("text")
          .text(d.label.length > 14 ? d.label.substring(0, 12) + "…" : d.label)
          .attr("text-anchor", "middle")
          .attr("dy", d.radius + 16)
          .attr("fill", "var(--color-foreground)")
          .attr("font-size", "11px")
          .attr("font-weight", "600")
          .attr("font-family", "var(--font-sans)");
      } else {
        el.append("circle")
          .attr("r", d.radius)
          .attr("fill", QUADRANT_COLORS[d.quadrant || "table_stakes"] || "var(--color-muted)")
          .attr("stroke", "var(--color-background)")
          .attr("stroke-width", 1.5)
          .attr("opacity", 0.85);
      }
    });

    const tooltip = d3.select(container).select(".graph-tooltip");

    node.on("mouseenter", function(event, d) {
      const tooltipEl = tooltip.node() as HTMLElement;
      if (tooltipEl) {
        tooltipEl.textContent = "";
        const strong = document.createElement("strong");
        strong.textContent = d.label;
        tooltipEl.appendChild(strong);
        if (d.benchmarkScore != null) {
          tooltipEl.appendChild(document.createElement("br"));
          tooltipEl.appendChild(document.createTextNode(`Benchmark: ${d.benchmarkScore}/100`));
        }
        if (d.quadrant) {
          tooltipEl.appendChild(document.createElement("br"));
          tooltipEl.appendChild(document.createTextNode(`Tier: ${QUADRANT_LABELS[d.quadrant] || d.quadrant}`));
        }
      }
      const rect = container.getBoundingClientRect();
      tooltip
        .style("display", "block")
        .style("left", `${event.clientX - rect.left + 12}px`)
        .style("top", `${event.clientY - rect.top - 8}px`);
    })
    .on("mouseleave", function() {
      tooltip.style("display", "none");
    })
    .on("click", function(_event, d) {
      if (d.type === "industry") {
        setHighlightIndustry(prev => prev === d.industryId ? null : d.industryId);
      }
      setSelectedNode(prev => prev?.id === d.id ? null : d);
      if (d.type === "capability" && d.capId) {
        fetchCapabilityDetail(d.capId);
      }
    });

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as SimNode).x!)
        .attr("y1", d => (d.source as SimNode).y!)
        .attr("x2", d => (d.target as SimNode).x!)
        .attr("y2", d => (d.target as SimNode).y!);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return () => { simulation.stop(); };
  }, [data, activeIndustries, activeQuadrants, dimensions]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll<SVGGElement, SimNode>("g g g").each(function(d) {
      const el = d3.select(this);
      if (highlightIndustry === null) {
        el.attr("opacity", 1);
      } else {
        el.attr("opacity", d.industryId === highlightIndustry ? 1 : 0.15);
      }
    });
    svg.selectAll<SVGLineElement, SimLink>("line").each(function(d) {
      const el = d3.select(this);
      if (highlightIndustry === null) {
        el.attr("opacity", d.type === "dependency" ? 0.5 : 0.25);
      } else {
        const src = d.source as SimNode;
        const tgt = d.target as SimNode;
        const visible = src.industryId === highlightIndustry || tgt.industryId === highlightIndustry;
        el.attr("opacity", visible ? 0.6 : 0.05);
      }
    });
  }, [highlightIndustry]);

  const depDetails = selectedNode?.capId
    ? data.dependencies.filter(d => d.capabilityId === selectedNode.capId || d.dependsOnId === selectedNode.capId)
    : [];
  const depCapNames = depDetails.map(d => {
    const otherId = d.capabilityId === selectedNode?.capId ? d.dependsOnId : d.capabilityId;
    return data.capabilities.find(c => c.id === otherId)?.name || `#${otherId}`;
  });

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ minHeight: 500 }}>
      <svg ref={svgRef} className="w-full h-full" />
      <div className="graph-tooltip absolute pointer-events-none bg-popover text-popover-foreground text-xs border shadow-md rounded px-3 py-2 z-50" style={{ display: "none" }} />

      <div className="absolute top-3 left-3 flex flex-col gap-2 z-20">
        <div className="bg-card/90 backdrop-blur border rounded-sm p-3 shadow-sm">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Industries</div>
          <div className="flex flex-col gap-1">
            {data.industries.map((ind, i) => (
              <button
                key={ind.id}
                onClick={() => toggleIndustry(ind.id)}
                className={`flex items-center gap-2 text-xs px-2 py-1 rounded transition-colors ${activeIndustries.has(ind.id) ? "text-foreground" : "text-muted-foreground opacity-50"}`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: INDUSTRY_COLORS[i % INDUSTRY_COLORS.length], opacity: activeIndustries.has(ind.id) ? 1 : 0.3 }} />
                {ind.name}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-card/90 backdrop-blur border rounded-sm p-3 shadow-sm">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Quadrant Tier</div>
          <div className="flex flex-col gap-1">
            {(["hot", "emerging", "cooling", "table_stakes"] as QuadrantTier[]).map(q => (
              <button
                key={q}
                onClick={() => toggleQuadrant(q)}
                className={`flex items-center gap-2 text-xs px-2 py-1 rounded transition-colors ${activeQuadrants.has(q) ? "text-foreground" : "text-muted-foreground opacity-50"}`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: QUADRANT_COLORS[q], opacity: activeQuadrants.has(q) ? 1 : 0.3 }} />
                {QUADRANT_LABELS[q]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 right-3 bg-card/90 backdrop-blur border rounded-sm p-3 shadow-sm z-20">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Legend</div>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="w-4 h-0.5" style={{ background: "var(--color-border)" }} /> Belongs to</span>
          <span className="flex items-center gap-2"><span className="w-4 h-0.5 border-t border-dashed" style={{ borderColor: "var(--color-chart-5)" }} /> Dependency</span>
        </div>
      </div>

      {selectedNode && (
        <div className="absolute top-0 right-0 h-full w-80 max-w-full bg-card border-l shadow-lg z-30 overflow-y-auto animate-in slide-in-from-right-5 duration-200">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-serif font-medium text-foreground text-base truncate pr-2">{selectedNode.label}</h3>
            <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-4 text-sm">
            {selectedNode.type === "industry" ? (
              <>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Type</span>
                  <p className="font-medium text-foreground">Industry Hub</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Capabilities</span>
                  <p className="font-medium text-foreground">{data.capabilities.filter(c => c.industryId === selectedNode.industryId).length} mapped</p>
                </div>
              </>
            ) : (
              <>
                {capDetailLoading && <p className="text-xs text-muted-foreground">Loading details…</p>}
                {capDetail?.description && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Description</span>
                    <p className="text-foreground mt-1">{capDetail.description}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Industry</span>
                  <p className="font-medium text-foreground">{data.industries.find(i => i.id === selectedNode.industryId)?.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Quadrant Tier</span>
                  <p className="font-medium text-foreground">{QUADRANT_LABELS[selectedNode.quadrant || ""] || selectedNode.quadrant}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Benchmark Score</span>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${selectedNode.benchmarkScore || 0}%`, background: QUADRANT_COLORS[selectedNode.quadrant || "table_stakes"] }} />
                    </div>
                    <span className="font-mono font-semibold text-foreground text-xs">{selectedNode.benchmarkScore}/100</span>
                  </div>
                </div>
                {capDetail?.traditionalView && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Traditional View</span>
                    <p className="text-foreground mt-1 italic">{capDetail.traditionalView}</p>
                  </div>
                )}
                {capDetail?.economicView && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Economic View</span>
                    <p className="text-foreground mt-1 italic">{capDetail.economicView}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Economic Impact</span>
                    <p className="font-mono font-semibold text-foreground">{selectedNode.economicImpactScore ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Adoption Momentum</span>
                    <p className="font-mono font-semibold text-foreground">{selectedNode.adoptionMomentumScore ?? "—"}</p>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider">Disruption Intensity</span>
                  <p className="font-mono font-semibold text-foreground">{selectedNode.disruptionIntensity != null ? (selectedNode.disruptionIntensity * 100).toFixed(0) + "%" : "—"}</p>
                </div>
                {depCapNames.length > 0 && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Dependencies</span>
                    <ul className="mt-1 space-y-1">
                      {depCapNames.map((name, i) => (
                        <li key={i} className="text-foreground flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-chart-5 flex-shrink-0" />
                          {name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {capDetail?.roleMappings && capDetail.roleMappings.length > 0 && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">C-Suite Relevance</span>
                    <div className="mt-1 space-y-2">
                      {capDetail.roleMappings.map((rm, i) => (
                        <div key={i} className="border rounded-sm p-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-foreground text-xs">{rm.roleTitle}</span>
                            <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${rm.relevance === "high" ? "bg-primary/10 text-primary" : rm.relevance === "medium" ? "bg-accent/50 text-accent-foreground" : "text-muted-foreground bg-muted"}`}>{rm.relevance}</span>
                          </div>
                          <p className="text-muted-foreground text-xs mt-1">{rm.perspective}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
