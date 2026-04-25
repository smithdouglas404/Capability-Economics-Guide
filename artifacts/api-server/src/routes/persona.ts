import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  userPersonasTable,
  PERSONA_SLUGS,
  DEFAULT_PERSONA_SLUG,
  type PersonaSlug,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logPersonaEvent } from "../services/persona-events";

const router: IRouter = Router();

const isPersonaSlug = (v: unknown): v is PersonaSlug =>
  typeof v === "string" && (PERSONA_SLUGS as readonly string[]).includes(v);

/** Read the active persona for the signed-in user. Returns the default if no row exists. */
router.get("/me/persona", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [row] = await db.select().from(userPersonasTable).where(eq(userPersonasTable.userId, auth.userId));
  res.json({
    activePersonaSlug: row?.activePersonaSlug ?? DEFAULT_PERSONA_SLUG,
    priorPersonaSlug: row?.priorPersonaSlug ?? null,
    setAt: row?.setAt ?? null,
    explicitlySet: !!row,
  });
});

/** Switch persona. Body: { slug }. Upserts user_personas row, rotates priorPersonaSlug. */
router.put("/me/persona", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const slug = (req.body as { slug?: unknown } | null)?.slug;
  if (!isPersonaSlug(slug)) {
    res.status(400).json({ error: "Invalid persona slug", validSlugs: PERSONA_SLUGS });
    return;
  }

  const [existing] = await db.select().from(userPersonasTable).where(eq(userPersonasTable.userId, auth.userId));

  if (existing) {
    if (existing.activePersonaSlug === slug) {
      res.json({ activePersonaSlug: slug, priorPersonaSlug: existing.priorPersonaSlug, unchanged: true });
      return;
    }
    await db.update(userPersonasTable).set({
      activePersonaSlug: slug,
      priorPersonaSlug: existing.activePersonaSlug,
      setAt: new Date(),
    }).where(eq(userPersonasTable.userId, auth.userId));
    void logPersonaEvent({
      userId: auth.userId,
      eventType: "switched",
      personaSlug: slug,
      priorPersonaSlug: existing.activePersonaSlug,
    });
    res.json({ activePersonaSlug: slug, priorPersonaSlug: existing.activePersonaSlug });
    return;
  }

  await db.insert(userPersonasTable).values({
    userId: auth.userId,
    activePersonaSlug: slug,
  });
  void logPersonaEvent({
    userId: auth.userId,
    eventType: "first_set",
    personaSlug: slug,
  });
  res.json({ activePersonaSlug: slug, priorPersonaSlug: null });
});

export default router;
