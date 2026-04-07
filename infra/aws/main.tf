terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket  = "threa-terraform-state-friends"
    key     = "infra/aws/terraform.tfstate"
    region  = "eu-north-1"
    encrypt = true
    profile = "threa"
  }
}

# --- Providers: one per region ---
# To add a region, add a provider alias and a module call below.

provider "aws" {
  region  = "eu-north-1"
  profile = "threa"
}

# provider "aws" {
#   alias   = "us_east_1"
#   region  = "us-east-1"
#   profile = "threa"
# }

# --- Regional infrastructure ---

module "eu_north_1" {
  source = "./modules/region"

  aws_region     = "eu-north-1"
  account_suffix = var.account_suffix
  environment    = var.environment
}

# module "us_east_1" {
#   source    = "./modules/region"
#   providers = { aws = aws.us_east_1 }
#
#   aws_region     = "us-east-1"
#   account_suffix = var.account_suffix
#   environment    = var.environment
# }

# --- IAM User for Backend Access (global) ---
# Policy uses a wildcard pattern so it automatically covers new regional buckets.

resource "aws_iam_user" "backend" {
  name = "threa-backend-${var.environment}"

  tags = {
    Environment = var.environment
    Project     = "threa"
  }
}

resource "aws_iam_user_policy" "backend_s3" {
  name = "threa-s3-access"
  user = aws_iam_user.backend.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "arn:aws:s3:::threa-uploads-*-${var.account_suffix}/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::threa-uploads-*-${var.account_suffix}"
      },
    ]
  })
}

# --- MediaConvert ---
# IAM role that MediaConvert assumes to read source files and write transcoded output to S3.

resource "aws_iam_role" "mediaconvert" {
  name = "threa-mediaconvert-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "mediaconvert.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Environment = var.environment
    Project     = "threa"
  }
}

resource "aws_iam_role_policy" "mediaconvert_s3" {
  name = "threa-mediaconvert-s3"
  role = aws_iam_role.mediaconvert.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
      ]
      Resource = "arn:aws:s3:::threa-uploads-*-${var.account_suffix}/*"
    }]
  })
}

# Backend user permissions for MediaConvert API calls.

resource "aws_iam_user_policy" "backend_mediaconvert" {
  name = "threa-mediaconvert-access"
  user = aws_iam_user.backend.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "mediaconvert:CreateJob",
          "mediaconvert:GetJob",
          "mediaconvert:DescribeEndpoints",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.mediaconvert.arn
      },
    ]
  })
}

resource "aws_iam_access_key" "backend" {
  user = aws_iam_user.backend.name
}
