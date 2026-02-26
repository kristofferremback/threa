output "bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.uploads.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.uploads.arn
}

output "bucket_region" {
  description = "AWS region of the bucket"
  value       = var.aws_region
}
