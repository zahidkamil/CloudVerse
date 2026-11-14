import type { Role, Scope } from './model.ts';

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

/**
 * Teaches the core about one cloud provider. Implement this in a provider package
 * (which depends only on core) and pass it to `ingestPlan`; the core never changes.
 */
export interface ProviderAdapter {
  /** Normalized provider id this adapter handles, e.g. `aws`. */
  readonly id: string;
  describe(resource: ResourceInfo): ResourceDescription;
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
