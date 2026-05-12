export const APP_NAME = 'document-processing';
export const SERVICE_NAME = 'workflow';
export const REGION = 'us-east-1';

export const TAGS: Record<string, string> = {
  env: 'dev',
  application: 'document-processing',
  service: 'workflow',
};

// Bucket name is constructed at deploy time using the AWS account ID from the stack.
export const DOCUMENT_BUCKET_PREFIX = APP_NAME;

// These values MUST be provided via CDK context or environment variables.
// Example: npx cdk deploy -c guarddutyDetectorId=<YOUR_DETECTOR_ID> -c agentRuntimeArn=<YOUR_ARN>
