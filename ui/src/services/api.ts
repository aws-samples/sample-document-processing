import { v4 as uuidv4 } from 'uuid';
import type {
  DocumentRecord,
  DocumentStatus,
  PresignedUrlResponse,
  StartWorkflowRequest,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ---------------------------------------------------------------------------
// Mock data — used until the backend API (Lambda + API Gateway) is deployed
// ---------------------------------------------------------------------------

const MOCK_DOCUMENTS: DocumentRecord[] = [
  {
    id: 'doc-001',
    customerName: 'Pinnacle Financial Group',
    userName: '',
    documentName: 'invoice-2024-0451.pdf',
    status: 'Approved',
    createdAt: '2026-04-20T14:30:00Z',
    updatedAt: '2026-04-20T15:12:00Z',
    pdfS3Path: 's3://document-processing-123456789012/uploads/doc-001/invoice-2024-0451.pdf',
    outputS3Path: 's3://document-processing-123456789012/output/doc-001/result.json',
    extractedData: {
      invoice_number: 'INV-2024-0451',
      vendor_name: 'Acme Supplies Inc.',
      invoice_date: '2024-03-15',
      due_date: '2024-04-15',
      total_amount: 12450.0,
      currency: 'USD',
      line_items: [
        { description: 'Widget A', quantity: 100, unit_price: 49.5, amount: 4950.0 },
        { description: 'Widget B', quantity: 150, unit_price: 50.0, amount: 7500.0 },
      ],
    },
  },
  {
    id: 'doc-002',
    customerName: 'Redwood Manufacturing Co.',
    userName: '',
    documentName: 'invoice-2024-0452.pdf',
    status: 'In Review',
    createdAt: '2026-04-22T09:15:00Z',
    updatedAt: '2026-04-22T09:45:00Z',
    pdfS3Path: 's3://document-processing-123456789012/uploads/doc-002/invoice-2024-0452.pdf',
    outputS3Path: 's3://document-processing-123456789012/output/doc-002/result.json',
    extractedData: {
      invoice_number: 'INV-2024-0452',
      vendor_name: 'Global Parts Ltd.',
      invoice_date: '2024-03-20',
      due_date: '2024-04-20',
      total_amount: 8750.0,
      currency: 'USD',
      line_items: [
        { description: 'Component X', quantity: 50, unit_price: 175.0, amount: 8750.0 },
      ],
    },
  },
  {
    id: 'doc-003',
    customerName: 'Horizon Healthcare Systems',
    userName: '',
    documentName: 'po-2024-789.pdf',
    status: 'Processing',
    createdAt: '2026-04-25T16:00:00Z',
    updatedAt: '2026-04-25T16:05:00Z',
    pdfS3Path: 's3://document-processing-123456789012/uploads/doc-003/po-2024-789.pdf',
  },
  {
    id: 'doc-004',
    customerName: 'Atlas Global Logistics',
    userName: '',
    documentName: 'receipt-march.pdf',
    status: 'Queued',
    createdAt: '2026-04-26T10:30:00Z',
    updatedAt: '2026-04-26T10:30:00Z',
    pdfS3Path: 's3://document-processing-123456789012/uploads/doc-004/receipt-march.pdf',
  },
  {
    id: 'doc-005',
    customerName: 'Crestview Energy Partners',
    userName: '',
    documentName: 'invoice-2024-0400.pdf',
    status: 'Rejected',
    createdAt: '2026-04-18T11:00:00Z',
    updatedAt: '2026-04-19T08:30:00Z',
    pdfS3Path: 's3://document-processing-123456789012/uploads/doc-005/invoice-2024-0400.pdf',
    extractedData: {
      invoice_number: null,
      vendor_name: 'Unknown',
      total_amount: 0,
    },
  },
];

let mockDocuments = [...MOCK_DOCUMENTS];

// ---------------------------------------------------------------------------
// API functions — mock implementations, swap with real fetch calls later
// ---------------------------------------------------------------------------

/** GET /presigned-url — request a pre-signed S3 URL for PDF upload */
export async function getPresignedUrl(
  fileName: string,
  customerName: string,
  userName: string
): Promise<PresignedUrlResponse> {
  if (API_URL) {
    const params = new URLSearchParams({ fileName, customerName, userName });
    const res = await fetch(`${API_URL}/presigned-url?${params}`);
    if (!res.ok) throw new Error(`Failed to get presigned URL: ${res.statusText}`);
    return res.json();
  }

  // Mock: return a fake presigned URL
  const documentId = `doc-${uuidv4().slice(0, 8)}`;
  return {
    uploadUrl: `https://document-processing-123456789012.s3.amazonaws.com/uploads/${documentId}/${fileName}?X-Amz-Algorithm=mock`,
    documentId,
    s3Path: `s3://document-processing-123456789012/uploads/${documentId}/${fileName}`,
  };
}

/** PUT file to the pre-signed S3 URL */
export async function uploadFileToS3(uploadUrl: string, file: File): Promise<void> {
  if (API_URL) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'application/pdf' },
    });
    if (!res.ok) throw new Error(`S3 upload failed: ${res.statusText}`);
    return;
  }

  // Mock: simulate upload delay
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

/** POST /workflow/start — start the document processing workflow */
export async function startWorkflow(request: StartWorkflowRequest): Promise<void> {
  if (API_URL) {
    const res = await fetch(`${API_URL}/workflow/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`Failed to start workflow: ${res.statusText}`);
    return;
  }

  // Mock: add a new Queued document
  const newDoc: DocumentRecord = {
    id: request.documentId,
    customerName: request.customerName,
    userName: request.userName,
    documentName: request.documentId + '.pdf',
    status: 'Queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pdfS3Path: `s3://document-processing-123456789012/uploads/${request.documentId}/document.pdf`,
  };
  mockDocuments = [newDoc, ...mockDocuments];
}

/** GET /documents — list all documents */
export async function listDocuments(): Promise<DocumentRecord[]> {
  if (API_URL) {
    const res = await fetch(`${API_URL}/documents`);
    if (!res.ok) throw new Error(`Failed to list documents: ${res.statusText}`);
    return res.json();
  }

  // Mock
  return [...mockDocuments];
}

/** GET /documents/:id — get a single document with extracted data */
export async function getDocument(id: string): Promise<DocumentRecord> {
  if (API_URL) {
    const res = await fetch(`${API_URL}/documents/${id}`);
    if (!res.ok) throw new Error(`Failed to get document: ${res.statusText}`);
    return res.json();
  }

  // Mock
  const doc = mockDocuments.find((d) => d.id === id);
  if (!doc) throw new Error(`Document not found: ${id}`);
  return { ...doc };
}

/** PATCH /documents/:id/status — approve or reject a document */
export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus
): Promise<DocumentRecord> {
  if (API_URL) {
    const res = await fetch(`${API_URL}/documents/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`Failed to update status: ${res.statusText}`);
    return res.json();
  }

  // Mock: update in-memory
  const idx = mockDocuments.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`Document not found: ${id}`);
  mockDocuments[idx] = {
    ...mockDocuments[idx],
    status,
    updatedAt: new Date().toISOString(),
  };
  return { ...mockDocuments[idx] };
}
