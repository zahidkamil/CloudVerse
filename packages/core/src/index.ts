// Public API of @cloudverse/core. Everything outside this file is internal.
//
// Provider-neutral infrastructure graph, Terraform plan ingest, and redaction.
// Runs in browsers: no Node built-ins, no network, no file system.
export { genericAdapter, providerIdFromName } from './adapter.ts';
export type { ProviderAdapter, ResourceDescription, ResourceInfo } from './adapter.ts';
export { createGraph, GraphError } from './graph.ts';
export type { Graph } from './graph.ts';
export { ingestPlan, ingestPlanObject } from './ingest.ts';
export type { Diagnostic, IngestOptions, IngestResult } from './ingest.ts';
export { ROLES } from './model.ts';
export type { Assertion, Evidence, GraphEdge, GraphNode, Role, Scope } from './model.ts';
export { IngestError, parsePlan, validatePlan } from './plan.ts';
export type { IngestErrorCode, PlanIssue, TerraformPlan } from './plan.ts';
export { REDACTED, redactSensitive } from './redact.ts';
