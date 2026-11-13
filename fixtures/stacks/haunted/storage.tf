resource "aws_s3_bucket" "crypt" {
  bucket = "cursed-crypt-example-records"

  tags = {
    Name = "cursed-crypt"
    Data = "sensitive"
  }
}

resource "aws_s3_bucket_public_access_block" "crypt" {
  bucket = aws_s3_bucket.crypt.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}
