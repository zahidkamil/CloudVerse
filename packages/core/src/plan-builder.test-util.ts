// Test helper: builds small synthetic Terraform plans. Not part of the public API.

export interface ResSpec {
  type: string;
  name: string;
  /** Full provider source, default registry.terraform.io/hashicorp/aws */
  provider?: string;
  /** Child module name; the resource lives at module.<module>.<type>.<name>. */
  module?: string;
  /** count/for_each index of this instance. */
  index?: number | string;
  /** Attribute name -> list of reference strings, as Terraform writes them. */
  refs?: Record<string, string[]>;
  dependsOn?: string[];
  /** Planned `after` values. */
  after?: Record<string, unknown>;
  afterSensitive?: unknown;
  mode?: 'managed' | 'data';
}

const AWS = 'registry.terraform.io/hashicorp/aws';

export function addressOf(spec: ResSpec): string {
  const prefix = spec.module ? `module.${spec.module}.` : '';
  const index = spec.index === undefined ? '' : typeof spec.index === 'number' ? `[${spec.index}]` : `[${JSON.stringify(spec.index)}]`;
  return `${prefix}${spec.type}.${spec.name}${index}`;
}

export function makePlan(specs: ResSpec[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const resourceChanges = specs.map((spec) => ({
    address: addressOf(spec),
    mode: spec.mode ?? 'managed',
    type: spec.type,
    name: spec.name,
    provider_name: spec.provider ?? AWS,
    change: {
      actions: ['create'],
      before: null,
      after: spec.after ?? {},
      after_unknown: {},
      before_sensitive: false,
      after_sensitive: spec.afterSensitive ?? {},
    },
  }));

  // One configuration resource per base address (first spec wins).
  const configured = new Map<string, ResSpec>();
  for (const spec of specs) {
    const key = `${spec.module ?? ''}|${spec.type}.${spec.name}`;
    if (!configured.has(key)) configured.set(key, spec);
  }

  const toConfig = (spec: ResSpec) => ({
    address: `${spec.type}.${spec.name}`,
    mode: spec.mode ?? 'managed',
    type: spec.type,
    name: spec.name,
    expressions: Object.fromEntries(Object.entries(spec.refs ?? {}).map(([attr, references]) => [attr, { references }])),
    ...(spec.dependsOn ? { depends_on: spec.dependsOn } : {}),
  });

  const rootResources = [...configured.values()].filter((spec) => !spec.module).map(toConfig);
  const moduleCalls: Record<string, { module: { resources: ReturnType<typeof toConfig>[] } }> = {};
  for (const spec of configured.values()) {
    if (!spec.module) continue;
    (moduleCalls[spec.module] ??= { module: { resources: [] } }).module.resources.push(toConfig(spec));
  }

  return {
    format_version: '1.2',
    terraform_version: '1.16.0',
    planned_values: { root_module: {} },
    resource_changes: resourceChanges,
    configuration: { root_module: { resources: rootResources, module_calls: moduleCalls } },
    ...overrides,
  };
}
