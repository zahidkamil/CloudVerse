resource "aws_db_subnet_group" "tomb" {
  name       = "tomb-subnets"
  subnet_ids = [aws_subnet.crypt_a.id, aws_subnet.crypt_b.id]
}

resource "aws_db_instance" "tomb" {
  identifier                  = "haunted-tomb"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = "db.t3.micro"
  allocated_storage           = 20
  username                    = "tomb_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.tomb.name
  vpc_security_group_ids      = [aws_security_group.tomb_ward.id]
  publicly_accessible         = false
  storage_encrypted           = true
  skip_final_snapshot         = true
}
