// The parts of `terraform show -json <planfile>` that CloudVerse reads, plus validation.

export type IngestErrorCode = 'invalid-json' | 'not-a-plan' | 'state-not-supported';

/** The only error ingest throws. The message is written to be shown to a user. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
  }
}

export interface PlanChange {
  actions: string[];
  before?: unknown;
  after?: unknown;
  after_unknown?: unknown;
  before_sensitive?: unknown;
  after_sensitive?: unknown;
}

export interface PlanResourceChange {
  address: string;
  mode?: string;
  type: string;
  name: string;
  provider_name: string;
  change: PlanChange;
}

export interface PlanConfigResource {
  address: string;
  mode?: string;
  type: string;
  name: string;
  expressions?: Record<string, unknown>;
  depends_on?: string[];
}

export interface PlanConfigModule {
  resources?: PlanConfigResource[];
  module_calls?: Record<string, { module?: PlanConfigModule }>;
}

export interface TerraformPlan {
  format_version: string;
  terraform_version: string;
  resource_changes: PlanResourceChange[];
  configuration: { root_module: PlanConfigModule };
}

export interface PlanIssue {
  path: string;
  message: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Structural check that a value looks like `terraform show -json` plan output. */
export function validatePlan(plan: unknown): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isObject(plan)) {
    add('$', 'must be a JSON object');
    return issues;
  }

  for (const key of ['format_version', 'terraform_version'] as const) {
    if (typeof plan[key] !== 'string') add(key, 'must be a string');
  }
  if (!isObject(plan.configuration) || !isObject(plan.configuration.root_module)) {
    add('configuration.root_module', 'must be an object');
  }

  const changes = plan.resource_changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    add('resource_changes', 'must be a non-empty array');
    return issues;
  }

  const seen = new Set<string>();
  changes.forEach((entry: unknown, index) => {
    const at = `resource_changes[${index}]`;
    if (!isObject(entry)) {
      add(at, 'must be an object');
      return;
    }
    for (const key of ['address', 'type', 'name', 'provider_name'] as const) {
      if (typeof entry[key] !== 'string' || entry[key] === '') add(`${at}.${key}`, 'must be a non-empty string');
    }
    const change = entry.change;
    if (!isObject(change) || !Array.isArray(change.actions) || !change.actions.every((a) => typeof a === 'string')) {
      add(`${at}.change.actions`, 'must be an array of strings');
    }
    if (typeof entry.address === 'string') {
      if (seen.has(entry.address)) add(`${at}.address`, `duplicate address ${entry.address}`);
      seen.add(entry.address);
    }
  });

  return issues;
}

/** Validate a parsed value and return it typed, or throw an {@link IngestError}. */
export function parsePlan(value: unknown): TerraformPlan {
  if (isObject(value) && !('resource_changes' in value) && isObject(value.values)) {
    throw new IngestError(
      'state-not-supported',
      'This looks like a Terraform state file. State files are not supported yet; import a plan created with "terraform show -json <planfile>".',
    );
  }

  const issues = validatePlan(value);
  if (issues.length > 0) {
    const shown = issues
      .slice(0, 3)
      .map((issue) => `${issue.path} ${issue.message}`)
      .join('; ');
    throw new IngestError(
      'not-a-plan',
      `This is not a Terraform plan in JSON form (${shown}). Create one with "terraform plan -out=tfplan" and "terraform show -json tfplan".`,
    );
  }
  return value as TerraformPlan;
}
