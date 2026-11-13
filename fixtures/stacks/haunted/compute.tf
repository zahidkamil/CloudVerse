resource "aws_iam_role" "mansion_spirit" {
  name = "mansion-spirit"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "sts:AssumeRole"
        Principal = { Service = "ec2.amazonaws.com" }
      }
    ]
  })
}

resource "aws_iam_role_policy" "mansion_spirit_access" {
  name = "mansion-spirit-access"
  role = aws_iam_role.mansion_spirit.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:*"
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "mansion" {
  name = "mansion-profile"
  role = aws_iam_role.mansion_spirit.name
}

resource "aws_instance" "mansion" {
  ami                         = "ami-0123456789abcdef0"
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.graveyard.id
  vpc_security_group_ids      = [aws_security_group.mansion_gate.id]
  iam_instance_profile        = aws_iam_instance_profile.mansion.name
  associate_public_ip_address = true

  tags = {
    Name = "haunted-mansion"
  }
}
