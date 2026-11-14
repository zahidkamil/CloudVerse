import type { ContainerRule } from '@cloudverse/core';

// Which resource types contain which. The first rule that finds a node wins (see core's
// `buildHierarchy`). `via` names the attribute that must make the first reference, which
// keeps resources with several references (such as a rule that names two security groups)
// under the right parent.

const in_ = (type: string, via?: string): ContainerRule => (via ? { type, via } : { type });
const vpc = in_('aws_vpc');

export const AWS_CONTAINERS: Readonly<Record<string, readonly ContainerRule[]>> = {
  aws_subnet: [vpc],
  aws_security_group: [vpc],
  aws_route_table: [vpc],
  aws_internet_gateway: [vpc],
  aws_network_acl: [vpc],
  aws_lb_target_group: [vpc],
  aws_lb: [vpc],
  aws_db_subnet_group: [vpc],
  aws_db_instance: [vpc], // spans a subnet group, so it sits at VPC level
  aws_instance: [in_('aws_subnet', 'subnet_id'), vpc],
  aws_nat_gateway: [in_('aws_subnet', 'subnet_id'), vpc],
  aws_vpc_security_group_ingress_rule: [in_('aws_security_group', 'security_group_id')],
  aws_vpc_security_group_egress_rule: [in_('aws_security_group', 'security_group_id')],
  aws_route: [in_('aws_route_table', 'route_table_id')],
  aws_route_table_association: [in_('aws_route_table', 'route_table_id')],
  aws_lb_listener: [in_('aws_lb', 'load_balancer_arn')],
  aws_lb_target_group_attachment: [in_('aws_lb_target_group', 'target_group_arn')],
  aws_s3_bucket_public_access_block: [in_('aws_s3_bucket', 'bucket')],
  aws_s3_bucket_policy: [in_('aws_s3_bucket', 'bucket')],
  aws_iam_role_policy: [in_('aws_iam_role', 'role')],
  aws_iam_role_policy_attachment: [in_('aws_iam_role', 'role')],
};
