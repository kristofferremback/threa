# ElastiCache Redis (optional - set enable_redis = false to save ~$13/month)

# Security group for ElastiCache
resource "aws_security_group" "redis" {
  count = var.enable_redis ? 1 : 0

  name        = "${var.app_name}-redis"
  description = "Security group for ElastiCache Redis"
  vpc_id      = data.aws_vpc.default.id

  # Allow inbound from ECS tasks
  ingress {
    protocol        = "tcp"
    from_port       = 6379
    to_port         = 6379
    security_groups = [aws_security_group.ecs_tasks.id]
    description     = "Allow Redis from ECS tasks"
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Subnet group for ElastiCache
resource "aws_elasticache_subnet_group" "main" {
  count = var.enable_redis ? 1 : 0

  name       = var.app_name
  subnet_ids = data.aws_subnets.default.ids
}

# ElastiCache Redis cluster (single node for cost)
resource "aws_elasticache_cluster" "main" {
  count = var.enable_redis ? 1 : 0

  cluster_id           = var.app_name
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main[0].name
  security_group_ids = [aws_security_group.redis[0].id]

  # Maintenance
  maintenance_window = "Mon:05:00-Mon:06:00"

  # Snapshots (optional, adds cost)
  snapshot_retention_limit = 0

  tags = {
    Name = "${var.app_name}-redis"
  }
}

# Store Redis URL in SSM Parameter Store
resource "aws_ssm_parameter" "redis_url" {
  count = var.enable_redis ? 1 : 0

  name        = "/${var.app_name}/redis-url"
  description = "Redis connection string"
  type        = "SecureString"
  value       = "redis://${aws_elasticache_cluster.main[0].cache_nodes[0].address}:${aws_elasticache_cluster.main[0].cache_nodes[0].port}"

  tags = {
    Name = "${var.app_name}-redis-url"
  }
}
