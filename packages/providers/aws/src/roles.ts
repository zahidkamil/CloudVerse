import type { Role } from '@cloudverse/core';

// Table-driven AWS classification. To support a new resource type, add a line here.
// Exact types win; then the first matching prefix; otherwise 'unknown'.

const EXACT: Readonly<Record<string, Role>> = {
  // compute
  aws_instance: 'compute',
  aws_launch_template: 'compute',
  aws_autoscaling_group: 'compute',
  aws_lambda_function: 'compute',
  aws_ecs_service: 'compute',
  aws_ecs_task_definition: 'compute',
  aws_eks_cluster: 'compute',
  // object-storage
  aws_s3_bucket: 'object-storage',
  // database
  aws_db_instance: 'database',
  aws_rds_cluster: 'database',
  aws_rds_cluster_instance: 'database',
  aws_dynamodb_table: 'database',
  aws_elasticache_cluster: 'database',
  // identity
  aws_s3_bucket_policy: 'identity',
  // network-container and subnet
  aws_vpc: 'network-container',
  aws_subnet: 'subnet',
  // traffic-filter: decides what may reach a resource
  aws_security_group: 'traffic-filter',
  aws_security_group_rule: 'traffic-filter',
  aws_network_acl: 'traffic-filter',
  aws_network_acl_rule: 'traffic-filter',
  aws_s3_bucket_public_access_block: 'traffic-filter',
  // gateway: a way in or out
  aws_internet_gateway: 'gateway',
  aws_nat_gateway: 'gateway',
  aws_vpn_gateway: 'gateway',
  aws_lb: 'gateway',
  aws_alb: 'gateway',
  // connectivity: plumbing
  aws_route: 'connectivity',
  aws_route_table: 'connectivity',
  aws_route_table_association: 'connectivity',
  aws_db_subnet_group: 'connectivity',
  aws_lb_listener: 'connectivity',
  aws_lb_target_group: 'connectivity',
  aws_lb_target_group_attachment: 'connectivity',
  aws_vpc_endpoint: 'connectivity',
  aws_vpc_peering_connection: 'connectivity',
};

const PREFIXES: readonly (readonly [prefix: string, role: Role])[] = [
  ['aws_vpc_security_group_', 'traffic-filter'],
  ['aws_iam_', 'identity'],
];

/** The role for an AWS resource type. Always returns a role; unknown types get 'unknown'. */
export function awsRole(type: string): Role {
  const exact = Object.hasOwn(EXACT, type) ? EXACT[type] : undefined;
  if (exact) return exact;
  return PREFIXES.find(([prefix]) => type.startsWith(prefix))?.[1] ?? 'unknown';
}
