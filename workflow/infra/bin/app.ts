#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WorkflowStack } from '../lib/workflow-stack';
import { TAGS, REGION } from '../lib/constants';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

new WorkflowStack(app, 'DocProcessingWorkflowStack', { env });

// Apply tags to all resources
for (const [key, value] of Object.entries(TAGS)) {
  cdk.Tags.of(app).add(key, value);
}
