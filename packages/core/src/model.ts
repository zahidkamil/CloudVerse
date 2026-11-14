// The provider-neutral vocabulary every CloudVerse package shares.

/**
 * What a resource does, independent of the cloud. Themes map roles (not resource
 * types) to visuals, so an unfamiliar resource still gets a sensible object.
 * Nodes carry 'unknown' until roles are assigned by provider adapters.
 */
export const ROLES = [
  'compute',
  'object-storage',
  'database',
  'identity',
  'network-container',
  'subnet',
  'traffic-filter',
  'gateway',
  'connectivity',
  'unknown',
] as const;

export type Role = (typeof ROLES)[number];

/** One line per role, written without naming any provider. */
export const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = Object.freeze({
  compute: 'Runs code.',
  'object-storage': 'Stores blobs of data.',
  database: 'Stores structured data.',
  identity: 'Decides who or what may act, and what they may do.',
  'network-container': 'A private network boundary.',
  subnet: 'A slice of a network.',
  'traffic-filter': 'Decides what may reach a resource.',
  gateway: 'A way into or out of a network or service.',
  connectivity: 'Plumbing that links things together.',
  unknown: 'No rule matched this resource type.',
});

/** A place a resource lives, such as a region. */
export interface Scope {
  readonly kind: string;
  readonly id: string;
}

export interface GraphNode {
  /** Full Terraform address, e.g. `module.net.aws_subnet.a["x"]`. Unique in a graph. */
  readonly id: string;
  /** Same as `id`. */
  readonly address: string;
  /** Address without `count`/`for_each` indexes; matches the configuration address. */
  readonly baseAddress: string;
  /** Normalized provider id: `aws`, `azure`, `gcp`, or the provider's own name. */
  readonly provider: string;
  /** Terraform resource type, e.g. `aws_instance`. */
  readonly providerType: string;
  /** Terraform resource name. */
  readonly name: string;
  /** Human-friendly name: adapter label, else `tags.Name`, else the resource name. */
  readonly label: string;
  readonly role: Role;
  readonly scope?: Scope;
  /** Planned actions: create, update, delete, no-op, ... */
  readonly actions: readonly string[];
  /** Planned attribute values (Terraform's `after`), already redacted. */
  readonly attrs: Readonly<Record<string, unknown>>;
}

/**
 * How strongly an edge is claimed.
 * - declared: stated in the Terraform configuration (a reference or depends_on)
 * - inferred: derived by a rule from configuration values
 * - modeled: produced by security analysis, always with evidence
 * Configured connectivity is never the same as confirmed reachability.
 */
export type Assertion = 'declared' | 'inferred' | 'modeled';

/** Why an edge exists. Every edge needs at least one. */
export interface Evidence {
  readonly kind: string;
  /** Human-readable explanation suitable for a UI. */
  readonly summary: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  /** `${from}->${to}:${kind}`. Unique in a graph. */
  readonly id: string;
  /** The dependent node. */
  readonly from: string;
  /** The node it depends on or relates to. */
  readonly to: string;
  readonly kind: string;
  readonly assertion: Assertion;
  readonly evidence: readonly Evidence[];
}
