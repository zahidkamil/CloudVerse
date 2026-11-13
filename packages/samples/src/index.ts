// Public API of @cloudverse/samples.
//
// Sanitized Terraform plan JSON bundled with the apps so visitors can explore
// CloudVerse without installing Terraform or uploading anything.
//
// Samples are discovered automatically: every directory under ../data containing
// plan.json, meta.json and snippets.json becomes a sample. To add one, generate it
// with `pnpm fixtures:generate <stack>` (see docs/using-your-terraform.md). No code
// changes are needed. This package never touches the network or the file system at
// runtime: the bundler inlines the data.

export interface SampleMeta {
  /** Stable identifier, also the directory name under data/. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** True when produced by a real `terraform plan`, false when hand-written. */
  readonly generated: boolean;
  readonly terraformVersion: string;
  /** Provider source address to exact version, e.g. "hashicorp/aws": "6.73.0". */
  readonly providers: Readonly<Record<string, string>>;
}

export interface Sample extends SampleMeta {
  /** Output of `terraform show -json <planfile>`. Parsed by @cloudverse/core (Task 2). */
  readonly plan: unknown;
  /** HCL source of each resource block, keyed by Terraform resource address. */
  readonly snippets: Readonly<Record<string, string>>;
}

// Vite requires glob options to be inline literals so it can analyze them statically.
const metaFiles = import.meta.glob<SampleMeta>('../data/*/meta.json', { eager: true, import: 'default' });
const planFiles = import.meta.glob<unknown>('../data/*/plan.json', { eager: true, import: 'default' });
const snippetFiles = import.meta.glob<Record<string, string>>('../data/*/snippets.json', {
  eager: true,
  import: 'default',
});

function load(metaPath: string, meta: SampleMeta): Sample {
  const plan = planFiles[metaPath.replace('meta.json', 'plan.json')];
  const snippets = snippetFiles[metaPath.replace('meta.json', 'snippets.json')];
  if (plan === undefined || snippets === undefined) {
    throw new Error(`Sample "${meta.id}" is incomplete: it needs plan.json, meta.json and snippets.json.`);
  }
  return Object.freeze({ ...meta, plan, snippets: Object.freeze({ ...snippets }) });
}

/** All bundled samples, ordered by id. */
export const samples: readonly Sample[] = Object.freeze(
  Object.entries(metaFiles)
    .map(([path, meta]) => load(path, meta))
    .sort((a, b) => a.id.localeCompare(b.id)),
);

export function getSample(id: string): Sample | undefined {
  return samples.find((sample) => sample.id === id);
}
