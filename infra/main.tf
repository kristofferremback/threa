# Threa Infrastructure
#
# Minimal ECS Fargate setup for eu-central-1.
# Designed to be simple, cheap, and easy to grow.
#
# Usage:
#   cd infra
#   terraform init
#   terraform plan
#   terraform apply

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment to use S3 backend for state (recommended for team usage)
  # backend "s3" {
  #   bucket         = "threa-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "eu-central-1"
  #   encrypt        = true
  #   dynamodb_table = "threa-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "threa"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Use default VPC for simplicity (can be replaced with custom VPC later)
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_caller_identity" "current" {}
