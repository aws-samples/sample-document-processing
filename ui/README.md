# UI — Presentation & Ingestion Layer

React + Next.js web application (codename: DocPro), deployed as a static site to S3 + CloudFront.

## Structure

```
ui/
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Root layout — MUI ThemeProvider, CssBaseline
│   │   ├── page.tsx             # Home page — upload + document list
│   │   └── review/
│   │       └── page.tsx         # Review page — extracted data + approve/reject
│   ├── components/
│   │   ├── AppHeader.tsx        # Top app bar with navigation
│   │   ├── FileUploader.tsx     # Drag-and-drop PDF upload with customer dropdown
│   │   ├── DocumentTable.tsx    # Sortable/filterable document list
│   │   ├── ReviewForm.tsx       # Dynamic form from extracted JSON
│   │   └── StatusChip.tsx       # Color-coded status badge
│   ├── hooks/
│   │   ├── useDocuments.ts      # Document list fetching + auto-polling
│   │   └── useWebSocket.ts      # WebSocket connection (placeholder)
│   ├── services/
│   │   ├── api.ts               # REST API client (with mock fallback)
│   │   └── types.ts             # Shared TypeScript interfaces
│   └── theme.ts                 # MUI theme customization
├── infra/                       # CDK — S3 bucket + CloudFront distribution (OAC)
├── deploy.sh                    # Build + deploy script
├── package.json
├── next.config.ts               # Static export (output: 'export')
└── tsconfig.json
```

## Key Flows

1. **Upload:** Select customer from dropdown → drop PDF → `GET /presigned-url` → `PUT` to S3 → `POST /workflow/start`
2. **Document list:** Fetches from `GET /documents`, auto-polls every 10s when documents are processing
3. **Review:** Click document row → `/review/?id=<docId>` → inspect extracted fields → Approve or Reject

## Deploy

```bash
# 1. Create your .env.local file with backend endpoints
cp .env.local.example .env.local
```

Edit `.env.local` with your backend endpoints (see the root [README](../README.md#step-7-ui) for details):

| Variable | Description | How to get it |
|----------|-------------|---------------|
| `NEXT_PUBLIC_API_URL` | Backend REST API URL | From backend CDK output (`RestApiUrl`) |
| `NEXT_PUBLIC_WS_URL` | Backend WebSocket URL | From backend CDK output (`WebSocketApiUrl`) |

If `NEXT_PUBLIC_API_URL` is empty, the UI falls back to mock data for local development.

```bash
# 2. Build and deploy
./deploy.sh                # Full build + CDK deploy
# or manually:
npm install && npm run build
cd infra && npm install && npx cdk deploy
```

## Local Development

```bash
npm install
npm run dev                # http://localhost:3000
```

## Endpoints

| Resource | URL |
|----------|-----|
| CloudFront | `https://<CLOUDFRONT_DOMAIN>.cloudfront.net` |
| S3 Bucket | `document-processing-ui-<AWS_ACCOUNT_ID>` |
