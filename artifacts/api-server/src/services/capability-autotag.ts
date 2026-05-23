/**
 * autoTagCapabilities — cheap word-boundary scan of an OP/post body against
 * the capability catalog. Returns matched capability slugs (deduped, capped).
 *
 * Originally landed inline in `routes/member-network.ts` for the member-post
 * composer; hoisted here so the forum-thread composer can reuse the same
 * scoring without dragging the route file in.
 *
 * Cost: one `SELECT slug, name FROM capabilities` per call, then an
 * in-memory regex sweep. ~600 capabilities = ~5 ms total. Revisit with
 * Postgres FTS only if the catalog grows past ~5k rows.
 */
import { db, capabilitiesTable } from "@workspace/db";

const MAX_TAGS = 5;

export async function autoTagCapabilities(body: string): Promise<string[]> {
  if (!body || body.length < 3) return [];
  const caps = await db.select({
    slug: capabilitiesTable.slug,
    name: capabilitiesTable.name,
  }).from(capabilitiesTable);
  if (caps.length === 0) return [];

  const lowerBody = body.toLowerCase();
  const matched = new Set<string>();
  for (const c of caps) {
    if (!c.name || c.name.length < 4) continue; // 1–3 char names are too noisy
    const needle = c.name.toLowerCase();
    // Capability names come from staff-reviewed data — still escape regex chars defensively.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    if (re.test(lowerBody)) {
      matched.add(c.slug);
      if (matched.size >= MAX_TAGS) break;
    }
  }
  return Array.from(matched);
}
