/**
 * Capability Economics — Palantir Foundry connection config + Project RIDs.
 *
 * Token + URL are read from env at call time so they can be rotated without
 * code changes. Set FOUNDRY_BASE_URL + FOUNDRY_TOKEN as Replit Secrets.
 */

export const FOUNDRY = {
  get baseUrl(): string {
    const v = process.env.FOUNDRY_BASE_URL;
    if (!v) throw new Error("FOUNDRY_BASE_URL env var not set");
    return v.replace(/\/$/, "");
  },
  get token(): string {
    const v = process.env.FOUNDRY_TOKEN;
    if (!v) throw new Error("FOUNDRY_TOKEN env var not set");
    return v;
  },
};

// User's personal Ontology — where ce.* Object Types will live.
export const ONTOLOGY = {
  apiName: "ontology-2af33f90-7f4f-4551-9f6a-e587e0605403",
  rid: "ri.ontology.main.ontology.84e2e319-c566-4304-a12a-8dbb05224f4f",
} as const;

// Capability Economics Compass Project (folder).
export const CE_PROJECT_RID = "ri.compass.main.folder.0b7baf38-d7f4-4413-aa27-962236f947d2";

// Backing Datasets — one per Object Type. Created 2026-04-25.
export const DATASETS = {
  industries:    "ri.foundry.main.dataset.79a03fdf-4957-43eb-afa5-3ab9c2a25a1b",
  capabilities:  "ri.foundry.main.dataset.b264ca80-6710-478d-bbdf-af1fa880a5d7",
  companies:     "ri.foundry.main.dataset.21c774cd-6430-459b-b392-61d58cf9cc72",
  quadrants:     "ri.foundry.main.dataset.df7edf67-f158-4125-8683-43d4dc83d73c",
  economics:     "ri.foundry.main.dataset.f2d9b413-b03b-4504-89e9-a54c7ad4e959",
  valueChain:    "ri.foundry.main.dataset.cb23a839-afc4-43f5-81bc-34e5bac376c1",
  dependencies:  "ri.foundry.main.dataset.57ad3ace-a39b-4b44-b63f-592f1e23f3f7",
} as const;
