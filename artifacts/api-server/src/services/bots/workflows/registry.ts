/**
 * Central registry of all bot workflows. Built once at process start,
 * read by the scheduler + admin routes + trigger dispatcher.
 *
 * Adding a new workflow:
 *   1. Build the WorkflowDefinition in a new file under workflows/.
 *   2. Import + register it here.
 *   3. Done — scheduler picks it up on next tick; admin UI lists it.
 */
import type { WorkflowDefinition } from "./types";
import { peWeeklyDiligenceWorkflow } from "./pe-weekly-diligence";
import {
  vcThesisBuildWorkflow,
  insuranceCapabilityReviewWorkflow,
  healthcareOrgComparisonWorkflow,
  energyQuarterlyAuditWorkflow,
} from "./persona-cycles";
import {
  crossBotConsensusMapWorkflow,
  botToCviCalibrationWorkflow,
} from "./cross-bot-system";

const REGISTRY = new Map<string, WorkflowDefinition>();

function register(def: WorkflowDefinition): void {
  if (REGISTRY.has(def.key)) {
    throw new Error(`Workflow key collision: ${def.key} already registered`);
  }
  REGISTRY.set(def.key, def);
}

// Phase 1 — PE Partner anchor workflow.
register(peWeeklyDiligenceWorkflow);

// Phase 2 — remaining persona cycles.
register(vcThesisBuildWorkflow);
register(insuranceCapabilityReviewWorkflow);
register(healthcareOrgComparisonWorkflow);
register(energyQuarterlyAuditWorkflow);

// Phase 3 — system-wide cross-bot workflows.
register(crossBotConsensusMapWorkflow);
register(botToCviCalibrationWorkflow);

/** Exposed read-only view of the registry. */
export function getRegistry(): ReadonlyMap<string, WorkflowDefinition> {
  return REGISTRY;
}

/** Workflows applicable to a given persona key. */
export function workflowsForPersona(personaKey: string): WorkflowDefinition[] {
  return Array.from(REGISTRY.values()).filter((wf) => wf.scope === "per-bot" && wf.appliesToPersonas.includes(personaKey));
}

/** System-wide (bot-less) workflows. */
export function systemWorkflows(): WorkflowDefinition[] {
  return Array.from(REGISTRY.values()).filter((wf) => wf.scope === "system-wide");
}
