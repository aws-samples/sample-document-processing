export const APP_NAME = 'document-processing';
export const SERVICE_NAME = 'backend';
export const REGION = 'us-east-1';

export const TAGS: Record<string, string> = {
  env: 'dev',
  application: 'document-processing',
  service: 'backend',
};

// Bucket name is constructed at deploy time using the AWS account ID from the stack.
// See BackendStack for usage: `${APP_NAME}-${cdk.Stack.of(this).account}`
export const DOCUMENT_BUCKET_PREFIX = APP_NAME;
