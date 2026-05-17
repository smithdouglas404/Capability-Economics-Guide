# Intelligence Pipeline Audit: What Works, What's Broken, and How to Fix It

You asked a very direct question: *"What happened to my architecture learning? I wanted agentic and memory and graph... how are we coming up with recommendations and insights?"*

I just ran a deep audit of your entire codebase—specifically tracing the path from the agents, through the graph memory, to the `insights.ts` and `recommendations` services. 

Here is the honest truth: **Your agents are doing incredible research, but the pipeline that turns that research into actionable insights is broken in the middle.**

---

## The Current State of the Pipeline

### 1. The Agents & Memory (Working perfectly)
Your agents (CVI, VCE, Disruption, Ontology) are successfully running. They are querying Perplexity, pulling real market data, and writing observations to Mem0 and the PostgresStore. 
- **Status:** ✅ Working. The raw intelligence is being gathered.

### 2. The Graph Memory (Working, but isolated)
The `graphMemory.ts` service is successfully extracting entities (industries, capabilities, concepts) from the agent text and building relationships (e.g., "Capability A correlates with Concept B").
- **Status:** ⚠️ Working, but isolated. The graph is being built, but **nothing is reading it to generate insights.**

### 3. Insights Generation (Broken / Hardcoded)
When the system generates insights (via `generateInsightsTool` in `tools.ts`), it does **not** query the graph memory. It does **not** look at the correlations the Ontology Agent found. 
Instead, it just pulls the raw CVI scores from the database, runs a fresh Perplexity search, and asks Claude to write 4 bullet points.
- **Status:** ❌ Broken. The insights are just LLM summaries of Perplexity searches. They completely ignore the compounding intelligence in your graph memory.

### 4. Recommendations (Working, but static)
The `stack-optimizer.ts` service generates Build/Buy/Outsource recommendations. It correctly looks at the database to find companies to "Buy" or marketplace listings to "Outsource". The `csuite-translator.ts` successfully translates these into persona-specific language (CFO, COO, etc.).
- **Status:** ⚠️ Working, but static. It doesn't use the graph to find hidden dependencies (e.g., "You can't build Capability A without first buying Capability B").

---

## The Core Problem: The Missing Link

The entire point of having an Ontology Agent and a Graph Memory is to discover **hidden correlations** that a simple Perplexity search can't find. 

For example, if the CVI Agent researches "Healthcare" and the VCE Agent researches "Retail", the Graph Memory might connect the dots and realize that both industries are suddenly adopting the exact same "Data Infrastructure" capability. 

Right now, your `generateInsightsTool` is completely blind to that. It just asks Perplexity: *"What are the urgent gaps in Healthcare?"*

---

## The Fix Plan: Wiring the Graph to the Insights

To actually get the "agentic, memory, and graph" intelligence you designed, we need to change exactly one function: `generateInsightsTool` in `artifacts/api-server/src/services/agent/tools.ts`.

### Step 1: Make Insights Query the Graph
Before asking Claude to write insights, the tool must call `findCorrelations()` and `findRelated()` from `graphMemory.ts`. 

### Step 2: Feed the Graph Data to the LLM
We change the prompt in `generateInsightsTool` from this:
> *"Generate 4 insights based on these CVI scores and this Perplexity research."*

To this:
> *"Generate 4 insights based on these CVI scores, this Perplexity research, AND these hidden correlations discovered by our autonomous agents over the last 30 days: [Insert Graph Data]. Focus specifically on cross-industry trends and unexpected capability dependencies."*

### Step 3: Make Recommendations Graph-Aware
In `stack-optimizer.ts`, when evaluating the "Build" option, we must query the graph to see what other capabilities are highly correlated with the target. If the target capability requires 5 other emerging capabilities, the "Estimated Difficulty" score should spike, pushing the recommendation toward "Buy".

---

## Summary

You built a Ferrari engine (the agents and the graph memory), but right now, the wheels (the insights and recommendations) are only connected to a bicycle pedal (raw Perplexity searches). 

The fix does not require new databases or new agents. It requires taking the data your Ontology Agent is already putting into `memory_relations` and feeding it directly into the prompt that generates the insights.
