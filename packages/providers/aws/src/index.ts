// Public API of @cloudverse/provider-aws. Everything outside this file is internal.
import type { ProviderAdapter } from '@cloudverse/core';
import { AWS_CONTAINERS } from './containers.ts';
import { relateAws } from './relations.ts';
import { awsRole } from './roles.ts';

const adapter: ProviderAdapter = {
  id: 'aws',
  describe({ type, values }) {
    const role = awsRole(type);
    const region = values.region;
    return typeof region === 'string' && region !== '' ? { role, scope: { kind: 'region', id: region } } : { role };
  },
  relate: relateAws,
  containers: AWS_CONTAINERS,
};

/**
 * Teaches the core about AWS: roles from a table, the region as scope (IAM has none, so it
 * lands in the Global group), containers such as VPC and subnet, and semantic edges.
 */
export const awsAdapter: ProviderAdapter = Object.freeze(adapter);
export { awsRole } from './roles.ts';
