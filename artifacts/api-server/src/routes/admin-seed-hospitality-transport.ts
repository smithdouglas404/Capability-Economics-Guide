/**
 * Seed two new industries — Hospitality and Transportation — with leaf
 * capabilities chosen to surface the Airbnb / Uber disruption patterns
 * in the Capability Disruption Index. Without these industries, the
 * DI catalog has no caps that shape-match the marketplace-+-latent-supply
 * archetypes (Uber, Airbnb), so the cosine matcher silently picks adjacent
 * patterns instead.
 *
 *   POST /api/admin/seed/hospitality-transport
 *
 * Idempotent on (industry slug) + (capability slug). Upserts both. Safe
 * to re-run.
 */
import { Router, type Request, type Response } from "express";
import { db, industriesTable, capabilitiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

interface SeedCapability {
  slug: string;
  name: string;
  description: string;
  /** Pre-canned 1-sentence "what the incumbent says it is." */
  traditionalView: string;
  /** Pre-canned 1-sentence "what it actually is in capability-economics terms." */
  economicView: string;
  /** 0-100 — used as the prior in DI scoring + as the displayed baseline. */
  benchmarkScore: number;
}

interface SeedIndustry {
  slug: string;
  name: string;
  description: string;
  icon: string;
  capabilities: SeedCapability[];
}

const SEED: SeedIndustry[] = [
  {
    slug: "hospitality",
    name: "Hospitality & Lodging",
    description: "Hotels, short-term rentals, vacation experiences, and the operational stack underneath them. Capabilities here are heavy on inventory aggregation, trust mechanisms, and real-estate vs spare-capacity economics — the home turf of the Airbnb-style disruption pattern.",
    icon: "Hotel",
    capabilities: [
      { slug: "property-listing-discovery", name: "Property Listing & Discovery", description: "How a guest finds a property to stay in — from search filters and map browse to algorithmic ranking and personalized recommendations.", traditionalView: "A directory of hotels you scroll through by stars + brand.", economicView: "An algorithmic matchmaking surface where every listing competes on standardized fields + reviews + price — the unit of competition is the listing, not the brand.", benchmarkScore: 55 },
      { slug: "booking-reservation-management", name: "Booking & Reservation Management", description: "Reservation creation, modification, cancellation, calendar sync, and channel-manager integration across OTAs.", traditionalView: "A PMS feature that lives inside a hotel's back office.", economicView: "A real-time inventory broker that exposes a property's calendar to every distribution channel at once — owning this layer captures take-rate on every booking.", benchmarkScore: 60 },
      { slug: "dynamic-pricing-revenue-management", name: "Dynamic Pricing & Revenue Management", description: "Algorithmic nightly-rate setting based on demand signals, comp-set, lead time, and length-of-stay patterns.", traditionalView: "A revenue manager spreadsheet updated weekly.", economicView: "A real-time price-discovery engine running against live demand signals — disruptors win by automating what hotels do manually.", benchmarkScore: 50 },
      { slug: "guest-experience-concierge", name: "Guest Experience & Concierge", description: "Pre-arrival communication, on-property requests, recommendations, complaint resolution, post-stay follow-up.", traditionalView: "A front-desk function staffed by trained hospitality professionals.", economicView: "An LLM-mediated guest-relationship stack where each interaction is a structured data point feeding loyalty + recommendation models.", benchmarkScore: 50 },
      { slug: "property-management-operations", name: "Property Management & Operations", description: "Day-to-day operations — housekeeping schedules, maintenance work orders, vendor coordination, on-property staffing.", traditionalView: "A back-of-house ops team coordinated via radios and printed sheets.", economicView: "A workflow + telemetry layer surfacing exceptions; the property becomes a node in a network rather than an island.", benchmarkScore: 45 },
      { slug: "cleaning-turnover-coordination", name: "Cleaning & Turnover Coordination", description: "Scheduling, dispatch, quality control, and payment for the cleaners who turn a unit between stays.", traditionalView: "An in-house housekeeping department on payroll.", economicView: "A gig-marketplace of independent cleaners with ratings + standardized checklists + photo verification.", benchmarkScore: 40 },
      { slug: "trust-safety-verified-id-deposits", name: "Trust & Safety (Verified ID, Deposits, Insurance)", description: "Guest + host verification, security-deposit handling, damage insurance, dispute resolution.", traditionalView: "Brand + regulator-enforced star rating.", economicView: "Software trust stack — verified-ID, escrow, two-sided ratings, insurance backstop — that replaces brand gatekeeping with bilateral reputation.", benchmarkScore: 50 },
      { slug: "multi-property-portfolio-management", name: "Multi-Property Portfolio Management", description: "Tools for an owner / manager running 5-500 properties — unified reporting, cross-property pricing, staff scheduling, capex planning.", traditionalView: "A franchise corporate office.", economicView: "A SaaS layer that lets a single operator scale across properties + brands without owning real estate — software replaces the franchise model.", benchmarkScore: 45 },
      { slug: "cross-border-booking-compliance", name: "Cross-Border Booking & Tax Compliance", description: "VAT/sales-tax collection per jurisdiction, occupancy-tax registration, FX, payout routing across countries.", traditionalView: "A finance team that files tax returns per market.", economicView: "An API-mediated tax + payout engine that handles every jurisdiction automatically — disruptors capture the operator who doesn't want to set up 30 entities.", benchmarkScore: 40 },
      { slug: "loyalty-repeat-guest-programs", name: "Loyalty & Repeat Guest Programs", description: "Personalized offers, points, status tiers, retargeting, and recommendation engines that drive repeat stays.", traditionalView: "A points-based rewards program redeemable at branded properties.", economicView: "A behavioral-data flywheel — every stay enriches the recommendation engine and increases lock-in.", benchmarkScore: 45 },
      { slug: "ota-channel-distribution", name: "OTA Channel Distribution", description: "Inventory + rate broadcast to Booking.com / Expedia / Vrbo / direct, with rate parity and commission handling.", traditionalView: "A wholesaler relationship managed by phone + email.", economicView: "A real-time multi-cast inventory feed with per-channel pricing, A/B testing, and direct-vs-OTA mix optimization.", benchmarkScore: 50 },
      { slug: "property-photography-listing-quality", name: "Property Photography & Listing Quality", description: "Professional photography, listing copywriting, virtual tour creation, SEO of listing pages.", traditionalView: "A one-time photoshoot when the property is renovated.", economicView: "A continuous content-quality function — listings with better photos + copy convert at 2-3x; software + gig photographers compress the per-listing cost.", benchmarkScore: 45 },
    ],
  },
  {
    slug: "transportation",
    name: "Transportation & Mobility",
    description: "Rideshare, taxi, fleet, last-mile delivery, multi-modal trip planning, and the regulatory + operational stack around moving people and goods. Heavy on real-time matching, dynamic pricing, and gig-labor coordination — home turf of the Uber-style disruption pattern.",
    icon: "Car",
    capabilities: [
      { slug: "realtime-ride-matching", name: "Real-Time Ride Matching", description: "Match a passenger to the nearest available vehicle inside a target ETA window with the right vehicle class.", traditionalView: "A dispatcher with a radio.", economicView: "A real-time geo-matching engine fed by GPS + driver-state telemetry — the unit of value is the matched-and-completed trip, not the vehicle.", benchmarkScore: 60 },
      { slug: "dynamic-surge-pricing", name: "Dynamic Surge / Demand-Based Pricing", description: "Adjust per-trip pricing in real time based on supply/demand imbalance.", traditionalView: "A regulator-set fare per mile + per minute.", economicView: "A real-time price-clearing mechanism that balances supply + demand — the price signal pulls latent supply onto the road within minutes.", benchmarkScore: 55 },
      { slug: "driver-onboarding-vetting", name: "Driver Onboarding & Vetting", description: "Background check, license verification, vehicle inspection, in-app training, payout setup.", traditionalView: "Medallion / hack license gated by a municipal authority.", economicView: "A software-mediated vetting funnel that onboards individuals at 100x the rate of medallion issuance — the gating constraint becomes software-policy, not regulator-policy.", benchmarkScore: 50 },
      { slug: "fleet-telematics-maintenance", name: "Fleet Telematics & Maintenance", description: "Vehicle telemetry, predictive maintenance, fuel/charge optimization, accident-event capture.", traditionalView: "A garage with mechanics on payroll.", economicView: "A data layer running over every vehicle — disruptors who own the telemetry stack capture insurance + maintenance + replacement-cycle margins.", benchmarkScore: 45 },
      { slug: "route-optimization", name: "Multi-Stop Route Optimization", description: "Routing engine for ride-pooling, delivery batching, refuel/recharge stops, and multi-modal trips.", traditionalView: "A dispatcher's intuition for the local grid.", economicView: "An ML-driven routing layer that compresses cost-per-mile by 10-30% — the operator who licenses or builds the best one wins per-unit-economics.", benchmarkScore: 50 },
      { slug: "last-mile-delivery-dispatch", name: "Last-Mile Delivery Dispatch", description: "Match a delivery (food, groceries, parcels) to a courier on the same platform, with batching + chaining.", traditionalView: "A driver employed by the merchant or a 3PL.", economicView: "A gig-marketplace that converts every car-owning adult into delivery capacity — disrupts the merchant's own delivery fleet AND the legacy 3PLs.", benchmarkScore: 55 },
      { slug: "multi-modal-trip-planning", name: "Multi-Modal Trip Planning", description: "Combined ride / scooter / transit / bike / walk routing in one app with unified payment.", traditionalView: "Separate apps per mode.", economicView: "A super-app surface that hides modal complexity from the user — the operator who owns this becomes the default origin of every urban trip.", benchmarkScore: 40 },
      { slug: "driver-earnings-payout-ops", name: "Driver Earnings & Payout Operations", description: "Per-trip earnings calculation, daily / instant payout, tip handling, 1099 + tax docs, cash-out incentives.", traditionalView: "A weekly paycheck cut by HR.", economicView: "Instant-payout rails + earnings transparency that double the driver-supply elasticity — the operator that pays daily wins driver loyalty.", benchmarkScore: 50 },
      { slug: "vehicle-inspection-compliance", name: "Vehicle Inspection & Regulatory Compliance", description: "Annual vehicle inspections, emissions, commercial-insurance verification, local-licensing fee management.", traditionalView: "A DMV trip per driver per year.", economicView: "A software workflow that bundles compliance into onboarding — friction the incumbent owner can't replicate without taking on the platform's whole stack.", benchmarkScore: 45 },
      { slug: "passenger-trust-safety", name: "Passenger Trust & Safety (Ratings, In-App ID, Emergency)", description: "Driver + passenger ratings, in-app emergency button, ride-tracking share, contactless ID verification.", traditionalView: "The medallion's implicit safety guarantee.", economicView: "A software trust stack — bilateral ratings + verified-ID + emergency-tracking — that replaces medallion gatekeeping with real-time bilateral reputation.", benchmarkScore: 55 },
      { slug: "ev-charging-infrastructure-coordination", name: "EV Charging Infrastructure Coordination", description: "Charger discovery, reservation, payment, dwell-time optimization for EV-fleet operations.", traditionalView: "A gas card.", economicView: "A multi-network charging-as-a-service layer — operators who own this capture margin on every kWh routed through the platform.", benchmarkScore: 40 },
      { slug: "autonomous-vehicle-operations", name: "Autonomous Vehicle Operations", description: "Mission control + tele-operations + safety-driver dispatch + edge-case handling for AV fleets.", traditionalView: "A pilot program.", economicView: "A 24/7 ops control plane for vehicles that cannot yet self-handle every edge case — the operational unlock that lets AV-as-a-service scale before full autonomy.", benchmarkScore: 35 },
    ],
  },
];

router.post("/admin/seed/hospitality-transport", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const summary: Array<{ industry: string; created: boolean; capabilitiesInserted: number; capabilitiesUpdated: number }> = [];

    for (const ind of SEED) {
      // Upsert industry by slug.
      const [existingInd] = await db.select().from(industriesTable).where(eq(industriesTable.slug, ind.slug)).limit(1);
      let industryId: number;
      let created = false;
      if (existingInd) {
        await db.update(industriesTable).set({
          name: ind.name,
          description: ind.description,
          icon: ind.icon,
        }).where(eq(industriesTable.id, existingInd.id));
        industryId = existingInd.id;
      } else {
        const [inserted] = await db.insert(industriesTable).values({
          slug: ind.slug,
          name: ind.name,
          description: ind.description,
          icon: ind.icon,
        }).returning();
        industryId = inserted.id;
        created = true;
      }

      // Upsert each capability under this industry.
      let capsInserted = 0, capsUpdated = 0;
      for (const cap of ind.capabilities) {
        const [existingCap] = await db
          .select()
          .from(capabilitiesTable)
          .where(and(eq(capabilitiesTable.industryId, industryId), eq(capabilitiesTable.slug, cap.slug)))
          .limit(1);
        const values = {
          industryId,
          slug: cap.slug,
          name: cap.name,
          description: cap.description,
          traditionalView: cap.traditionalView,
          economicView: cap.economicView,
          benchmarkScore: cap.benchmarkScore,
          isLeaf: true,
          reviewStatus: "approved" as const,
        };
        if (existingCap) {
          await db.update(capabilitiesTable).set(values).where(eq(capabilitiesTable.id, existingCap.id));
          capsUpdated++;
        } else {
          await db.insert(capabilitiesTable).values(values);
          capsInserted++;
        }
      }
      summary.push({ industry: ind.name, created, capabilitiesInserted: capsInserted, capabilitiesUpdated: capsUpdated });
    }

    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
