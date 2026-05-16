import { db } from "@workspace/db";
import {
  botsTable,
  organizationsTable,
  kycVerificationsTable,
  membershipTiersTable,
  userMembershipsTable,
  creditAccountsTable,
  billingOrganizationsTable,
  billingOrgMembersTable,
  industriesTable,
  adminAuditLogTable,
  TIER_ALLOCATIONS,
  type Bot,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { getPersona, listPersonas, type PersonaTemplate } from "./personas";
import { logger } from "../../lib/logger";

const HIGHEST_TIER_SLUG = "platform";

function synthClerkId(personaKey: string): string {
  // bot_pe_partner_a1b2c3d4 — easy to grep for in logs and DBs.
  return `bot_${personaKey}_${crypto.randomBytes(4).toString("hex")}`;
}

function synthStripeCustomerId(personaKey: string): string {
  return `bot_cus_${personaKey}_${crypto.randomBytes(6).toString("hex")}`;
}

function synthStripeSubscriptionId(personaKey: string): string {
  return `bot_sub_${personaKey}_${crypto.randomBytes(6).toString("hex")}`;
}

function synthSessionToken(): string {
  return `bot_sess_${crypto.randomBytes(16).toString("hex")}`;
}

function synthBillingOrgSlug(personaKey: string): string {
  return `bot-${personaKey}-${crypto.randomBytes(3).toString("hex")}`;
}

export interface ProvisionResult {
  bot: Bot;
  organizationId: number;
  kycVerificationId: number;
  membershipId: number;
  billingOrgId: number;
}

/**
 * Idempotency check: only one active bot per persona at a time. Re-spawning
 * the same persona while one is still active returns a 409 from the route
 * layer; the admin must explicitly disable the existing one first.
 */
export async function findActiveBotForPersona(personaKey: string): Promise<Bot | null> {
  const rows = await db.select().from(botsTable)
    .where(sql`${botsTable.personaKey} = ${personaKey} AND ${botsTable.status} = 'active'`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Provision a fully-onboarded synthetic agent across all identity tables.
 * Order matters — later inserts reference IDs from earlier ones. Wrapped in
 * a transaction so a mid-provisioning failure doesn't leave orphan rows.
 *
 * Tier defaults to "platform" (highest, with full KYC and 50k credits).
 * Per-bot budget override is permitted; default is 40 USD/mo.
 */
export async function provisionBot(opts: {
  personaKey: string;
  monthlyBudgetUsdCap?: number;
  provisionedByUserId: string;
  provisionedByEmail?: string | null;
}): Promise<ProvisionResult> {
  const persona = getPersona(opts.personaKey);
  if (!persona) throw new Error(`Unknown persona: ${opts.personaKey}`);

  const existing = await findActiveBotForPersona(opts.personaKey);
  if (existing) {
    throw new Error(`Persona ${opts.personaKey} already has an active bot (id=${existing.id}). Disable it first if you want to re-spawn.`);
  }

  // Resolve the industry slug to an id. Fall back to the first industry if
  // the persona's preferred industry isn't seeded yet — the bot still works,
  // it just gets a less-on-brand placement.
  const industries = await db.select().from(industriesTable);
  const preferredIndustry = industries.find(i => i.slug === persona.industrySlug);
  const fallbackIndustry = industries[0];
  const industry = preferredIndustry ?? fallbackIndustry;
  if (!industry) {
    throw new Error("Cannot provision bot: no industries seeded in database yet.");
  }

  // Look up the highest membership tier ("platform"). Fail loud if the tier
  // table hasn't been seeded — that's a setup problem the admin must fix.
  const tiers = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.slug, HIGHEST_TIER_SLUG)).limit(1);
  const platformTier = tiers[0];
  if (!platformTier) {
    throw new Error(`Cannot provision bot: tier '${HIGHEST_TIER_SLUG}' not found in membership_tiers. Seed tiers first.`);
  }

  const clerkUserId = synthClerkId(persona.key);
  const stripeCustomerId = synthStripeCustomerId(persona.key);
  const stripeSubscriptionId = synthStripeSubscriptionId(persona.key);
  const sessionToken = synthSessionToken();
  const billingOrgSlug = synthBillingOrgSlug(persona.key);
  const mem0Namespace = `bot_${persona.key}_${crypto.randomBytes(3).toString("hex")}`;

  // node-postgres + drizzle: db.transaction wraps inserts atomically.
  const result = await db.transaction(async (tx) => {
    // 1. organizations row — represents the bot's entity for capability assessments
    const [org] = await tx.insert(organizationsTable).values({
      name: persona.entityName,
      industryId: industry.id,
      size: persona.entitySize,
      geography: persona.entityGeography,
      revenueBand: persona.entityRevenueBand,
      peerOptIn: true, // bots opt into peer benchmarking so they populate Task #4
      clerkUserId,
      sessionToken,
    }).returning();

    // 2. kyc_verifications row — full 4-level approval (matches "platform" tier)
    const fakeAmlDetails: Array<{ type: string; name: string; matchScore: number }> = [];
    const [kyc] = await tx.insert(kycVerificationsTable).values({
      userId: clerkUserId,
      userEmail: persona.email,
      kycLevel: "full",
      tierSlug: HIGHEST_TIER_SLUG,
      status: "approved",
      emailVerified: "verified",
      emailRequestId: `bot_email_${crypto.randomBytes(4).toString("hex")}`,
      idSessionToken: `bot_didit_${crypto.randomBytes(6).toString("hex")}`,
      idRequestId: `bot_didit_req_${crypto.randomBytes(4).toString("hex")}`,
      idStatus: "Approved",
      firstName: persona.firstName,
      lastName: persona.lastName,
      dateOfBirth: persona.dateOfBirth,
      documentType: persona.documentType,
      documentNumber: persona.documentNumber,
      nationality: persona.nationality,
      idWorkflowResults: { synthetic: true, source: "bot-provisioning" },
      livenessStatus: "Approved",
      livenessScore: 0.97,
      livenessRequestId: `bot_live_${crypto.randomBytes(4).toString("hex")}`,
      amlStatus: "Clear",
      amlScore: 0.02,
      amlHits: 0,
      amlDetails: fakeAmlDetails,
      amlRequestId: `bot_aml_${crypto.randomBytes(4).toString("hex")}`,
      completedAt: new Date(),
    }).returning();

    // 3. user_memberships row — paid, active, on highest tier
    const annualPrice = platformTier.annualPriceCents ?? 0;
    const [membership] = await tx.insert(userMembershipsTable).values({
      userId: clerkUserId,
      userEmail: persona.email,
      userName: persona.displayName,
      tierId: platformTier.id,
      entityType: persona.entityType,
      entityName: persona.entityName,
      entityIndustry: industry.name,
      entitySize: persona.entitySize,
      entityRole: persona.entityRole,
      paymentMethod: "synthetic_card",
      paymentStatus: "paid",
      paymentRef: `bot_pay_${crypto.randomBytes(6).toString("hex")}`,
      paymentAmountCents: annualPrice,
      status: "active",
      notes: `Synthetic agent (persona=${persona.key}). Provisioned by bots service.`,
      approvedAt: new Date(),
      approvedBy: "bot-provisioning",
      stripeSubscriptionId,
      stripeCustomerId,
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }).returning();

    // 4. credit_accounts row — keyed by user_id, NOT auto-id
    const monthlyAllocation = TIER_ALLOCATIONS[HIGHEST_TIER_SLUG] ?? 50000;
    await tx.insert(creditAccountsTable).values({
      userId: clerkUserId,
      balance: monthlyAllocation,
      monthlyAllocation,
      tierSlug: HIGHEST_TIER_SLUG,
    });

    // 5. billing_organizations row — bot owns its own billing org
    const [billingOrg] = await tx.insert(billingOrganizationsTable).values({
      name: persona.entityName,
      slug: billingOrgSlug,
      ownerUserId: clerkUserId,
      ownerEmail: persona.email,
      tierId: platformTier.id,
      status: "active",
      seatLimit: 25,
      stripeSubscriptionId,
      stripeCustomerId,
    }).returning();

    // 6. billing_org_members row — bot is the owner of its org
    await tx.insert(billingOrgMembersTable).values({
      orgId: billingOrg.id,
      userId: clerkUserId,
      email: persona.email,
      role: "owner",
      invitedBy: "bot-provisioning",
    });

    // 7. bots row — central record linking all the above
    const [bot] = await tx.insert(botsTable).values({
      personaKey: persona.key,
      displayName: persona.displayName,
      email: persona.email,
      status: "active",
      clerkUserId,
      organizationId: org.id,
      kycVerificationId: kyc.id,
      membershipId: membership.id,
      billingOrgId: billingOrg.id,
      addressLine1: persona.addressLine1,
      addressLine2: persona.addressLine2 ?? null,
      city: persona.city,
      region: persona.region,
      postalCode: persona.postalCode,
      country: persona.country,
      bio: persona.bio,
      title: persona.title,
      avatarUrl: persona.avatarUrl,
      monthlyBudgetUsdCap: opts.monthlyBudgetUsdCap ?? 40,
      mem0Namespace,
      biases: persona.biases as unknown as Record<string, unknown>,
    }).returning();

    // 8. admin_audit_log row — auditable trail of who provisioned what
    await tx.insert(adminAuditLogTable).values({
      actorUserId: opts.provisionedByUserId,
      actorEmail: opts.provisionedByEmail ?? null,
      action: "bot.provision",
      targetType: "bot",
      targetId: String(bot.id),
      details: {
        personaKey: persona.key,
        displayName: persona.displayName,
        clerkUserId,
        organizationId: org.id,
        kycVerificationId: kyc.id,
        membershipId: membership.id,
        billingOrgId: billingOrg.id,
        tierSlug: HIGHEST_TIER_SLUG,
        monthlyBudgetUsdCap: bot.monthlyBudgetUsdCap,
      },
    });

    return {
      bot,
      organizationId: org.id,
      kycVerificationId: kyc.id,
      membershipId: membership.id,
      billingOrgId: billingOrg.id,
    };
  });

  logger.info({
    botId: result.bot.id,
    personaKey: persona.key,
    clerkUserId,
    industry: industry.name,
  }, "[bots] provisioned synthetic agent");

  return result;
}

/**
 * Disable a bot. Does NOT delete any rows — the linked identity records
 * remain so historical bot-generated artifacts (comments, marketplace
 * listings, assessments) keep working. Use this rather than DELETE so
 * audit trails and downstream FKs stay intact.
 */
export async function disableBot(botId: number, opts: { actorUserId: string; actorEmail?: string | null }): Promise<void> {
  const [existing] = await db.select().from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  if (!existing) throw new Error(`Bot ${botId} not found`);

  await db.transaction(async (tx) => {
    await tx.update(botsTable).set({ status: "disabled", updatedAt: new Date() }).where(eq(botsTable.id, botId));
    await tx.insert(adminAuditLogTable).values({
      actorUserId: opts.actorUserId,
      actorEmail: opts.actorEmail ?? null,
      action: "bot.disable",
      targetType: "bot",
      targetId: String(botId),
      details: { personaKey: existing.personaKey, clerkUserId: existing.clerkUserId },
    });
  });
}

/**
 * Toggle pause/resume without disabling identity. Paused bots stop acting
 * but their identity rows continue to back any UI artifacts they've created.
 */
export async function setBotStatus(botId: number, status: "active" | "paused", opts: { actorUserId: string; actorEmail?: string | null }): Promise<void> {
  const [existing] = await db.select().from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  if (!existing) throw new Error(`Bot ${botId} not found`);

  await db.transaction(async (tx) => {
    await tx.update(botsTable).set({ status, updatedAt: new Date() }).where(eq(botsTable.id, botId));
    await tx.insert(adminAuditLogTable).values({
      actorUserId: opts.actorUserId,
      actorEmail: opts.actorEmail ?? null,
      action: `bot.${status}`,
      targetType: "bot",
      targetId: String(botId),
      details: { personaKey: existing.personaKey, clerkUserId: existing.clerkUserId },
    });
  });
}

/**
 * List all bots (any status). For the admin roster UI.
 */
export async function listBots(): Promise<Bot[]> {
  return await db.select().from(botsTable).orderBy(botsTable.id);
}

/**
 * Return personas that are available to provision — those without an active
 * bot. Powers the "Add new bot" picker.
 */
export async function listAvailablePersonas(): Promise<PersonaTemplate[]> {
  const active = await db.select({ key: botsTable.personaKey }).from(botsTable).where(eq(botsTable.status, "active"));
  const takenKeys = new Set(active.map(a => a.key));
  return listPersonas().filter(p => !takenKeys.has(p.key));
}
