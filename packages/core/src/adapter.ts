import type { Graph } from './graph.ts';
import type { Evidence, Role, Scope } from './model.ts';

/** What an adapter is shown about a resource. */
export interface ResourceInfo {
  readonly address: string;
  readonly type: string;
  readonly name: string;
  /** Normalized provider id, e.g. `aws`. */
  readonly provider: string;
  /** Planned attribute values (redacted). */
  readonly values: Readonly<Record<string, unknown>>;
}

/** What an adapter decides about a resource. Anything omitted gets a sensible default. */
export interface ResourceDescription {
  readonly role: Role;
  readonly label?: string;
  readonly scope?: Scope;
}

/** A type that can contain a resource, optionally only when reached through one attribute. */
export interface ContainerRule {
  /** Terraform resource type of the container, e.g. `aws_subnet`. */
  readonly type: string;
  /** Only follow first-hop references made by this attribute, e.g. `subnet_id`. */
  readonly via?: string;
}

/** An inferred edge proposed by an adapter. Core adds the `inferred` assertion. */
export interface DerivedEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  /** At least one entry; says which nodes and attributes the edge came from. */
  readonly evidence: readonly Evidence[];
}

/**
 * Teaches the core about one cloud provider. Implement this in a provider package
 * (which depends only on core) and pass it to `ingestPlan`; the core never changes.
 */
export interface ProviderAdapter {
  /** Normalized provider id this adapter handles, e.g. `aws`. */
  readonly id: string;
  describe(resource: ResourceInfo): ResourceDescription;
  /**
   * Optional. Derive inferred edges from the declared graph. Read declared evidence
   * (`edge.evidence[].data.path`), not names or tags.
   */
  relate?(graph: Graph): readonly DerivedEdge[];
  /**
   * Optional. For each resource type, the container types in priority order. The first
   * rule that finds a node wins (the nearest one, up to three declared edges away).
   * Resources without a match go to their scope group.
   */
  readonly containers?: Readonly<Record<string, readonly ContainerRule[]>>;
}

/** Used for any provider without an adapter, so every resource still appears. */
export const genericAdapter: ProviderAdapter = Object.freeze({
  id: 'generic',
  describe: () => ({ role: 'unknown' as const }),
});

const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  azurerm: 'azure',
  azapi: 'azure',
  google: 'gcp',
  'google-beta': 'gcp',
};

/**
 * `registry.terraform.io/hashicorp/aws` -> `aws`, `.../hashicorp/azurerm` -> `azure`,
 * `.../hashicorp/google` -> `gcp`. Other providers keep their own name.
 */
export function providerIdFromName(providerName: string): string {
  const last = providerName.split('/').pop() ?? providerName;
  return PROVIDER_ALIASES[last] ?? last;
}
