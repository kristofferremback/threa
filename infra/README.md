# Threa Infrastructure

Minimal AWS infrastructure for deploying Threa using ECS Fargate with RDS and ElastiCache.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Internet                             │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   ECS Fargate                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Threa Container                     │    │
│  │  • Bun server (API + WebSocket)                 │    │
│  │  • Static frontend assets                        │    │
│  │  • Port 3000                                     │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
┌──────────────────┐         ┌──────────────────┐
│   RDS PostgreSQL │         │ ElastiCache Redis│
│   (db.t4g.micro) │         │ (cache.t4g.micro)│
└──────────────────┘         └──────────────────┘
```

## Components

- **ECR** - Container registry for Docker images
- **ECS Fargate** - Serverless container hosting
- **RDS PostgreSQL** - Managed database with automatic backups
- **ElastiCache Redis** - Managed Redis for caching and pub/sub
- **CloudWatch** - Logs, metrics, and dashboards
- **SSM Parameter Store** - Secure secret storage
- **IAM** - Roles and policies for ECS tasks

## Prerequisites

1. [Terraform](https://www.terraform.io/downloads) >= 1.0
2. AWS CLI configured with credentials
3. An AWS account

## Quick Start

```bash
# 1. Navigate to infra directory
cd infra

# 2. Create your variables file
cp terraform.tfvars.example terraform.tfvars

# 3. Edit terraform.tfvars - IMPORTANT: Set a secure db_password!
vim terraform.tfvars

# 4. Initialize Terraform
terraform init

# 5. Preview changes
terraform plan

# 6. Apply infrastructure
terraform apply
```

## Estimated Costs

### Default Configuration (~$37/month)

| Resource | Monthly Cost |
|----------|-------------|
| ECS Fargate (0.25 vCPU, 0.5GB) | ~$10 |
| RDS PostgreSQL (db.t4g.micro) | ~$13 |
| ElastiCache Redis (cache.t4g.micro) | ~$13 |
| CloudWatch Logs | ~$1 |
| ECR Storage | ~$0.10 |
| **Total** | **~$37/month** |

### Budget Configuration (~$17/month)

With `use_spot = true` and `enable_redis = false`:

| Resource | Monthly Cost |
|----------|-------------|
| ECS Fargate Spot (0.25 vCPU, 0.5GB) | ~$3 |
| RDS PostgreSQL (db.t4g.micro) | ~$13 |
| CloudWatch Logs | ~$1 |
| ECR Storage | ~$0.10 |
| **Total** | **~$17/month** |

## Configuration

### Required Variables

| Variable | Description |
|----------|-------------|
| `db_password` | PostgreSQL master password (use a strong password!) |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `aws_region` | eu-central-1 | AWS region |
| `environment` | prod | Environment name |
| `db_instance_class` | db.t4g.micro | RDS instance size |
| `redis_node_type` | cache.t4g.micro | ElastiCache node size |
| `container_cpu` | 256 | CPU units (256 = 0.25 vCPU) |
| `container_memory` | 512 | Memory in MB |
| `use_spot` | false | Use Fargate Spot (~70% savings, tasks may be interrupted) |
| `enable_redis` | true | Enable ElastiCache Redis (set false for single-instance) |

### Adding App Secrets

Additional secrets (like WorkOS keys) can be added to SSM Parameter Store:

```bash
# Add a secret
aws ssm put-parameter \
  --name "/threa/workos-api-key" \
  --type "SecureString" \
  --value "your-api-key-here"
```

Then add to the secrets block in `ecs.tf`:

```hcl
secrets = [
  # ... existing secrets ...
  {
    name      = "WORKOS_API_KEY"
    valueFrom = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.app_name}/workos-api-key"
  }
]
```

## CI/CD

The GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically:

1. Builds the Docker image
2. Pushes to ECR
3. Deploys to ECS

### Required GitHub Secrets

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Monitoring

### CloudWatch Dashboard

Access the dashboard:
```bash
terraform output cloudwatch_dashboard_url
```

### View Logs

```bash
aws logs tail /ecs/threa --follow
```

### Alarms

The following alarms are configured:
- CPU utilization > 80%
- Memory utilization > 80%
- No running tasks

## Database

### Connect to RDS

The database is not publicly accessible. To connect:

1. Use Session Manager to connect to the ECS task
2. Or set up a bastion host / VPN

### Enable pgvector

After deployment, connect to the database and enable pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Run Migrations

Migrations should be run as part of your deployment process or manually:

```bash
# Example: Run migrations from your local machine through a bastion
DATABASE_URL="postgresql://..." bun run migrate
```

## Scaling Up

### Add Load Balancer (for HTTPS and redundancy)

To add an ALB:

1. Create an ALB with HTTPS listener
2. Add ACM certificate for your domain
3. Update ECS service to use the ALB target group
4. Update security groups

### Increase Capacity

```hcl
# In terraform.tfvars
container_cpu    = 512   # 0.5 vCPU
container_memory = 1024  # 1 GB
desired_count    = 2     # 2 tasks

db_instance_class = "db.t4g.small"
redis_node_type   = "cache.t4g.small"
```

### Add Multi-AZ

For production redundancy:
- Enable `multi_az = true` for RDS
- Use ElastiCache replication group instead of cluster

## Cleanup

```bash
terraform destroy
```

⚠️ This will delete all resources including:
- ECR repository and images
- RDS database and all data
- ElastiCache cluster

To keep RDS data, take a final snapshot before destroying.
