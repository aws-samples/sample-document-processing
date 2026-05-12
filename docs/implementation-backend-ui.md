# Backend & UI — Implementation Guide

## 1. Overview

The backend provides REST and WebSocket APIs (Lambda + API Gateway) consumed by the React UI (Next.js static export on S3 + CloudFront). Together they handle document upload, processing orchestration, status tracking, and human review.

---

## 2. Architecture

```
Browser → CloudFront → S3 (static site)
  │
  ├─ REST API ──→ API Gateway ──→ Lambda ──→ DynamoDB / S3
  │                                            │
  └─ WebSocket ──→ API Gateway ──→ Lambda ──→ DynamoDB (connections)
                                     │
                                     └──→ API Gateway Management API (push)
```

---

## 3. Deployed Resources

### UI (DocProcessingUiStack)
| Resource | Value |
|----------|-------|
| CloudFront | `https://<CLOUDFRONT_DOMAIN>.cloudfront.net` |
| S3 Bucket | `document-processing-ui-<AWS_ACCOUNT_ID>` |
| Distribution ID | `<DISTRIBUTION_ID>` |

### Backend (DocProcessingBackendStack)
| Resource | Value |
|----------|-------|
| REST API | `https://<API_ID>.execute-api.us-east-1.amazonaws.com/dev/` |
| WebSocket | `wss://<API_ID>.execute-api.us-east-1.amazonaws.com/dev` |
| Documents Table | `DocumentProcessing-Documents` |
| Connections Table | `DocumentProcessing-WebSocketConnections` |
| Notify Lambda ARN | `arn:aws:lambda:us-east-1:<AWS_ACCOUNT_ID>:function:document-processing-notify_websocket` |

---

## 4. REST API Endpoints

| Method | Path | Lambda | Description |
|--------|------|--------|-------------|
| GET | `/presigned-url?fileName=&customerName=` | `request_signedurl` | Creates DynamoDB record, returns S3 pre-signed URL (SigV4) |
| POST | `/workflow/start` | `start_workflow` | Updates status to Processing, starts Step Functions |
| GET | `/documents` | `list_documents` | Returns all documents sorted by createdAt desc |
| GET | `/documents/{id}` | `get_document` | Returns document + fetches extractedData from S3 output |
| PATCH | `/documents/{id}/status` | `update_status` | Approve/Reject with state transition validation |

### Status Transitions

```
Queued → Processing → In Review → Approved
                                → Rejected → In Review (re-review)
```

---

## 5. DynamoDB Schema

### Documents Table
| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | String (PK) | `doc-{uuid8}` |
| `customerName` | String | Customer who uploaded |
| `documentName` | String | Original filename |
| `pdfS3Path` | String | `s3://bucket/uploads/{id}/{file}` |
| `outputS3Path` | String | `s3://bucket/output/{id}/result.json` (set by workflow) |
| `status` | String | Queued, Processing, In Review, Approved, Rejected |
| `createdAt` | String (ISO 8601) | Record creation time |
| `updatedAt` | String (ISO 8601) | Last update time |

### WebSocket Connections Table
| Attribute | Type | Description |
|-----------|------|-------------|
| `connectionId` | String (PK) | API Gateway connection ID |
| `customerName` | String | Optional customer filter |
| `connectedAt` | String (ISO 8601) | Connection time |
| `ttl` | Number | DynamoDB TTL epoch (24h auto-expiry) |

---

## 6. S3 CORS Configuration

The document bucket (`document-processing-<AWS_ACCOUNT_ID>`) requires CORS for browser-based pre-signed URL uploads:

```json
{
  "AllowedOrigins": ["https://<CLOUDFRONT_DOMAIN>.cloudfront.net", "http://localhost:3000"],
  "AllowedMethods": ["GET", "PUT", "POST"],
  "AllowedHeaders": ["*"]
}
```

The bucket uses AWS Key Management Service (KMS) encryption, so pre-signed URLs must use Signature Version 4 (SigV4) for authentication (`signature_version='s3v4'`).

---

## 7. Deployment

### Deploy everything
```bash
cd backend && ./deploy.sh     # API Gateway + Lambda + DynamoDB
cd ui && ./deploy.sh           # Build static site + S3 + CloudFront
```

### Deploy individually
```bash
# Backend only
cd backend/infra && npm install && npx cdk deploy

# UI only (after changing code)
cd ui && npm run build && cd infra && npx cdk deploy
```

---

## 8. Configuration

The UI reads API URLs from environment variables baked at build time:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://<API_ID>.execute-api.us-east-1.amazonaws.com/dev` |
| `NEXT_PUBLIC_WS_URL` | `wss://<API_ID>.execute-api.us-east-1.amazonaws.com/dev` |

Set in `ui/.env.local` before building. The API service (`ui/src/services/api.ts`) falls back to mock data when `NEXT_PUBLIC_API_URL` is empty.
