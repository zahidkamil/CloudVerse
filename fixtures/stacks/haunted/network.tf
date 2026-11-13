resource "aws_vpc" "kingdom" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "haunted-kingdom"
  }
}

resource "aws_internet_gateway" "gate" {
  vpc_id = aws_vpc.kingdom.id

  tags = {
    Name = "haunted-gate"
  }
}

resource "aws_subnet" "graveyard" {
  vpc_id                  = aws_vpc.kingdom.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true

  tags = {
    Name = "graveyard-public"
  }
}

resource "aws_subnet" "crypt_a" {
  vpc_id            = aws_vpc.kingdom.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1a"

  tags = {
    Name = "crypt-private-a"
  }
}

resource "aws_subnet" "crypt_b" {
  vpc_id            = aws_vpc.kingdom.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "us-east-1b"

  tags = {
    Name = "crypt-private-b"
  }
}

resource "aws_route_table" "graveyard_road" {
  vpc_id = aws_vpc.kingdom.id

  tags = {
    Name = "graveyard-road"
  }
}

resource "aws_route" "graveyard_internet" {
  route_table_id         = aws_route_table.graveyard_road.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.gate.id
}

resource "aws_route_table_association" "graveyard" {
  subnet_id      = aws_subnet.graveyard.id
  route_table_id = aws_route_table.graveyard_road.id
}

resource "aws_security_group" "mansion_gate" {
  name        = "mansion-gate"
  description = "Traffic rules for the mansion web server"
  vpc_id      = aws_vpc.kingdom.id
}

resource "aws_vpc_security_group_ingress_rule" "mansion_ssh" {
  security_group_id = aws_security_group.mansion_gate.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "mansion_http" {
  security_group_id = aws_security_group.mansion_gate.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "mansion_out" {
  security_group_id = aws_security_group.mansion_gate.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "tomb_ward" {
  name        = "tomb-ward"
  description = "Traffic rules for the database"
  vpc_id      = aws_vpc.kingdom.id
}

resource "aws_vpc_security_group_ingress_rule" "tomb_from_mansion" {
  security_group_id            = aws_security_group.tomb_ward.id
  referenced_security_group_id = aws_security_group.mansion_gate.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
