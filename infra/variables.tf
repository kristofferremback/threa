# Variables for Threa infrastructure

variable "aws_region" {
  description = "AWS region to deploy to"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Environment name (e.g., prod, staging)"
  type        = string
  default     = "prod"
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "threa"
}

# Container configuration
variable "container_port" {
  description = "Port the container listens on"
  type        = number
  default     = 3000
}

variable "container_cpu" {
  description = "CPU units for the container (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "container_memory" {
  description = "Memory for the container in MB"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of container instances to run"
  type        = number
  default     = 1
}

# Image tag (updated by CI/CD)
variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

# RDS PostgreSQL configuration
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro" # Cheapest option (~$13/month)
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "threa"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "threa"
  sensitive   = true
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

# ElastiCache Redis configuration
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro" # Cheapest option (~$13/month)
}

# Cost optimization options
variable "use_spot" {
  description = "Use Fargate Spot for ~70% cost savings (tasks may be interrupted with 2-min warning)"
  type        = bool
  default     = false
}

variable "enable_redis" {
  description = "Enable ElastiCache Redis. Set to false for single-instance deployments to save ~$13/month"
  type        = bool
  default     = true
}
