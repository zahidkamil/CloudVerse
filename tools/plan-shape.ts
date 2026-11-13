// Structural check for `terraform show -json` plan output.
//
// This is deliberately shallow: it confirms a file looks like a Terraform plan so
// fixtures cannot silently rot. The real, typed parser lives in @cloudverse/core
// (Task 2). This module has no Node dependencies so browser-like tests can use it.

export interface ShapeIssue {
  path: string;
  message: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function validatePlanShape(plan: unknown): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isObject(plan)) {
    add('$', 'plan must be a JSON object');
    return issues;
  }

  for (const key of ['format_version', 'terraform_version'] as const) {
    if (typeof plan[key] !== 'string') add(key, 'must be a string');
  }
  if (!isObject(plan.planned_values)) add('planned_values', 'must be an object');

  const configuration = plan.configuration;
  if (!isObject(configuration) || !isObject(configuration.root_module)) {
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

/** Addresses of every resource in the plan, in plan order. */
export function listPlanAddresses(plan: unknown): string[] {
  if (!isObject(plan) || !Array.isArray(plan.resource_changes)) return [];
  return plan.resource_changes.flatMap((entry: unknown) =>
    isObject(entry) && typeof entry.address === 'string' ? [entry.address] : [],
  );
}
