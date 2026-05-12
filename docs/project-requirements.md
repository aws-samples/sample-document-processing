# Document Processing Platform — Project Requirements

## 1. Overview

The Document Processing Platform (codename: **DocPro**) enables customers to upload PDF documents, which are then scanned for security threats, intelligently processed by AI agents to extract structured data, and presented in a review interface for human approval.

## 2. Business Requirements

| ID | Requirement |
|----|-------------|
| BR-01 | Customers must be able to upload PDF documents through a web interface |
| BR-02 | Uploaded documents must be scanned for malware before processing |
| BR-03 | Document contents must be extracted into structured JSON using AI agents |
| BR-04 | Extracted data must be displayed in a review form for human review and approval |
| BR-05 | Users must be able to track document status throughout the processing lifecycle |
| BR-06 | Real-time status updates must be pushed to the UI as processing progresses |

## 3. Functional Requirements

### 3.1 User Interface (React + MUI)

#### FR-UI-01: Home Page — Document Upload Section
- Provide a file upload component for PDF documents
- On upload initiation, request a pre-signed S3 URL from the backend
- Upload the document directly to S3 using the pre-signed URL
- Trigger the backend workflow upon successful upload

#### FR-UI-02: Home Page — Document List Section
- Display a table of all uploaded documents with the following columns:
  - Customer Name
  - Document Name
  - Created On
  - Updated On
  - Status
- Supported statuses: `Queued` | `Processing` | `In Review` | `Rejected` | `Approved`
- Each document row is a clickable link that navigates to the Review Page
- Status updates are received in real-time via WebSocket

#### FR-UI-03: Review Page
- Display extracted document data in a structured form/page
- Allow the reviewer to inspect all extracted fields
- Provide actions to **Approve** or **Reject** the document
- Update document status in the database upon action

### 3.2 Backend — APIs & Microservices

#### FR-API-01: Pre-Signed URL Lambda
- **Endpoint:** REST API via API Gateway
- **Behavior:**
  1. Create a new document record in the database with status `Queued`
  2. Generate and return an S3 pre-signed URL for the client to upload the PDF

#### FR-API-02: Workflow Trigger
- **Endpoint:** REST API via API Gateway
- **Behavior:**
  1. Accept the document ID / S3 key
  2. Start the AWS Step Functions state machine execution
  3. Update document status to `Processing`

#### FR-API-03: WebSocket API
- Maintain persistent WebSocket connections with the UI
- Push real-time notifications for:
  - Document status changes (e.g., `Processing` → `In Review`)
  - Malware detection alerts
  - Output JSON S3 path upon processing completion

### 3.3 Workflow Orchestration (AWS Step Functions)

#### FR-WF-01: Step 1 — Virus Scan
- Trigger a GuardDuty malware scan on the uploaded S3 object
- Wait for the scan result (callback or polling pattern)

#### FR-WF-02: Step 2 — Scan Result Routing
- **If scan passed:** proceed to Step 3 (parallel data retrieval)
- **If scan failed:** update document status to `Malware Detected`, notify UI via WebSocket, and terminate workflow

#### FR-WF-03: Step 3 — Parallel Data Retrieval (Deterministic)
Execute the following tasks in parallel:
- **3.1:** Retrieve custom field definitions from the database
- **3.2:** Retrieve lookup data from S3 (Excel files)
- **3.3:** Retrieve SSM parameters for PDF chunking configuration (`chunk_size`, `pages_per_chunk`)

#### FR-WF-04: Step 4 — Invoke Supervisor Agent
- Invoke the AgentCore Supervisor Agent via AgentCore Gateway
- Pass inputs from Step 3 (custom fields, lookups, SSM parameters) and the S3 path of the uploaded PDF
- Wait for the agent to return the final structured JSON result

#### FR-WF-05: Step 5 — Persist Results
- Upload the final JSON output from Step 4 to S3
- Update the document record in the database:
  - Set status to `In Review`
  - Store the output JSON S3 path

#### FR-WF-06: Step 6 — Notify UI
- Send a WebSocket notification to the UI containing the output JSON S3 path and updated status

### 3.4 AI/GenAI Agent Layer (Strands on AgentCore)

#### FR-AG-01: Supervisor Agent
- Orchestrates all sub-agents using hierarchical delegation (Strands agent-as-tool pattern)
- Receives: PDF S3 path, custom fields, lookup data, SSM parameters, output JSON schema
- Delegates tasks to sub-agents in sequence:
  1. Chunking Agent
  2. Extraction Agents (parallelized)
  3. Mapping Agent
  4. Validation Agent
- Writes the final validated JSON to S3
- Returns control to the Step Functions workflow

#### FR-AG-02: Chunking Agent
- Accepts SSM parameters: `chunk_size` (MB) and `pages_per_chunk`
- Splits the PDF into logical chunks to stay within model context window limits
- Returns chunk metadata (page ranges, S3 paths or byte offsets) to the Supervisor

#### FR-AG-03: Extraction Agents
- Multiple agents run in parallel, one per chunk (or per field group)
- Each agent receives: chunk data, field definitions from the Supervisor
- Extracts structured data from the chunk
- Writes results to a temporary JSON file
- Returns result location to the Supervisor

#### FR-AG-04: Mapping Agent
- Receives: field information, output JSON schema, and JSON results from all extraction agents
- Merges and maps extracted data into the final output JSON structure

#### FR-AG-05: Validation Agent
- Validates the final JSON against the output JSON schema
- Identifies and fixes any schema violations or data quality issues
- Returns the validated JSON to the Supervisor

## 4. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-01 | Security | All S3 uploads use pre-signed URLs with short TTL |
| NFR-02 | Security | Every uploaded document must pass GuardDuty malware scan before processing |
| NFR-03 | Security | AI outputs are governed by Bedrock Guardrails |
| NFR-04 | Performance | PDF chunking must respect model context window limits |
| NFR-05 | Scalability | Extraction agents run in parallel to reduce processing time |
| NFR-06 | Observability | Agent telemetry via AgentCore OTEL → CloudWatch (+ LangFuse temporarily) |
| NFR-06a | Observability | AgentCore Observability Dashboard for agent invocation metrics, latency, error rates, session traces, and cost attribution |
| NFR-07 | Observability | LLM spend/usage tracked via LiteLLM Admin UI |
| NFR-08 | Observability | Step Functions execution history available for workflow debugging |
| NFR-09 | Observability | CloudWatch Cost Dashboard aggregates all cost signals |
| NFR-10 | Reliability | DynamoDB on-demand capacity for automatic scaling |
| NFR-11 | Cost | Serverless-first architecture (Lambda, DynamoDB, Step Functions) to minimize idle costs |

## 5. Document Status Lifecycle

```
Queued → Processing → In Review → Approved
                  ↘                ↘ Rejected
           Malware Detected
```

## 6. AWS Technology Stack

| Component | Service |
|-----------|---------|
| Frontend | React with MUI components |
| REST APIs | AWS Lambda + API Gateway |
| WebSocket | API Gateway WebSocket API |
| File Storage | Amazon S3 |
| Database | Amazon DynamoDB |
| Workflow | AWS Step Functions |
| Security Scan | Amazon GuardDuty (Malware Protection for S3) |
| Agent Runtime | Amazon Bedrock AgentCore |
| Agent Framework | Strands Agents SDK |
| LLM Provider | Amazon Bedrock |
| LLM Routing | LiteLLM Gateway on ECS Fargate |
| Prompt Management | Amazon Bedrock Prompt Management |
| Schema Knowledge | Amazon Bedrock Knowledge Bases |
| AI Safety | Amazon Bedrock Guardrails |
| Observability | CloudWatch, AgentCore Observability Dashboard, AgentCore OTEL, LangFuse (temp), LiteLLM Admin UI |
| Configuration | AWS Systems Manager Parameter Store |

## 7. AWS Resource Tagging

All AWS resources must be tagged with:

| Key | Value |
|-----|-------|
| `env` | `dev` |
| `application` | `document-processing` |

**AWS Region:** `us-east-1`
