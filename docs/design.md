# Document Processing Platform — Technical Design

## 1. Architecture Overview

The platform is organized into four layers:

1. **Presentation & Ingestion Layer** — React UI, S3 uploads, REST/WebSocket APIs
2. **Workflow Orchestration Layer** — Step Functions state machine
3. **AI/GenAI Platform Layer** — Strands agents on AgentCore, Bedrock LLMs
4. **Observability & Governance Layer** — OTEL, CloudWatch, LiteLLM, Cost Dashboard

![Architecture Diagram](pij_architecture-architecture_v1.0.png)

---

## 2. Layer 1: Presentation & Ingestion

### 2.1 Frontend (React + MUI)

```
src/
├── pages/
│   ├── HomePage.tsx          # Upload section + document list
│   └── ReviewPage.tsx        # Document review/approval form
├── components/
│   ├── FileUploader.tsx      # S3 pre-signed URL upload
│   ├── DocumentTable.tsx     # Sortable/filterable document list
│   └── ReviewForm.tsx        # Dynamic form from extracted JSON
├── hooks/
│   ├── useWebSocket.ts       # WebSocket connection manager
│   └── useDocuments.ts       # Document CRUD operations
└── services/
    └── api.ts                # REST API client
```

**Key behaviors:**
- On upload: call `GET /presigned-url` → receive S3 pre-signed URL → `PUT` file to S3 → call `POST /workflow/start`
- WebSocket connection established on page load; listens for status change and result-ready events
- Document list polls on initial load, then updates reactively via WebSocket pushes

### 2.2 REST APIs (Lambda + API Gateway)

| Method | Path | Lambda | Description |
|--------|------|--------|-------------|
| GET | `/presigned-url` | `request_signedurl` | Creates DB record (status=Queued), returns S3 pre-signed URL |
| POST | `/workflow/start` | `start_workflow` | Starts Step Functions execution |
| GET | `/documents` | `list_documents` | Returns paginated document list |
| GET | `/documents/{id}` | `get_document` | Returns document detail + output JSON |
| PATCH | `/documents/{id}/status` | `update_status` | Sets status to Approved/Rejected |

### 2.3 WebSocket API (API Gateway)

| Route | Direction | Payload |
|-------|-----------|---------|
| `$connect` | Client → Server | Establishes connection, stores connectionId in DB |
| `$disconnect` | Client → Server | Removes connectionId from DB |
| `statusUpdate` | Server → Client | `{ documentId, status, message? }` |
| `resultReady` | Server → Client | `{ documentId, outputJsonS3Path }` |
| `malwareDetected` | Server → Client | `{ documentId, scanDetails }` |

### 2.4 S3 Bucket Layout

```
s3://document-processing-{env}/
├── uploads/                          # Raw PDF uploads
│   └── {documentId}/{filename}.pdf
├── chunks/                           # Temporary PDF chunks
│   └── {documentId}/chunk-{n}.pdf
├── extraction/                       # Temporary extraction results
│   └── {documentId}/extract-{n}.json
├── output/                           # Final validated JSON
│   └── {documentId}/result.json
└── lookups/                          # Reference Excel files
    └── {lookup-name}.xlsx
```

---

## 3. Layer 2: Workflow Orchestration (Step Functions)

### 3.1 State Machine Definition

```
                        ┌─────────────────┐
                        │   StartExecution │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │  Step 1: Virus  │
                        │     Scan        │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │   Clean?        │
                        └───┬─────────┬───┘
                       Yes  │         │  No
                            │    ┌────▼──────────────┐
                            │    │ Update Status:     │
                            │    │ Malware Detected   │
                            │    │ Notify WebSocket   │
                            │    └────────────────────┘
                   ┌────────▼────────────────────┐
                   │  Step 2: Parallel Retrieval  │
                   │  ┌──────────────────────┐   │
                   │  │ Retrieve Custom      │   │
                   │  │ Fields (DB)          │   │
                   │  ├──────────────────────┤   │
                   │  │ Retrieve Lookups     │   │
                   │  │ (S3 Excel)           │   │
                   │  ├──────────────────────┤   │
                   │  │ Retrieve SSM Params  │   │
                   │  └──────────────────────┘   │
                   └────────────┬────────────────┘
                                │
                   ┌────────────▼────────────────┐
                   │  Step 3: Invoke AgentCore   │
                   │  Supervisor Agent           │
                   └────────────┬────────────────┘
                                │
                   ┌────────────▼────────────────┐
                   │  Step 4: Persist Results    │
                   │  - Upload JSON to S3        │
                   │  - Update DB status         │
                   └────────────┬────────────────┘
                                │
                   ┌────────────▼────────────────┐
                   │  Step 5: Notify WebSocket   │
                   └─────────────────────────────┘
```

### 3.2 Step Details

| Step | Type | Service Integration | Wait Pattern |
|------|------|---------------------|--------------|
| Virus Scan | Task | GuardDuty S3 Malware Scan | Callback (`.waitForTaskToken`) |
| Parallel Retrieval | Parallel | Lambda (DynamoDB query), Lambda (S3 read), Lambda (SSM GetParameters) | Synchronous |
| Invoke Supervisor | Task | AgentCore Gateway (`InvokeAgent`) | Callback or sync with extended timeout |
| Persist Results | Task | Lambda (S3 PutObject + DynamoDB update) | Synchronous |
| Notify WebSocket | Task | Lambda (API Gateway `postToConnection`) | Synchronous |

### 3.3 Error Handling

- Each step includes a `Catch` block that updates document status to `Failed` and notifies the WebSocket
- Virus Scan timeout: 5 minutes (configurable via SSM)
- Agent invocation timeout: 15 minutes (configurable via SSM)
- Retries with exponential backoff on transient Lambda errors (max 3 attempts)

---

## 4. Layer 3: AI/GenAI Platform

### 4.1 Agent Architecture (Strands on AgentCore)

The agent layer uses **hierarchical orchestration** via the Strands framework's agent-as-tool pattern, hosted on Amazon Bedrock AgentCore.

```
┌─────────────────────────────────────────────────────────┐
│                   AgentCore Runtime                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Supervisor Agent                     │   │
│  │                                                   │   │
│  │  Tools:                                           │   │
│  │  ├── chunking_agent    (Agent-as-Tool)           │   │
│  │  ├── extraction_agent  (Agent-as-Tool, parallel) │   │
│  │  ├── mapping_agent     (Agent-as-Tool)           │   │
│  │  ├── validation_agent  (Agent-as-Tool)           │   │
│  │  ├── s3_read / s3_write                          │   │
│  │  └── db_update_status                            │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │  Chunking  │  │ Extraction │  │ Mapping  │ Valid. │  │
│  │  Agent     │  │ Agent(s)   │  │ Agent    │ Agent  │  │
│  └────────────┘  └────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────────┐
│ LiteLLM Gateway │  │ Bedrock Services    │
│ (ECS Fargate)   │  │ - KBs for Schema    │
│ - Model Routing │  │ - Prompt Management │
│                 │  │ - Guardrails        │
└─────────────────┘  │ - Code Interpreter  │
                     └─────────────────────┘
```

### 4.2 Agent Specifications

#### Supervisor Agent
- **Role:** Orchestrator — delegates work, collects results, writes final output
- **Input:** `{ pdfS3Path, customFields, lookups, ssmParams, outputSchema }`
- **Orchestration flow:**
  1. Invoke Chunking Agent with SSM params + PDF path
  2. For each chunk, invoke an Extraction Agent (parallel via Strands)
  3. Collect all extraction results, invoke Mapping Agent with output schema
  4. Invoke Validation Agent on the mapped JSON
  5. Write validated JSON to S3, return `{ outputS3Path }` to caller

#### Chunking Agent
- **Input:** `{ pdfS3Path, chunkSizeMB, pagesPerChunk }`
- **Output:** `{ chunks: [{ chunkId, startPage, endPage, s3Path }] }`
- **Logic:** Split PDF by `pagesPerChunk`, ensuring no single chunk exceeds `chunkSizeMB`

#### Extraction Agent
- **Input:** `{ chunkS3Path, fields: [...] }`
- **Output:** `{ chunkId, extractedData: { field: value, ... }, tempJsonS3Path }`
- **Logic:** Read chunk content, extract values for specified fields, write temp JSON to S3
- **Scaling:** One agent instance per chunk, running in parallel

#### Mapping Agent
- **Input:** `{ extractionResults: [...], outputSchema, fieldMappings }`
- **Output:** `{ mappedJson: { ... } }`
- **Logic:** Merge all chunk extractions into a single JSON object conforming to the output schema

#### Validation Agent
- **Input:** `{ json, outputSchema }`
- **Output:** `{ validatedJson, issues: [...], isValid: boolean }`
- **Logic:** Validate JSON against schema, fix violations, report issues. Uses AgentCore Code Interpreter for programmatic JSON schema validation.

### 4.3 LLM Infrastructure

| Component | Purpose | Deployment |
|-----------|---------|------------|
| **LiteLLM Gateway** | Model routing, load balancing, fallback, spend tracking | ECS Fargate |
| **Bedrock Knowledge Bases** | Store output JSON schemas for retrieval by agents | Bedrock managed |
| **Bedrock Prompt Management** | Version and manage agent system prompts | Bedrock managed |
| **Bedrock Guardrails** | Content filtering, PII redaction, topic restrictions | Bedrock managed |
| **AgentCore Code Interpreter** | Execute code for schema validation and data transforms | AgentCore managed |

---

## 5. Layer 4: Observability & Governance

![Observability Diagram](pij_architecture-observability.png)

| Signal | Source | Destination |
|--------|--------|-------------|
| Agent traces & spans | AgentCore OTEL | Amazon CloudWatch |
| Agent metrics & dashboards | AgentCore Runtime | AgentCore Observability Dashboard |
| LLM request metrics (tokens, cost, latency) | LiteLLM custom callback → CloudWatch Logs | CloudWatch Metrics (`DocumentProcessing/LlmGateway`) |
| LLM spend & usage | LiteLLM Gateway (Aurora) | LiteLLM Admin UI |
| Workflow execution history | Step Functions | Step Functions Console |
| ECS container health | Container Insights | CloudWatch Dashboard |
| ALB traffic & errors | ALB metrics | CloudWatch Dashboard |

### 5.1 LLM Gateway CloudWatch Dashboard

The `LlmGateway-document-processing` CloudWatch dashboard provides real-time visibility into all LLM calls made through the gateway.

**Data pipeline:**

```
LLM Request → LiteLLM Proxy → Custom Callback (MetricsLogger)
                                      │
                                      ▼
                              Structured JSON to stdout
                                      │
                                      ▼
                        CloudWatch Logs (/document-processing/llm-gateway)
                                      │
                                      ▼
                        8 Metric Filters → CloudWatch Metrics
                                      │        (DocumentProcessing/LlmGateway)
                                      ▼
                            CloudWatch Dashboard
```

A custom LiteLLM callback (`callbacks/metrics_logger.py`) emits a structured JSON line to stdout after every LLM completion. CloudWatch metric filters extract numeric values into the `DocumentProcessing/LlmGateway` namespace, dimensioned by model.

**Metric filters:**

| Metric Name | Value Extracted | Dimension |
|-------------|-----------------|-----------|
| `RequestCount` | 1 (count) | Model |
| `InputTokens` | `$.prompt_tokens` | Model |
| `OutputTokens` | `$.completion_tokens` | Model |
| `TotalTokens` | `$.total_tokens` | Model |
| `ResponseCostUSD` | `$.response_cost` | Model |
| `ResponseTimeMs` | `$.response_time_ms` | Model |
| `RequestErrors` | 1 (count, status_code >= 400) | Model |
| `ApplicationErrors` | 1 (count, level = ERROR) | — |

**Dashboard layout (8 rows):**

| Row | Widgets |
|-----|---------|
| Title | LLM Gateway — Document Processing |
| KPIs | Total Requests, Input Tokens, Output Tokens, Est. Cost (metric math sum across models) |
| Traffic | Request Rate by Model, Error Rate |
| Latency | Avg Response Time by Model, Latency Percentiles p50/p95/p99 (Logs Insights) |
| Tokens | Avg Tokens per Request by Model, Total Tokens Over Time (stacked) |
| Cost | Cost per Request by Model, Cost Breakdown Table (Logs Insights) |
| ECS | CPU Utilization %, Memory Utilization % |
| ALB | Request Count & 5xx Errors, Target Response Time (avg + p99) |

**Infrastructure:** Deployed as a separate CDK stack (`LlmGatewayObservabilityStack`) in `llm-gateway/infra/lib/observability-stack.ts`, independent of the gateway service lifecycle.

### 5.2 AgentCore Observability Dashboard

The AgentCore Observability Dashboard provides native visibility into agent behavior and performance directly from the AgentCore runtime.

**Key metrics tracked:**

| Metric | Description |
|--------|-------------|
| Agent invocation count | Total invocations per agent (Supervisor, Chunking, Extraction, Mapping, Validation) |
| Agent latency (p50/p90/p99) | End-to-end execution time per agent invocation |
| Tool call frequency | Number of tool calls made by each agent per session |
| Agent error rate | Failed invocations, timeouts, and exceptions per agent |
| Token usage | Input/output token consumption per agent per invocation |
| Session traces | Full trace of agent reasoning steps, tool calls, and sub-agent delegations |
| Handoff latency | Time between Supervisor delegation and sub-agent response |

**Dashboard views:**

- **Agent Overview** — Aggregate health: invocation volume, success rate, avg latency across all agents
- **Agent Detail** — Per-agent drill-down: individual traces, tool call breakdown, token usage distribution
- **Session Timeline** — End-to-end view of a single document processing session showing Supervisor → sub-agent delegation chain with timing
- **Error Analysis** — Grouped error types, failed agent invocations, retry patterns
- **Cost Attribution** — Token spend per agent per document, enabling cost-per-document analysis

---

## 6. Database Schema (Amazon DynamoDB)

### `Documents` table

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `PK` | String | Partition Key | `DOC#<documentId>` |
| `SK` | String | Sort Key | `METADATA` |
| `documentId` | String | | UUID document identifier |
| `customerName` | String | | Uploading customer |
| `documentName` | String | | Original file name |
| `s3UploadPath` | String | | S3 key of uploaded PDF |
| `s3OutputPath` | String | | S3 key of output JSON (nullable) |
| `status` | String | | `queued`, `processing`, `in_review`, `rejected`, `approved`, `malware_detected`, `failed` |
| `workflowExecutionArn` | String | | Step Functions execution ARN (nullable) |
| `createdAt` | String (ISO 8601) | | Record creation time |
| `updatedAt` | String (ISO 8601) | | Last update time |

**GSI: `StatusIndex`** — Enables querying documents by status for the document list page.

| Attribute | Key |
|-----------|-----|
| `status` | Partition Key |
| `updatedAt` | Sort Key |

### `WebSocketConnections` table

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `connectionId` | String | Partition Key | API Gateway WebSocket connection ID |
| `connectedAt` | String (ISO 8601) | | Connection timestamp |
| `ttl` | Number | | TTL epoch for DynamoDB auto-expiry |

**TTL attribute:** `ttl` — DynamoDB automatically deletes expired connections.

### `CustomFields` table

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `PK` | String | Partition Key | `FIELD#<fieldId>` |
| `SK` | String | Sort Key | `METADATA` |
| `fieldId` | String | | UUID field identifier |
| `fieldName` | String | | Field display name |
| `fieldKey` | String | | Machine-readable key |
| `fieldType` | String | | Data type (string, number, date, etc.) |
| `isRequired` | Boolean | | Whether the field is mandatory |
| `description` | String | | Field description for agent prompts |

### Capacity Mode

All tables use **on-demand capacity mode** — no provisioned throughput to manage, automatic scaling with pay-per-request pricing.

---

## 7. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Malicious uploads | GuardDuty malware scan before any processing |
| S3 access | Pre-signed URLs with short TTL; no direct bucket access |
| AI content safety | Bedrock Guardrails for PII filtering and topic restrictions |
| Data in transit | HTTPS for all API calls; WSS for WebSocket |
| Data at rest | S3 SSE-S3 or SSE-KMS encryption; DynamoDB encryption at rest enabled |
| IAM | Least-privilege roles per Lambda and AgentCore |

---

## 8. Deployment & Infrastructure

### Resource Tagging
```json
{
  "env": "dev",
  "application": "document-processing"
}
```

### Region
`us-east-1`

### IaC Recommendation
AWS CDK (TypeScript) or AWS SAM — infrastructure is co-located with each layer:

| Layer | `infra/` Location | Resources |
|-------|-------------------|-----------|
| `ui/infra/` | Presentation | S3 static hosting, CloudFront distribution |
| `backend/infra/` | APIs & Microservices | API Gateway (REST + WebSocket), Lambda functions, DynamoDB tables, S3 bucket, IAM roles |
| `workflow/infra/` | Orchestration | Step Functions state machine, GuardDuty scan integration, IAM roles |
| `agents/infra/` | AI/GenAI | AgentCore agent definitions, Bedrock KBs, Prompt Management, Guardrails, SSM parameters |
| `llm-gateway/infra/` | LLM Routing | ECS Fargate service, task definition, ALB, security groups, IAM roles |

### Environment Strategy
| Environment | Purpose |
|-------------|---------|
| `dev` | Development and integration testing |
| `staging` | Pre-production validation |
| `prod` | Production workloads |
