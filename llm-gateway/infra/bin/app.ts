#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import { DatabaseStack } from '../lib/database-stack';
import { GatewayStack } from '../lib/gateway-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { TAGS, REGION, APP_NAME } from '../lib/constants';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

// --- Import shared VPC and security groups from vpc/ stacks ---
const vpc = ec2.Vpc.fromLookup(app.node.tryGetContext('vpcStack') ?? new cdk.Stack(app, 'VpcLookup', { env }), 'ImportedVpc', {
  tags: { application: APP_NAME },
});

// Import security groups by exported IDs
const ecsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
  app.node.tryGetContext('sgStack') ?? new cdk.Stack(app, 'SgLookup', { env }),
  'ImportedEcsSg',
  cdk.Fn.importValue(`${APP_NAME}-ecs-sg-id`)
);

const albInternalSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
  app.node.tryGetContext('sgStack2') ?? new cdk.Stack(app, 'SgLookup2', { env }),
  'ImportedAlbInternalSg',
  cdk.Fn.importValue(`${APP_NAME}-alb-internal-sg-id`)
);

const auroraDbSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
  app.node.tryGetContext('sgStack3') ?? new cdk.Stack(app, 'SgLookup3', { env }),
  'ImportedAuroraDbSg',
  cdk.Fn.importValue(`${APP_NAME}-aurora-db-sg-id`)
);

// --- Import CMKs from encryption stack ---
const kmsLookupStack = new cdk.Stack(app, 'KmsLookup', { env });
const dataKey = kms.Key.fromKeyArn(kmsLookupStack, 'DataKey',
  cdk.Fn.importValue(`${APP_NAME}-data-key-arn`));
const secretsKey = kms.Key.fromKeyArn(kmsLookupStack, 'SecretsKey',
  cdk.Fn.importValue(`${APP_NAME}-secrets-key-arn`));

// --- Database Stack ---
const databaseStack = new DatabaseStack(app, 'LlmGatewayDatabaseStack', {
  env,
  vpc,
  dbSecurityGroup: auroraDbSecurityGroup,
  dataKey,
  secretsKey,
});

// --- Import logging CMK ---
const loggingKey = kms.Key.fromKeyArn(kmsLookupStack, 'LoggingKey',
  cdk.Fn.importValue(`${APP_NAME}-logging-key-arn`));

// --- Gateway Stack ---
const gatewayStack = new GatewayStack(app, 'LlmGatewayStack', {
  env,
  vpc,
  ecsSecurityGroup,
  albSecurityGroup: albInternalSecurityGroup,
  loggingKey,
  databaseUrlSecret: databaseStack.databaseUrlSecret,
  litellmMasterKeySecret: databaseStack.litellmMasterKeySecret,
  litellmSaltKeySecret: databaseStack.litellmSaltKeySecret,
  uiCredentialsSecret: databaseStack.uiCredentialsSecret,
});

// --- Observability Stack (CloudWatch dashboard + metric filters) ---
new ObservabilityStack(app, 'LlmGatewayObservabilityStack', {
  env,
  logGroup: gatewayStack.logGroup,
  clusterName: gatewayStack.ecsClusterName,
  serviceName: gatewayStack.ecsServiceName,
  albFullName: gatewayStack.albFullName,
});

// Apply tags to all resources
for (const [key, value] of Object.entries(TAGS)) {
  cdk.Tags.of(app).add(key, value);
}
