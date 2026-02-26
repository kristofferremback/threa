variable "account_suffix" {
  description = "Suffix to distinguish AWS accounts (e.g. friends, prod)"
  type        = string
  default     = "friends"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}
