import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from './adapter.ts';
import { ingestPlan, ingestPlanObject } from './ingest.ts';
import { REDACTED } from './redact.ts';
import { IngestError } from './plan.ts';
import { makePlan, type ResSpec } from './plan-builder.test-util.ts';

// These run in jsdom so we know ingest works in a browser-like environment.
const AZURE = 'registry.terraform.io/hashicorp/azurerm';
const GOOGLE = 'registry.terraform.io/hashicorp/google';

const vpc: ResSpec = { type: 'aws_vpc', name: 'main', after: { region: 'us-east-1', tags: { Name: 'main-vpc' } } };
const subnet: ResSpec = {
  type: 'aws_subnet',
  name: 'a',
  refs: { vpc_id: ['aws_vpc.main.id', 'aws_vpc.main'] },
};

const edgeIds = (result: { graph: { edges: readonly { id: string }[] } }) => result.graph.edges.map((e) => e.id);

describe('ingest: nodes', () => {
  it('creates one node per managed resource with provider-neutral fields', () => {
    const { graph } = ingestPlanObject(makePlan([vpc, subnet]));
    expect(graph.nodes.map((n) => n.id)).toEqual(['aws_vpc.main', 'aws_subnet.a']);
    expect(graph.node('aws_vpc.main')).toMatchObject({
      provider: 'aws',
      providerType: 'aws_vpc',
      name: 'main',
      label: 'main-vpc',
      role: 'unknown',
      actions: ['create'],
    });
    expect(graph.node('aws_subnet.a')?.label).toBe('a');
  });

  it('skips data sources', () => {
    const { graph } = ingestPlanObject(makePlan([vpc, { type: 'aws_ami', name: 'x', mode: 'data' }]));
    expect(graph.nodes.map((n) => n.id)).toEqual(['aws_vpc.main']);
  });

  it('uses before values for resources being deleted', () => {
    const plan = makePlan([vpc]) as { resource_changes: { change: Record<string, unknown> }[] };
    const change = plan.resource_changes[0]!.change;
    change.actions = ['delete'];
    change.before = { region: 'eu-west-1' };
    change.after = null;
    const node = ingestPlanObject(plan).graph.node('aws_vpc.main');
    expect(node?.attrs).toEqual({ region: 'eu-west-1' });
    expect(node?.actions).toEqual(['delete']);
  });

  it('is immutable', () => {
    const { graph } = ingestPlanObject(makePlan([vpc]));
    expect(() => {
      (graph.nodes[0] as { label: string }).label = 'x';
    }).toThrow(TypeError);
  });
});

describe('ingest: edges', () => {
  it('creates a declared reference edge with evidence, merging both reference forms', () => {
    const { graph } = ingestPlanObject(makePlan([vpc, subnet]));
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0]!;
    expect(edge).toMatchObject({ from: 'aws_subnet.a', to: 'aws_vpc.main', kind: 'reference', assertion: 'declared' });
    expect(edge.evidence).toHaveLength(1);
    expect(edge.evidence[0]?.summary).toBe('aws_subnet.a vpc_id references aws_vpc.main.id');
  });

  it('keeps separate evidence for separate attributes of the same pair', () => {
    const instance: ResSpec = { type: 'aws_instance', name: 'i', refs: { subnet_id: ['aws_subnet.a.id'], vpc_id: ['aws_subnet.a.vpc_id'] } };
    const { graph } = ingestPlanObject(makePlan([vpc, subnet, instance]));
    const edge = graph.edges.find((e) => e.from === 'aws_instance.i');
    expect(edge?.evidence.map((e) => e.summary)).toEqual([
      'aws_instance.i subnet_id references aws_subnet.a.id',
      'aws_instance.i vpc_id references aws_subnet.a.vpc_id',
    ]);
  });

  it('adds depends_on edges', () => {
    const waiter: ResSpec = { type: 'aws_instance', name: 'w', dependsOn: ['aws_vpc.main'] };
    const { graph } = ingestPlanObject(makePlan([vpc, waiter]));
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'aws_instance.w', to: 'aws_vpc.main', kind: 'depends_on', assertion: 'declared' });
  });

  it('ignores variables, locals, data sources, and self references', () => {
    const odd: ResSpec = {
      type: 'aws_instance',
      name: 'o',
      refs: { a: ['var.x'], b: ['local.y'], c: ['data.aws_ami.z.id'], d: ['each.value'], e: ['aws_instance.o.id'] },
    };
    const result = ingestPlanObject(makePlan([odd]));
    expect(result.graph.edges).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports references to resources that are not in the plan, once', () => {
    const lonely: ResSpec = { type: 'aws_instance', name: 'l', refs: { a: ['aws_vpc.gone.id', 'aws_vpc.gone'] } };
    const result = ingestPlanObject(makePlan([lonely]));
    expect(result.graph.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: 'unresolved-reference', message: 'aws_instance.l refers to aws_vpc.gone, which is not in the plan.' },
    ]);
  });

  it('reports module output references without creating edges', () => {
    const user: ResSpec = { type: 'aws_instance', name: 'u', refs: { a: ['module.net.vpc_id'] } };
    const result = ingestPlanObject(makePlan([user]));
    expect(result.graph.edges).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('module-output-reference');
  });

  it('finds references in nested blocks', () => {
    const plan = makePlan([
      { type: 'aws_lb_target_group', name: 't' },
      { type: 'aws_lb_listener', name: 'l' },
    ]) as { configuration: { root_module: { resources: { name: string; expressions: Record<string, unknown> }[] } } };
    const listener = plan.configuration.root_module.resources.find((r) => r.name === 'l')!;
    listener.expressions.default_action = [{ target_group_arn: { references: ['aws_lb_target_group.t.arn'] } }];
    const { graph } = ingestPlanObject(plan);
    expect(graph.edges[0]?.evidence[0]?.summary).toBe('aws_lb_listener.l default_action[0].target_group_arn references aws_lb_target_group.t.arn');
  });

  it('expands count and for_each instances and marks the evidence', () => {
    const targets: ResSpec[] = [
      { type: 'aws_subnet', name: 's', index: 0 },
      { type: 'aws_subnet', name: 's', index: 1 },
    ];
    const sources: ResSpec[] = [
      { type: 'aws_instance', name: 'i', index: 'a.b', refs: { subnet_id: ['aws_subnet.s.id'] } },
      { type: 'aws_instance', name: 'i', index: 'c', refs: { subnet_id: ['aws_subnet.s.id'] } },
    ];
    const result = ingestPlanObject(makePlan([...targets, ...sources]));
    expect(edgeIds(result).sort()).toEqual(
      [
        'aws_instance.i["a.b"]->aws_subnet.s[0]:reference',
        'aws_instance.i["a.b"]->aws_subnet.s[1]:reference',
        'aws_instance.i["c"]->aws_subnet.s[0]:reference',
        'aws_instance.i["c"]->aws_subnet.s[1]:reference',
      ].sort(),
    );
    expect(result.graph.edges.every((e) => e.evidence[0]?.data?.expanded === true)).toBe(true);
    expect(result.graph.node('aws_subnet.s[0]')?.baseAddress).toBe('aws_subnet.s');
  });

  it('resolves references inside child modules relative to the module', () => {
    const inner: ResSpec[] = [
      { type: 'aws_vpc', name: 'v', module: 'net' },
      { type: 'aws_subnet', name: 's', module: 'net', refs: { vpc_id: ['aws_vpc.v.id'] } },
    ];
    const outer: ResSpec = { type: 'aws_vpc', name: 'v' };
    const result = ingestPlanObject(makePlan([outer, ...inner]));
    expect(edgeIds(result)).toEqual(['module.net.aws_subnet.s->module.net.aws_vpc.v:reference']);
  });
});

describe('ingest: providers', () => {
  const awsAdapter: ProviderAdapter = {
    id: 'aws',
    describe: ({ values }) => ({
      role: 'unknown',
      label: 'custom-label',
      scope: { kind: 'region', id: String(values.region) },
    }),
  };

  it('uses a registered adapter for its provider', () => {
    const { graph } = ingestPlanObject(makePlan([vpc]), { adapters: [awsAdapter] });
    expect(graph.node('aws_vpc.main')).toMatchObject({ label: 'custom-label', scope: { kind: 'region', id: 'us-east-1' } });
  });

  it('falls back to the generic adapter for providers without one', () => {
    const azure: ResSpec = { type: 'azurerm_virtual_network', name: 'vnet', provider: AZURE };
    const { graph } = ingestPlanObject(makePlan([vpc, azure]), { adapters: [awsAdapter] });
    expect(graph.node('azurerm_virtual_network.vnet')).toMatchObject({ provider: 'azure', role: 'unknown', label: 'vnet' });
    expect(graph.node('azurerm_virtual_network.vnet')?.scope).toBeUndefined();
  });

  it('handles unsupported resource types of a supported provider', () => {
    const exotic: ResSpec = { type: 'aws_totally_new_thing', name: 'x' };
    const { graph } = ingestPlanObject(makePlan([exotic]));
    expect(graph.node('aws_totally_new_thing.x')).toMatchObject({ provider: 'aws', role: 'unknown' });
  });

  it('puts several providers in one graph', () => {
    const specs: ResSpec[] = [
      vpc,
      { type: 'azurerm_virtual_network', name: 'vnet', provider: AZURE },
      { type: 'google_compute_network', name: 'net', provider: GOOGLE },
      { type: 'some_thing', name: 'x', provider: 'registry.terraform.io/acme/custom' },
    ];
    const { graph } = ingestPlanObject(makePlan(specs));
    expect(graph.nodes.map((n) => n.provider)).toEqual(['aws', 'azure', 'gcp', 'custom']);
  });

  it('creates a cross-provider edge only from an explicit reference, with evidence', () => {
    const gateway: ResSpec = {
      type: 'aws_customer_gateway',
      name: 'cgw',
      refs: { ip_address: ['azurerm_public_ip.vpn.ip_address'] },
    };
    const ip: ResSpec = { type: 'azurerm_public_ip', name: 'vpn', provider: AZURE };
    const { graph } = ingestPlanObject(makePlan([gateway, ip]));
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0]!;
    expect(graph.node(edge.from)?.provider).toBe('aws');
    expect(graph.node(edge.to)?.provider).toBe('azure');
    expect(edge.evidence.length).toBeGreaterThan(0);
  });

  it('never links nodes from different providers by name, tag, or proximity', () => {
    const a: ResSpec = { type: 'aws_vpc', name: 'shared', after: { tags: { Name: 'shared' } } };
    const b: ResSpec = { type: 'azurerm_virtual_network', name: 'shared', provider: AZURE, after: { tags: { Name: 'shared' } } };
    expect(ingestPlanObject(makePlan([a, b])).graph.edges).toEqual([]);
  });
});

describe('ingest: redaction', () => {
  const secret: ResSpec = {
    type: 'aws_db_instance',
    name: 'db',
    after: { username: 'admin', blob: 'hunter2' },
    afterSensitive: { blob: true },
  };

  it('redacts by default, before the graph is built', () => {
    const { graph } = ingestPlanObject(makePlan([secret]));
    expect(graph.node('aws_db_instance.db')?.attrs).toEqual({ username: 'admin', blob: REDACTED });
  });

  it('can be turned off', () => {
    const { graph } = ingestPlanObject(makePlan([secret]), { redact: false });
    expect(graph.node('aws_db_instance.db')?.attrs.blob).toBe('hunter2');
  });
});

describe('ingest: inputs and errors', () => {
  const plan = makePlan([vpc, subnet]);
  const text = JSON.stringify(plan);

  it('accepts a string, a Blob, a File, and a parsed object, with identical results', async () => {
    const fromString = await ingestPlan(text);
    const fromBlob = await ingestPlan(new Blob([text], { type: 'application/json' }));
    const fromFile = await ingestPlan(new File([text], 'plan.json'));
    const fromObject = await ingestPlan(plan);
    for (const other of [fromBlob, fromFile, fromObject]) {
      expect(other.graph.nodes).toEqual(fromString.graph.nodes);
      expect(other.graph.edges).toEqual(fromString.graph.edges);
    }
    expect(fromString.terraformVersion).toBe('1.16.0');
  });

  const failure = async (input: string | object) => {
    try {
      await ingestPlan(input);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('rejects invalid JSON with a user-facing message', async () => {
    const error = await failure('{ not json');
    expect(error).toBeInstanceOf(IngestError);
    expect(error).toMatchObject({ code: 'invalid-json' });
    expect((error as Error).message).toMatch(/not valid JSON/);
  });

  it('rejects JSON that is not a plan and says how to create one', async () => {
    for (const input of ['[]', '42', 'null', '"text"', '{"hello":"world"}']) {
      const error = await failure(input);
      expect(error).toMatchObject({ code: 'not-a-plan' });
      expect((error as Error).message).toMatch(/terraform show -json/);
    }
  });

  it('rejects state files with a clear code', async () => {
    const state = { format_version: '1.0', terraform_version: '1.16.0', values: { root_module: { resources: [] } } };
    const error = await failure(state);
    expect(error).toMatchObject({ code: 'state-not-supported' });
    expect((error as Error).message).toMatch(/state/i);
  });

  it('rejects plans with duplicate addresses', async () => {
    const error = await failure(makePlan([vpc, vpc]));
    expect(error).toMatchObject({ code: 'not-a-plan' });
    expect((error as Error).message).toMatch(/duplicate address/);
  });
});
