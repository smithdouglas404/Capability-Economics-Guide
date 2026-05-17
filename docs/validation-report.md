# Validation Report: Insight Pipeline & Graph Memory Architecture

This report details the findings from the full validation sweep of the Capability Economics platform, specifically addressing how insights are generated, which database backend is used, and the bug fixes applied to ensure system stability.

## 1. Insight Pipeline Architecture: How Recommendations are Generated

The platform uses a multi-agent architecture to generate strategic insights. The process is orchestrated by the `generateInsightsTool` (located in `tools.ts`), which is invoked by the main agent graph (`graph.ts`).

### The Flow of Insight Generation
1. **Trigger**: The main agent loop iterates through all industries and calls `generateInsightsTool` for each.
2. **Research**: The tool first calls Perplexity (`perplexityContextSearch`) to gather real-time external context about the industry and its capabilities.
3. **Graph Traversal (The "Why")**: The tool then queries the graph memory using `findCorrelations()`. This function looks for the strongest cross-agent observed correlations (e.g., "Capability A strongly correlates with Capability B in this industry").
4. **LLM Synthesis**: The Perplexity research and the graph correlations are injected into a prompt sent to Claude (Haiku/Sonnet).
5. **Recommendation Output**: Claude generates 4 strategic insights. The prompt explicitly instructs Claude: *"When the graph memory shows a strong correlation (weight > 0.6), reference it explicitly in the recommendation."*

### Which Backend Provides the Insights?
**Neo4j is the primary engine for insights.** 

The `findCorrelations()` function in `graphMemory.ts` is explicitly designed with a dual-backend architecture:
- **Primary Path (Neo4j)**: If the `NEO4J_URI` environment variable is set, the function executes a native Cypher query (`MATCH (from:Entity)-[r]->(to:Entity)...`) to traverse the graph and find correlations. It returns the results immediately, completely bypassing PostgreSQL.
- **Fallback Path (PostgreSQL)**: Only if Neo4j is unreachable or `NEO4J_URI` is missing does the function fall back to querying the `memory_relations` table in PostgreSQL.

**Conclusion**: PostgreSQL is *not* the application for recommendations when Neo4j is configured. PostgreSQL acts only as a durable mirror for writes and a safety net for reads.

## 2. Validation Findings & Bug Fixes

During the validation sweep, three critical bugs were identified and fixed. These fixes have been committed to the repository.

### Bug 1: Neo4j Integer Type Mismatch
- **Issue**: The `neo4j-driver` returns integer values (like `observedCount`) as custom `neo4j.Integer` objects, not native JavaScript numbers. The code was attempting to cast these directly using `as number`, which would result in `NaN` or object reference errors during insight generation.
- **Fix**: Implemented a `toNum()` helper function in `graphMemory.ts` that safely checks for the `.toNumber()` method on Neo4j objects and converts them to native JavaScript numbers before returning them to the insight pipeline.

### Bug 2: System Secrets ID Collision
- **Issue**: The `system_secrets` table (used for the Palantir token rotation) was originally designed as a singleton table with a hardcoded `id` default of `1`. When the new `foundry_token` row was added alongside the existing `admin_api_key` row, it caused a primary key collision.
- **Fix**: 
  - Updated the Drizzle schema (`system-secrets.ts`) to change the `id` column from `integer.default(1)` to `serial`.
  - Created a new SQL migration (`0003_system_secrets_serial_id.sql`) to safely attach a PostgreSQL sequence to the existing table without dropping data.
  - Removed the hardcoded `id: 1` from the insert statement in `admin-security.ts`.

### Bug 3: Dynamic Import in Route Handler
- **Issue**: The `foundry-admin.ts` route handler was using dynamic `await import("@workspace/db")` inside the request lifecycle, which can cause runtime module resolution errors in the compiled Express app.
- **Fix**: Replaced the dynamic imports with standard static imports at the top of the file.

## 3. Action Items for the User

To ensure Neo4j is actively driving the recommendations and the bug fixes are deployed:

1. **Push the Fixes**: Run `git push origin main` from your local terminal to deploy the validation fixes.
2. **Verify Neo4j Configuration**: In your Railway dashboard, confirm that `NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD` are set in the `api-server` environment variables. As long as these are present, Neo4j is the active engine.
3. **Monitor the Logs**: After deployment, check the Railway logs for the `api-server`. You should see the message `[graph-memory] Neo4j connected` on startup. If you see `Neo4j connection failed — falling back to PostgreSQL`, verify your credentials.
