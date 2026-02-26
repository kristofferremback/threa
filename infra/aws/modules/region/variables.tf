variable "aws_region" {
  description = "AWS region for this bucket"
  type        = string
}

variable "account_suffix" {
  description = "Suffix to distinguish AWS accounts (e.g. friends, prod)"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}
