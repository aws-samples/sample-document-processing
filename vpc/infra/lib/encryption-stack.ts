import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { APP_NAME } from './constants';

export class EncryptionStack extends cdk.Stack {
  public readonly dataKey: kms.Key;
  public readonly secretsKey: kms.Key;
  public readonly loggingKey: kms.Key;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CMK 1: Data at rest — S3 buckets, DynamoDB tables, Aurora
    this.dataKey = new kms.Key(this, 'DataKey', {
      alias: `${APP_NAME}/data`,
      description: 'Encrypts data at rest: S3 objects, DynamoDB tables, Aurora storage',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.dataKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowServiceAccess',
      principals: [new iam.ServicePrincipal('s3.amazonaws.com')],
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'aws:SourceAccount': this.account },
      },
    }));

    // CMK 2: Secrets — Secrets Manager secrets (DB creds, API keys, salt)
    this.secretsKey = new kms.Key(this, 'SecretsKey', {
      alias: `${APP_NAME}/secrets`,
      description: 'Encrypts secrets: DB credentials, LiteLLM admin/salt keys, UI credentials',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // CMK 3: Logging — CloudWatch Logs, Step Functions execution logs
    this.loggingKey = new kms.Key(this, 'LoggingKey', {
      alias: `${APP_NAME}/logging`,
      description: 'Encrypts logs: Step Functions execution logs, LLM Gateway logs',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.loggingKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogs',
      principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
      actions: [
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:DescribeKey',
      ],
      resources: ['*'],
      conditions: {
        ArnLike: {
          'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${this.region}:${this.account}:log-group:*`,
        },
      },
    }));

    // --- Outputs ---
    new cdk.CfnOutput(this, 'DataKeyArn', {
      value: this.dataKey.keyArn,
      exportName: `${APP_NAME}-data-key-arn`,
    });

    new cdk.CfnOutput(this, 'SecretsKeyArn', {
      value: this.secretsKey.keyArn,
      exportName: `${APP_NAME}-secrets-key-arn`,
    });

    new cdk.CfnOutput(this, 'LoggingKeyArn', {
      value: this.loggingKey.keyArn,
      exportName: `${APP_NAME}-logging-key-arn`,
    });
  }
}
