#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { SecurityGroupsStack } from '../lib/security-groups-stack';
import { BastionStack } from '../lib/bastion-stack';
import { EncryptionStack } from '../lib/encryption-stack';
import { TAGS, REGION } from '../lib/constants';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

const vpcStack = new VpcStack(app, 'DocProcessingVpcStack', { env });

new SecurityGroupsStack(app, 'DocProcessingSecurityGroupsStack', {
  env,
  vpc: vpcStack.vpc,
});

new BastionStack(app, 'DocProcessingBastionStack', {
  env,
  vpc: vpcStack.vpc,
});

new EncryptionStack(app, 'DocProcessingEncryptionStack', { env });

// Apply tags to all resources
for (const [key, value] of Object.entries(TAGS)) {
  cdk.Tags.of(app).add(key, value);
}
