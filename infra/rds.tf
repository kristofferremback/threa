# RDS PostgreSQL with pgvector extension

# Security group for RDS
resource "aws_security_group" "rds" {
  name        = "${var.app_name}-rds"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = data.aws_vpc.default.id

  # Allow inbound from ECS tasks
  ingress {
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_security_group.ecs_tasks.id]
    description     = "Allow PostgreSQL from ECS tasks"
  }

  # No egress needed for RDS
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Subnet group for RDS
resource "aws_db_subnet_group" "main" {
  name       = var.app_name
  subnet_ids = data.aws_subnets.default.ids

  tags = {
    Name = "${var.app_name}-db-subnet-group"
  }
}

# Parameter group with pgvector
resource "aws_db_parameter_group" "postgres" {
  name   = "${var.app_name}-postgres16"
  family = "postgres16"

  # Enable pgvector extension loading
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }
}

# RDS PostgreSQL instance
resource "aws_db_instance" "main" {
  identifier = var.app_name

  # Engine
  engine               = "postgres"
  engine_version       = "16.4"
  instance_class       = var.db_instance_class
  parameter_group_name = aws_db_parameter_group.postgres.name

  # Storage
  allocated_storage     = 20
  max_allocated_storage = 100 # Auto-scaling up to 100GB
  storage_type          = "gp3"
  storage_encrypted     = true

  # Database
  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # Single AZ for cost savings

  # Backup
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  # Performance Insights (free tier)
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  # Other
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.app_name}-final-snapshot" : null
  deletion_protection       = var.environment == "prod"
  auto_minor_version_upgrade = true

  tags = {
    Name = "${var.app_name}-postgres"
  }
}

# Store database URL in SSM Parameter Store
resource "aws_ssm_parameter" "database_url" {
  name        = "/${var.app_name}/database-url"
  description = "PostgreSQL connection string"
  type        = "SecureString"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.endpoint}/${var.db_name}"

  tags = {
    Name = "${var.app_name}-database-url"
  }
}
