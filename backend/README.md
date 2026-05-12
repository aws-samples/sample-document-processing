# Backend — APIs & Microservices

AWS Lambda functions behind API Gateway (REST + WebSocket).

## Structure

```
backend/
├── lambdas/
│   ├── request_signedurl/        # GET /presigned-url — creates DB record, returns S3 pre-signed URL
│   ├── start_workflow/           # POST /workflow/start — starts Step Functions execution
│   ├── list_documents/           # GET /documents — paginated document list
│   ├── get_document/             # GET /documents/{id} — document detail + output JSON from S3
│   ├── update_status/            # PATCH /documents/{id}/status — approve/reject with state validation
│   ├── websocket_connect/        # $connect — stores connectionId in DynamoDB (24h TTL)
│   ├── websocket_disconnect/     # $disconnect — removes connectionId from DynamoDB
│   └── notify_websocket/         # Server → Client push via API Gateway postToConnection
├── shared/                       # Shared utilities (DynamoDB client, response helpers, constants)
│   ├── constants.py
│   ├── db.py
│   └── response.py
├── config/                       # Schemas, lookups, sample data
│   ├── schemas/invoice.json
│   ├── lookups/vendor_codes.json
│   └── samples/
├── infra/                        # CDK — API Gateway, Lambda, DynamoDB, IAM
├── deploy.sh                     # Deploy script
└── README.md
```

## REST API

| Method | Path | Lambda | Description |
|--------|------|--------|-------------|
| GET | `/presigned-url` | `request_signedurl` | Creates DB record, returns S3 pre-signed URL |
| POST | `/workflow/start` | `start_workflow` | Updates status to Processing, starts Step Functions |
| GET | `/documents` | `list_documents` | Returns all documents sorted by date |
| GET | `/documents/{id}` | `get_document` | Returns document + fetches extracted data from S3 |
| PATCH | `/documents/{id}/status` | `update_status` | Approve/Reject with state transition validation |

## WebSocket API

| Route | Direction | Description |
|-------|-----------|-------------|
| `$connect` | Client → Server | Stores connectionId + optional customerName |
| `$disconnect` | Client → Server | Removes connectionId |
| `statusUpdate` | Server → Client | Broadcasts document status changes |

## DynamoDB Tables

- **DocumentProcessing-Documents** — Document metadata and status tracking (PK: `id`)
- **DocumentProcessing-WebSocketConnections** — Active WebSocket connections (PK: `connectionId`, TTL: 24h)

## Deploy

```bash
# 1. Create your .env file from the template and fill in your values
cp .env.example .env
```

Edit `.env` with your values (see the root [README](../README.md#step-3-backend-apis) for a full variable reference). Key values to fill in:

- `DOCUMENT_BUCKET` — set to `document-processing-<YOUR_AWS_ACCOUNT_ID>`
- `WEBSOCKET_API_ENDPOINT` — populated from CDK output after deploy
- `WORKFLOW_STATE_MACHINE_ARN` — populated from workflow CDK output after deploying the workflow stack

```bash
# 2. Deploy
./deploy.sh                # Full CDK deploy
# or manually:
cd infra && npm install && npx cdk deploy
```

## Endpoints

After deploying, find your endpoint URLs in the CDK outputs:

| Resource | URL |
|----------|-----|
| REST API | `https://<API_ID>.execute-api.us-east-1.amazonaws.com/dev/` |
| WebSocket | `wss://<API_ID>.execute-api.us-east-1.amazonaws.com/dev` |

These values are also saved to `infra/cdk-outputs.json` (git-ignored). See `infra/cdk-outputs.example.json` for the expected structure.
