# LLM Gateway — Model Routing Layer

LiteLLM Gateway deployed on ECS Fargate for centralized LLM model routing.

## Purpose

- **Model routing** — Route agent requests to appropriate Bedrock models
- **Load balancing** — Distribute requests across model endpoints
- **Fallback** — Automatic failover between models on errors or throttling
- **Spend tracking** — Per-agent, per-model token usage and cost tracking
- **Rate limiting** — Protect against runaway agent loops

## Structure

```
llm-gateway/
├── config/
│   └── litellm_config.yaml       # Model definitions, routing rules, fallbacks
├── Dockerfile                    # LiteLLM container image
├── docker-compose.yaml           # Local development
├── infra/                        # CDK/SAM — ECS Fargate service, task definition, ALB, security groups, IAM roles
└── README.md
```

## Observability

- **LiteLLM Admin UI** — Spend/usage dashboards per model and per agent
- Metrics forwarded to CloudWatch Cost Dashboard

## Deployment

```bash
# 1. Create your .env file from the template and fill in your values
cp .env.example .env
```

Edit `.env` with your values (see the root [README](../README.md#step-5-llm-gateway) for a full variable reference).

Generate secure keys:

```bash
# Master API key (must start with sk-)
echo "sk-$(openssl rand -hex 24)"

# Salt key (32-char random string)
openssl rand -hex 16
```

```bash
# 2. Local development
export POSTGRES_PASSWORD=<your-db-password>
docker-compose up

# 3. Deploy to ECS Fargate (secrets are created in Secrets Manager by CDK)
cd infra && npm install && npx cdk deploy --all
```

- **Runtime:** ECS Fargate
- **Region:** us-east-1
- **Tags:** `env=dev`, `application=document-processing`
