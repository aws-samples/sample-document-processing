/**
 * Centralized UI strings for internationalization readiness.
 * Replace this module with a full i18n library (e.g., i18next) when
 * multi-language support is needed.
 */

const strings = {
  // App Header
  appName: 'Sirisha',
  appSubtitle: 'Document Processing',

  // Home Page
  uploadDocument: 'Upload Document',
  documents: 'Documents',

  // Not Found Page
  pageNotFound: 'Page Not Found',
  backToDocuments: 'Back to Documents',

  // Document Table
  searchPlaceholder: 'Search documents...',
  noDocumentsFound: 'No documents found.',
  columnDocument: 'Document',
  columnCustomer: 'Customer',
  columnStatus: 'Status',
  columnCreated: 'Created',
  columnUpdated: 'Updated',

  // File Uploader
  pdfOnlyError: 'Only PDF files are accepted.',
  fileAndCustomerRequired: 'Please provide a file and select a customer.',
  uploadSuccess: 'Document uploaded and processing started.',
  dropZoneText: 'Drop a PDF here or click to browse',
  customerLabel: 'Customer',
  uploading: 'Uploading...',
  uploadAndProcess: 'Upload & Process',

  // Review Page
  back: 'Back',
  reject: 'Reject',
  approve: 'Approve',
  customerPrefix: 'Customer: ',
  createdPrefix: 'Created: ',

  // Review Form
  vendorInformation: 'Vendor Information',
  invoiceDetails: 'Invoice Details',
  invoicePrefix: 'Invoice ',
  lineItems: 'Line Items',
} as const;

export default strings;
