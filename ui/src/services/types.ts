export type DocumentStatus = 'Queued' | 'Processing' | 'In Review' | 'Rejected' | 'Approved' | 'Failed' | 'Malware Detected';

export interface DocumentRecord {
  id: string;
  customerName: string;
  userName: string;
  documentName: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  pdfS3Path: string;
  outputS3Path?: string;
  extractedData?: Record<string, unknown>;
  errorMessage?: string;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  documentId: string;
  s3Path: string;
}

export interface StartWorkflowRequest {
  documentId: string;
  customerName: string;
  userName: string;
  customFields: CustomField[];
  schemaType?: string;
}

export interface CustomField {
  fieldKey: string;
  fieldType: string;
  description: string;
}
