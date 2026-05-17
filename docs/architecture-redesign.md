# The Definitive Architecture: Palantir, Neo4j, Postgres, and the Agents

You asked exactly the right questions: *"Why is Postgres doing predictions? Why is Palantir offline? Should I use Neo4j? I want real recommendations from a graph."*

I have read your entire codebase, including the Palantir Foundry sync service, the Neo4j references in your master spec, and the Postgres schema. Here is the honest truth about what you have built, what is misaligned, and how to fix it so you get the graph-driven intelligence you actually want.

---

## 1. The Current State: What is Doing What?

Right now, your architecture is suffering from an identity crisis. You have three different databases, but Postgres is doing all the heavy lifting while the others sit idle.

| System | Intended Role | Actual Current Role in Codebase |
|---|---|---|
| **PostgreSQL** | PII, billing, operational CRUD | **Doing everything.** It is running the CVI predictions, storing the agent memories (via pgvector), and simulating a graph database (`memory_entities` and `memory_relations`). |
| **Palantir Foundry** | Enterprise ontology, advanced AIP logic | **Offline / One-way backup.** The `sync.ts` service just dumps CSVs of your Postgres tables into Foundry once an hour. Foundry is not feeding any intelligence back to your app. |
| **Neo4j** | Real-time graph recommendations | **Deployed but completely ignored.** It is running on Railway (`neo4j:5.26`), but zero code in your app connects to it. |

### Why is Postgres doing the predictions?
Because it was the easiest place to start. Your `cvi-engine.ts` and `dvx-engine.ts` use SQL `JOIN`s and math to calculate scores. But as you correctly pointed out, Postgres is terrible at graph traversal (e.g., "Find all capabilities that depend on X, which depends on Y").

---

## 2. The Redesign: Putting Every Tool in Its Right Place

To get real graph-driven recommendations and agents that learn, we need to stop forcing Postgres to be a graph database. Here is the correct architecture:

### A. PostgreSQL: The Operational Core
**What it does:** User accounts, Stripe billing, organization profiles, and raw CVI scores.
**What it stops doing:** Graph traversal and agent memory storage.

### B. Neo4j: The Real-Time Intelligence Graph
**What it does:** This becomes the brain of your application. 
- The **Ontology Agent** writes directly to Neo4j, creating nodes for Industries, Capabilities, and Disruptors, and drawing edges between them.
- The **Stack Optimizer** queries Neo4j to generate recommendations. Instead of a basic SQL query, it runs a Cypher query: *"Find the shortest path between our current capabilities and the target capability, avoiding any vendors with high disruption risk."*

### C. Palantir Foundry: The Enterprise Analytics Engine
**What it does:** Foundry is not for real-time app recommendations; it is for heavy, offline enterprise analytics. 
- You keep the one-way sync (`sync.ts`), but you use Foundry's AIP (Artificial Intelligence Platform) to run massive, GDP-weighted simulations across millions of rows—things that would crash your live app.
- Foundry becomes the tool you sell to your $50K/month Enterprise clients, while Neo4j powers the real-time web app.

---

## 3. How the Agents Fit In

Right now, your agents are writing their findings into Postgres tables (`memory_relations`). We need to rewire them to Neo4j.

**The New Learning Loop:**
1. **CVI Agent** reads a Perplexity report about Healthcare.
2. **Ontology Agent** extracts the entities: `(Healthcare) -[ADOPTING]-> (AI Diagnostics)`.
3. **Ontology Agent** writes this directly into **Neo4j** using the Neo4j JavaScript driver.
4. **VCE Agent** (working for a hospital client) queries **Neo4j**: *"What new capabilities is Healthcare adopting?"* Neo4j instantly returns `AI Diagnostics`.
5. **VCE Agent** recommends the client invest in AI Diagnostics.

---

## 4. The Immediate Fix Plan

You already have Neo4j running on Railway. You do not need to buy anything new. Here is the step-by-step plan to wire it up:

### Step 1: Install the Neo4j Driver
```bash
pnpm --filter @workspace/api-server add neo4j-driver
```

### Step 2: Rewire the Ontology Agent
We rewrite `artifacts/api-server/src/services/agent/graphMemory.ts`. Instead of inserting rows into Postgres `memory_entities`, we change the `upsertEntity` and `recordRelation` functions to execute Cypher queries against your live Neo4j instance.

### Step 3: Rewire the Insights and Recommendations
We update `generateInsightsTool` and `stack-optimizer.ts` to query Neo4j. When the Stack Optimizer needs to decide between "Build" or "Buy", it asks Neo4j to calculate the dependency fragility. If Neo4j says the capability relies on 12 other nodes, the recommendation becomes "Buy".

### Step 4: Leave Palantir As-Is
Palantir is doing exactly what it should be doing right now: acting as a secure, offline data lake for your enterprise clients. Do not try to make it power your real-time web app.

---

**Summary:** You are absolutely right. Postgres should not be doing graph predictions. You have Neo4j running—we just need to plug it in. Would you like me to write the Neo4j connection code and the updated Ontology Agent right now?
