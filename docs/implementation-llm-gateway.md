# LLM Gateway — Implementation Guide

## 1. Overview

The LLM Gateway is a LiteLLM proxy deployed on ECS Fargate that sits between the Strands agents (on AgentCore) and Amazon Bedrock. It provides centralized model routing, automatic fallback, rate limiting, and spend tracking for all five agents (Supervisor, Chunking, Extraction, Mapping, Validation).

Agents call the gateway using the OpenAI-compatible API at `https://llm-gateway.document-processing.internal/v1/chat/completions` (via CloudFront VPC Origin). The gateway translates requests to Bedrock and tracks usage per agent via virtual API keys.

---

## 2. Architecture

```
                    ┌──────────────────────────────────────────┐
                    │          AgentCore Runtime (VPC)          │
                    │                                           │
                    │  Supervisor  Chunking  Extraction(n)      │
                    │  Mapping     Validation                   │
                    └──────────────┬────────────────────────────┘
                                   │ OpenAI-compatible API
                                   ▼
                    ┌──────────────────────────────────────────┐
                    │     Internal ALB (port 80)                │
                    └──────────────┬────────────────────────────┘
                                   │
                    ┌──────────────▼────────────────────────────┐
                    │     ECS Fargate Service                    │
                    │     ┌─────────────────────────────┐       │
                    │     │  LiteLLM Proxy (port 4000)  │       │
                    │     │  Admin UI (/ui)              │       │
                    │     │  Health App (port 8001)      │       │
                    │     └─────────────────────────────┘       │
                    │     1 vCPU / 2 GB / ARM64 (Graviton)      │
                    │     Auto-scale: 1 → 4 tasks               │
                    └──────┬───────────────────┬────────────────┘
                           │                   │
              ┌────────────▼──────┐  ┌─────────▼──────────────┐
              │  Aurora Serverless │  │  Amazon Bedrock        │
              │  v2 PostgreSQL     │  │  - Claude Sonnet 4.5   │
              │  (LiteLLM spend    │  │  - Claude Haiku 4.5    │
              │   tracking only)   │  │                        │
              └───────────────────┘  └────────────────────────┘
```

---

## 3. Model Configuration

### Model Aliases

| Alias | Bedrock Model | Use Case |
|-------|---------------|----------|
| `claude-primary` | `us.anthropic.claude-sonnet-4-5-20251101-v1:0` | Supervisor, Extraction, Mapping agents — complex reasoning |
| `claude-fallback` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Automatic fallback on Sonnet throttling/errors |
| `claude-fast` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Chunking, Validation agents — simpler tasks, lower cost |

The `us.` prefix enables Bedrock cross-region inference routing for better availability.

### Routing Strategy

**`usage-based-routing`** — distributes load across model endpoints by tracking active request count. This is optimal for the parallel Extraction agent pattern where multiple agents send concurrent LLM calls simultaneously.

### Fallback Chain

```
claude-primary → claude-fallback (on error/throttle)
claude-primary → claude-fallback (on context window exceeded)
```

### Rate Limits

| Model | TPM | RPM |
|-------|-----|-----|
| `claude-primary` | 80,000 | 50 |
| `claude-fallback` | 80,000 | 100 |
| `claude-fast` | 80,000 | 100 |

Set conservatively below Bedrock's default quota (~100k TPM/region). When hit, LiteLLM returns 429 and the router automatically falls back.

---

## 4. Files to Create

### 4.1 `llm-gateway/config/litellm_config.yaml`

LiteLLM configuration — model definitions, routing, fallback, rate limits, and general settings. All secrets referenced via `os.environ/VAR_NAME` (LiteLLM's own env var syntax).

```yaml
model_list:
  # Primary model — Claude Sonnet (complex reasoning tasks)
  - model_name: claude-primary
    litellm_params:
      model: bedrock/us.anthropic.claude-sonnet-4-5-20251101-v1:0
      aws_region_name: us-east-1
    tpm: 80000
    rpm: 50

  # Fallback model — Claude Haiku (automatic fallback)
  - model_name: claude-fallback
    litellm_params:
      model: bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0
      aws_region_name: us-east-1
    tpm: 80000
    rpm: 100

  # Fast model — Claude Haiku (chunking, validation)
  - model_name: claude-fast
    litellm_params:
      model: bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0
      aws_region_name: us-east-1
    tpm: 80000
    rpm: 100

router_settings:
  routing_strategy: usage-based-routing
  num_retries: 3
  retry_after: 5
  timeout: 600
  fallbacks:
    - claude-primary:
        - claude-fallback
  context_window_fallbacks:
    - claude-primary:
        - claude-fallback
  allowed_fails: 2
  cooldown_time: 60

general_settings:
  master_key: os.environ/LITELLM_ADMIN_KEY
  database_url: os.environ/DATABASE_URL
  store_model_in_db: false
  max_parallel_requests: 50
  request_timeout: 600

litellm_settings:
  drop_params: true
  set_verbose: false
  json_logs: true
  num_retries: 3
  callbacks: callbacks.metrics_logger.MetricsLogger
```

**Key settings explained:**
- `drop_params: true` — silently drops OpenAI-only params that Bedrock doesn't support
- `store_model_in_db: false` — models defined in YAML only, not the DB
- `request_timeout: 600` — 10-minute timeout for long extraction tasks
- `json_logs: true` — structured logging for CloudWatch
- `callbacks` — custom `MetricsLogger` callback that emits structured JSON for CloudWatch metric filters

### 4.2 `llm-gateway/callbacks/metrics_logger.py`

Custom LiteLLM callback that emits a structured JSON line to stdout after every LLM completion. These lines are captured by CloudWatch Logs and parsed by metric filters.

**Emitted JSON format:**
```json
{
  "litellm_metric": true,
  "model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "provider_model": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "prompt_tokens": 10164,
  "completion_tokens": 32,
  "total_tokens": 10196,
  "response_cost": 0.0340692,
  "response_time_ms": 1493,
  "status_code": 200,
  "timestamp": "2026-04-26T23:59:41.929045+00:00"
}
```

**Key implementation details:**
- Extends `litellm.integrations.custom_logger.CustomLogger`
- Implements both sync (`log_success_event`) and async (`async_log_success_event`) methods — the proxy uses async
- Configured in `litellm_config.yaml` via `litellm_settings.callbacks`
- Failure events also emitted with `status_code` and `error` fields

### 4.3 `llm-gateway/Dockerfile`

```dockerfile
FROM ghcr.io/berriai/litellm:main-stable

WORKDIR /app

COPY config/litellm_config.yaml /app/config.yaml
COPY callbacks/ /app/callbacks/

EXPOSE 4000

CMD ["--config", "/app/config.yaml", \
     "--num_workers", "2", \
     "--run_gunicorn"]
```

**Notes:**
- `main-stable` tag — avoids surprise breakage vs `main-latest`
- Config baked into image at `/app/config.yaml` — required for Fargate (no volume mounts)
- `callbacks/` directory copied to `/app/callbacks/` for the custom metrics logger
- 2 gunicorn workers — sufficient for 1 vCPU task

### 4.3 `llm-gateway/.env.example`

```properties
# LiteLLM Gateway — Environment Variables
# Copy to .env for local development. Never commit .env.

# Admin API key (must start with sk-)
LITELLM_ADMIN_KEY=sk-<GENERATE_A_RANDOM_KEY>

# Encryption key for stored credentials (set once, never change)
LITELLM_SALT_KEY=<GENERATE_A_32_CHAR_RANDOM_STRING>

# PostgreSQL connection string (LiteLLM internal DB)
DATABASE_URL=postgresql://litellm:<DB_PASSWORD>@localhost:5432/litellm

# Admin UI credentials (accessible at localhost:4000/ui during local development)
UI_USERNAME=admin
UI_PASSWORD=<CHOOSE_A_STRONG_PASSWORD>

# AWS region
AWS_REGION_NAME=us-east-1

# AWS credentials (local dev only — on ECS, use IAM task role)
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_SESSION_TOKEN=
```

### 4.4 `llm-gateway/docker-compose.yaml`

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
      POSTGRES_DB: litellm
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U litellm"]
      interval: 5s
      timeout: 5s
      retries: 5

  litellm:
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    ports:
      - "4000:4000"
      - "8001:8001"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://litellm:${POSTGRES_PASSWORD:-changeme}@postgres:5432/litellm
      SEPARATE_HEALTH_APP: "1"

volumes:
  postgres_data:
```

**Note:** The `DATABASE_URL` in the `environment` block overrides `.env` to use the Docker network hostname (`postgres` instead of `localhost`).

---

## 5. CDK Infrastructure (`llm-gateway/infra/`)

### 5.1 Project Structure

```
llm-gateway/infra/
├── bin/
│   └── app.ts                    # CDK App entry point
├── lib/
│   ├── constants.ts              # Shared tags, region, app name
│   ├── database-stack.ts         # Aurora Serverless v2, Secrets Manager
│   ├── gateway-stack.ts          # ECS Fargate, ALB, IAM, auto-scaling
│   └── observability-stack.ts    # CloudWatch metric filters + dashboard
├── cdk.json
├── package.json
└── tsconfig.json
```

### 5.2 Stack Dependency Chain

```
VPC (from vpc/infra) → DatabaseStack → GatewayStack → ObservabilityStack
```

### 5.3 Networking Stack

**Exports:** `vpc`, `ecsSecurityGroup`, `albSecurityGroup`, `dbSecurityGroup`

| Resource | Configuration |
|----------|---------------|
| VPC | 2 AZs, 2 public subnets (ALB), 2 private subnets with NAT (ECS + Aurora) |
| `alb-sg` | Inbound: port 80 from VPC CIDR (internal ALB) |
| `ecs-sg` | Inbound: port 4000 + 8001 from `alb-sg` only |
| `db-sg` | Inbound: port 5432 from `ecs-sg` only |

Security group rules:
```
alb-sg  ← VPC CIDR :80
ecs-sg  ← alb-sg :4000, :8001
db-sg   ← ecs-sg :5432
```

### 5.4 Database Stack

**Exports:** `dbSecret`, `litellmAdminKeySecret`, `litellmSaltKeySecret`, `uiCredentialsSecret`

| Resource | Configuration |
|----------|---------------|
| Aurora Serverless v2 Cluster | PostgreSQL 16, 0.5–1 ACU (dev), private subnets, `db-sg` |
| DB credentials secret | Auto-generated by CDK (`Credentials.fromGeneratedSecret`) |
| `DATABASE_URL` secret | Assembled by CDK custom resource: `postgresql://<user>:<password>@<host>:5432/litellm` |
| `litellmAdminKeySecret` | Auto-generated 32-char key (prefixed `sk-`) |
| `litellmSaltKeySecret` | Auto-generated 32-char key |
| `uiCredentialsSecret` | Username `admin`, auto-generated password |

**Aurora Serverless v2 settings:**
- Min capacity: 0.5 ACU (~$0.06/hour when near-idle)
- Max capacity: 1 ACU for dev (scale up for prod)
- Auto-pause: Not available on v2 but near-zero scaling achieves similar cost savings
- Encryption at rest: enabled (AWS-managed key)
- Deletion protection: off for dev
- Database name: `litellm`

### 5.5 Gateway Stack

**Exports:** `serviceUrl` (ALB DNS name)

#### ECS Cluster
- Container Insights enabled for CloudWatch metrics

#### Task Definition
| Setting | Value |
|---------|-------|
| CPU | 1024 (1 vCPU) |
| Memory | 2048 MB |
| Architecture | ARM64 (Graviton — cheaper) |
| Task Role | Bedrock `InvokeModel` + `InvokeModelWithResponseStream` |

#### IAM Task Role Permissions
```
bedrock:InvokeModel
bedrock:InvokeModelWithResponseStream
  → arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-*
  → arn:aws:bedrock:us-east-1:*:inference-profile/us.anthropic.claude-*
```
Plus `secretsmanager:GetSecretValue` for all four secrets (granted via CDK `.grantRead()`).

#### Container Definition
| Setting | Value |
|---------|-------|
| Image | Built from `llm-gateway/Dockerfile`, pushed to ECR by CDK |
| Port mappings | 4000 (proxy + UI), 8001 (health) |
| Environment | `AWS_REGION_NAME=us-east-1`, `SEPARATE_HEALTH_APP=1` |
| Secrets (from Secrets Manager) | `LITELLM_ADMIN_KEY`, `LITELLM_SALT_KEY`, `DATABASE_URL`, `UI_USERNAME`, `UI_PASSWORD` |
| Health check | `curl -f http://localhost:8001/health`, interval 30s, start period 60s |
| Logging | CloudWatch log group `/document-processing/llm-gateway`, 2-week retention |

**Start period of 60s** is critical — LiteLLM runs Prisma DB migrations on first start.

#### Fargate Service
| Setting | Value |
|---------|-------|
| Desired count | 1 (dev) |
| Subnets | Private with NAT egress |
| Circuit breaker | Enabled with rollback |
| ECS Exec | Enabled (for debugging via `aws ecs execute-command`) |

#### Auto-scaling
| Setting | Value |
|---------|-------|
| Min tasks | 1 |
| Max tasks | 4 |
| Scale-out trigger | CPU > 70%, cooldown 60s |
| Scale-in cooldown | 300s |

#### Internal ALB
| Setting | Value |
|---------|-------|
| Scheme | Internal (not internet-facing) |
| Listener | Port 80 → target group port 4000 |
| Health check | Port 8001, path `/health`, healthy codes 200 |
| Deregistration delay | 30s |

### 5.6 Observability Stack

**Depends on:** GatewayStack (receives `logGroup`, `ecsClusterName`, `ecsServiceName`, `albFullName`)

Creates 8 CloudWatch metric filters on the gateway log group and a comprehensive dashboard. See Section 8 for details.

Deployed independently — can be torn down and redeployed without affecting the running gateway.

### 5.7 CDK App Entry Point (`bin/app.ts`)

```
const app = new cdk.App()

VPC + Security Groups (imported from vpc/infra exports)
       │
DatabaseStack
  └─ exports secrets
       │
GatewayStack
  └─ ECS service, ALB, IAM
  └─ exports logGroup, clusterName, serviceName, albFullName
       │
ObservabilityStack
  └─ 8 metric filters, CloudWatch dashboard

Tags.of(app).add('env', 'dev')
Tags.of(app).add('application', 'document-processing')
```

---

## 6. Agent Connectivity

Agents on AgentCore connect to the gateway via the internal ALB DNS name. Recommended: create a Route 53 private hosted zone record:

```
llm-gateway.document-processing.internal → ALB DNS
```

Agent configuration (in Strands agent setup):
```python
OPENAI_BASE_URL=https://llm-gateway.document-processing.internal/v1
```

Each agent is assigned a virtual API key via the LiteLLM Admin UI for per-agent spend tracking.

---

## 7. Deployment Sequence

### Step 1: Local Validation
```bash
cd llm-gateway
cp .env.example .env
# Edit .env with AWS credentials for local Bedrock access
docker-compose up --build
```
Verify:
- `curl http://localhost:8001/health` → 200
- `http://localhost:4000/ui` → Admin UI loads
- Test chat completion: `curl -X POST http://localhost:4000/v1/chat/completions -H "Authorization: Bearer <YOUR_ADMIN_KEY>" -H "Content-Type: application/json" -d '{"model":"claude-fast","messages":[{"role":"user","content":"hello"}]}'`

### Step 2: CDK Bootstrap & Deploy
```bash
cd llm-gateway/infra
npm install
npx cdk bootstrap
npx cdk deploy --all --require-approval broadening
```

Deploy order (handled automatically by CDK dependency chain):
1. `LlmGatewayNetworkingStack` — VPC, subnets, security groups
2. `LlmGatewayDatabaseStack` — Aurora Serverless v2, secrets (~5 min)
3. `LlmGatewayStack` — ECR image build/push, ECS service, ALB (~5 min)

### Step 3: Post-Deploy Verification
```bash
# Check ECS service health
aws ecs describe-services --cluster llm-gateway --services llm-gateway-service --region us-east-1

# Get ALB DNS from stack output
aws cloudformation describe-stacks --stack-name LlmGatewayStack --query "Stacks[0].Outputs"

# Test via SSM port forward (if no VPN)
aws ssm start-session --target <ecs-task-id> --document-name AWS-StartPortForwardingSession --parameters portNumber=4000,localPortNumber=4000

# Health check
curl http://localhost:4000/health

# Bedrock connectivity test
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer <admin-key-from-secrets-manager>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-fast","messages":[{"role":"user","content":"ping"}]}'
```

---

## 8. Observability

### 8.1 Data Sources

| Signal | Source | Destination |
|--------|--------|-------------|
| LLM request metrics (tokens, cost, latency) | Custom callback → CloudWatch Logs | CloudWatch Metrics (`DocumentProcessing/LlmGateway`) |
| LLM spend per agent/model | LiteLLM SpendLogs (Aurora) | LiteLLM Admin UI (`/ui`) |
| Container CPU/Memory | ECS Container Insights | CloudWatch Dashboard |
| Request count, latency, 5xx | ALB metrics (`AWS/ApplicationELB`) | CloudWatch Dashboard |
| Application logs (JSON) | LiteLLM stdout | CloudWatch Logs (`/document-processing/llm-gateway`) |

### 8.2 Custom Metrics Callback

The `MetricsLogger` callback (`callbacks/metrics_logger.py`) emits a structured JSON line to stdout for every LLM completion. The `litellm_metric: true` field acts as a marker for metric filter patterns.

Configured in `litellm_config.yaml`:
```yaml
litellm_settings:
  callbacks: callbacks.metrics_logger.MetricsLogger
```

### 8.3 CloudWatch Metric Filters

All metrics are in the `DocumentProcessing/LlmGateway` namespace with a `Model` dimension. Filter patterns use `$.litellm_metric IS TRUE` as the base selector.

| Metric | Filter | Value | Unit |
|--------|--------|-------|------|
| `RequestCount` | `litellm_metric IS TRUE` | 1 | Count |
| `InputTokens` | `litellm_metric IS TRUE AND status_code = 200` | `$.prompt_tokens` | Count |
| `OutputTokens` | `litellm_metric IS TRUE AND status_code = 200` | `$.completion_tokens` | Count |
| `TotalTokens` | `litellm_metric IS TRUE AND status_code = 200` | `$.total_tokens` | Count |
| `ResponseCostUSD` | `litellm_metric IS TRUE AND status_code = 200` | `$.response_cost` | None |
| `ResponseTimeMs` | `litellm_metric IS TRUE` | `$.response_time_ms` | Milliseconds |
| `RequestErrors` | `litellm_metric IS TRUE AND status_code >= 400` | 1 | Count |
| `ApplicationErrors` | `level = "ERROR"` | 1 | Count |

### 8.4 CloudWatch Dashboard

Dashboard name: `LlmGateway-document-processing`

| Row | Left Widget | Right Widget |
|-----|-------------|--------------|
| KPIs | Total Requests (math: sonnet + haiku) | Input Tokens, Output Tokens, Est. Cost |
| Traffic | Request Rate by Model | Error Rate |
| Latency | Avg Response Time by Model | Latency Percentiles p50/p95/p99 (Logs Insights) |
| Tokens | Avg Tokens per Request by Model | Total Tokens Over Time (stacked) |
| Cost | Cost per Request by Model | Cost Breakdown Table (Logs Insights) |
| ECS | CPU Utilization % | Memory Utilization % |
| ALB | Request Count & 5xx Errors | Target Response Time (avg + p99) |

**Console URL:** `https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/LlmGateway-document-processing`

---

## 9. Security

| Concern | Mitigation |
|---------|------------|
| Bedrock credentials | IAM Task Role — no hardcoded keys, boto3 auto-discovers credentials |
| Secrets | Stored in Secrets Manager, injected as ECS secrets at task launch |
| Network access | Internal ALB — not internet-facing, only reachable within VPC |
| Admin UI access | Protected by `UI_USERNAME` / `UI_PASSWORD`; external access via SSM port forward only |
| DB access | Aurora in private subnets, `db-sg` allows only ECS task traffic on port 5432 |
| API authentication | All proxy requests require `Authorization: Bearer <virtual-key>` header |

---

## 10. Cost Estimate (Dev Environment)

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| ECS Fargate (1 task, 1 vCPU / 2 GB, ARM64) | ~$30 |
| Aurora Serverless v2 (0.5 ACU avg) | ~$44 |
| ALB (internal, low traffic) | ~$18 |
| NAT Gateway (1 AZ) | ~$32 |
| CloudWatch Logs | ~$2 |
| **Total** | **~$126/month** |

Bedrock model costs are usage-based and billed separately per token.
