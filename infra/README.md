# Threa Infrastructure

Minimal AWS infrastructure for deploying Threa using ECS Fargate.

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
                          ▼
┌──────────────────┐  ┌──────────────────┐
│   PostgreSQL     │  │      Redis       │
│   (External)     │  │   (External)     │
└──────────────────┘  └──────────────────┘
```

## Components

- **ECR** - Container registry for Docker images
- **ECS Fargate** - Serverless container hosting
- **CloudWatch** - Logs, metrics, and dashboards
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
# Edit terraform.tfvars as needed

# 3. Initialize Terraform
terraform init

# 4. Preview changes
terraform plan

# 5. Apply infrastructure
terraform apply
```

## Configuration

### Environment Variables

The app expects these environment variables (configured via SSM Parameter Store):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `WORKOS_API_KEY` | Yes | WorkOS API key |
| `WORKOS_CLIENT_ID` | Yes | WorkOS client ID |
| `WORKOS_REDIRECT_URI` | Yes | WorkOS OAuth redirect URI |
| `WORKOS_COOKIE_PASSWORD` | Yes | Session cookie encryption key |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for AI features |
| `OPENAI_API_KEY` | No | OpenAI API key for embeddings |

### Adding Secrets

Store secrets in AWS SSM Parameter Store:

```bash
# Example: Add database URL
aws ssm put-parameter \
  --name "/threa/database-url" \
  --type "SecureString" \
  --value "postgresql://user:pass@host:5432/db"
```

Then uncomment the `secrets` block in `ecs.tf`.

## CI/CD

The GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically:

1. Builds the Docker image
2. Pushes to ECR
3. Deploys to ECS

### Required GitHub Secrets

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Monitoring

Access the CloudWatch dashboard:

```bash
terraform output cloudwatch_dashboard_url
```

Or view logs:

```bash
aws logs tail /ecs/threa --follow
```

## Costs

Estimated monthly cost (minimal setup):

| Resource | Cost |
|----------|------|
| ECS Fargate (0.25 vCPU, 0.5GB) | ~$10 |
| CloudWatch Logs | ~$1 |
| ECR Storage | ~$0.10 |
| **Total** | **~$11/month** |

Note: Database and Redis costs are separate.

## Scaling Up

To add more resources:

1. **Load Balancer**: Add ALB for SSL termination and multiple tasks
2. **Database**: Add RDS PostgreSQL with `pgvector` extension
3. **Cache**: Add ElastiCache Redis
4. **Auto-scaling**: Add ECS service auto-scaling policies

## Cleanup

```bash
terraform destroy
```

⚠️ This will delete all resources including the ECR repository and any stored images.
