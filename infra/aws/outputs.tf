output "eu_north_1" {
  description = "eu-north-1 regional infrastructure"
  value       = module.eu_north_1
}

output "iam_access_key_id" {
  description = "IAM access key for backend S3 access"
  value       = aws_iam_access_key.backend.id
  sensitive   = true
}

output "iam_secret_access_key" {
  description = "IAM secret key for backend S3 access"
  value       = aws_iam_access_key.backend.secret
  sensitive   = true
}

output "mediaconvert_role_arn" {
  description = "IAM role ARN for MediaConvert to access S3"
  value       = aws_iam_role.mediaconvert.arn
}
