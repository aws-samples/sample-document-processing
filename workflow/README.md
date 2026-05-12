# Workflow — Orchestration Layer

AWS Step Functions state machine for document processing pipeline.

## Pipeline Steps

1. **Virus Scan** — GuardDuty malware scan on uploaded S3 object (callback pattern with task token)
2. **Scan Routing** — Pass: continue to parallel retrieval. Fail: mark as `Malware Detected`, notify WebSocket
3. **Parallel Data Retrieval:**
   - Retrieve output schema from S3 (`config/schemas/`)
   - Retrieve lookup data from S3 (`config/lookups/`)
   - Retrieve SSM parameters (chunk_size_mb, pages_per_chunk, agent_timeout_seconds)
4. **Invoke Supervisor Agent** — AgentCore runtime invocation (15 min timeout)
5. **Persist Results** — Upload output JSON to S3, update DynamoDB status to `In Review`
6. **Notify WebSocket** — Push status update to connected clients via backend notify Lambda

## Structure

```
workflow/
├── lambdas/
│   ├── trigger_scan/           # Step 1 — Start GuardDuty scan, store task token
│   ├── process_scan_result/    # EventBridge callback — resume Step Functions on scan complete
│   ├── retrieve_data/          # Step 2 — Fetch schema, lookups, SSM params (one Lambda, three modes)
│   ├── invoke_agent/           # Step 3 — Call AgentCore supervisor agent
│   ├── persist_results/        # Step 4 — Write results to S3, update DynamoDB
│   ├── notify_status/          # Step 5 — Invoke backend notify Lambda
│   └── handle_failure/         # Error handler — update status to Failed, notify WebSocket
├── infra/                      # CDK — Step Functions, EventBridge rule, DynamoDB (task tokens), IAM
├── deploy.sh                   # Deploy script
└── README.md
```

## State Machine Input

```json
{
  "documentId": "doc-abc12345",
  "pdfS3Path": "s3://document-processing-<YOUR_AWS_ACCOUNT_ID>/uploads/doc-abc12345/file.pdf",
  "customerName": "Pinnacle Financial Group",
  "schemaType": "invoice"
}
```

Provided by the `start_workflow` Lambda when it calls `StartExecution`.

## DynamoDB Tables

- **DocumentProcessing-Documents** — Document metadata (shared with backend)
- **DocumentProcessing-ScanTaskTokens** — Stores Step Functions task tokens for GuardDuty callback (PK: `scanId`, TTL enabled)

## Deploy

```bash
# 1. Create your .env file from the template and fill in your values
cp .env.example .env
```

Edit `.env` with your values (see the root [README](../README.md#step-4-workflow-orchestration) for a full variable reference). Key values to fill in:

- `DOCUMENT_BUCKET` — set to `document-processing-<YOUR_AWS_ACCOUNT_ID>`
- `AGENT_RUNTIME_ARN` — from AgentCore after deploying the supervisor agent
- `NOTIFY_FUNCTION_ARN` — from backend CDK output (`NotifyFunctionArn`)

```bash
# 2. Deploy (requires agentRuntimeArn context value)
./deploy.sh                # Full CDK deploy
# or manually:
cd infra && npm install && npx cdk deploy -c agentRuntimeArn=<YOUR_AGENT_RUNTIME_ARN>
```

## Resources

| Resource | Value |
|----------|-------|
| State Machine | `document-processing-workflow` |
| EventBridge Rule | `document-processing-guardduty-scan-complete` |
| Task Token Table | `DocumentProcessing-ScanTaskTokens` |
