import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { APP_NAME, SERVICE_NAME } from './constants';

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  dbSecurityGroup: ec2.ISecurityGroup;
  dataKey: kms.IKey;
  secretsKey: kms.IKey;
}

export class DatabaseStack extends cdk.Stack {
  public readonly dbCluster: rds.DatabaseCluster;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly databaseUrlSecret: secretsmanager.Secret;
  public readonly litellmMasterKeySecret: secretsmanager.Secret;
  public readonly litellmSaltKeySecret: secretsmanager.Secret;
  public readonly uiCredentialsSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, dbSecurityGroup, dataKey, secretsKey } = props;

    // --- Aurora Serverless v2 PostgreSQL Cluster ---
    this.dbCluster = new rds.DatabaseCluster(this, 'LitellmDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('litellm', {
        secretName: `${APP_NAME}/${SERVICE_NAME}/db-credentials`,
        encryptionKey: secretsKey,
      }),
      defaultDatabaseName: 'litellm',
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 1,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      storageEncrypted: true,
      storageEncryptionKey: dataKey,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      clusterIdentifier: `${SERVICE_NAME}-db`,
    });

    this.dbSecret = this.dbCluster.secret!;

    // --- LiteLLM Admin Key (must start with sk-) ---
    // Defined before the custom resource that references it
    this.litellmMasterKeySecret = new secretsmanager.Secret(this, 'LitellmMasterKey', {
      secretName: `${APP_NAME}/${SERVICE_NAME}/admin-key`,
      description: 'LiteLLM admin API key',
      encryptionKey: secretsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ prefix: 'sk-' }),
        generateStringKey: 'suffix',
        excludePunctuation: true,
        passwordLength: 32,
        includeSpace: false,
      },
    });

    // --- Assemble DATABASE_URL secret ---
    this.databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrl', {
      secretName: `${APP_NAME}/${SERVICE_NAME}/database-url`,
      description: 'LiteLLM DATABASE_URL connection string',
      encryptionKey: secretsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText('placeholder'),
    });

    // Use a custom resource to assemble the URL from the DB secret
    const assembleUrl = new cdk.CustomResource(this, 'AssembleDatabaseUrl', {
      serviceToken: cdk.CustomResourceProvider.getOrCreate(this, 'AssembleDbUrl', {
        runtime: cdk.CustomResourceProviderRuntime.NODEJS_20_X,
        codeDirectory: `${__dirname}/assemble-db-url-handler`,
        policyStatements: [
          {
            Effect: 'Allow',
            Action: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue'],
            Resource: [this.dbSecret.secretArn, this.databaseUrlSecret.secretArn, this.litellmMasterKeySecret.secretArn],
          },
        ],
      }),
      properties: {
        DbSecretArn: this.dbSecret.secretArn,
        UrlSecretArn: this.databaseUrlSecret.secretArn,
        MasterKeySecretArn: this.litellmMasterKeySecret.secretArn,
        DatabaseName: 'litellm',
      },
    });
    assembleUrl.node.addDependency(this.dbCluster);

    // --- LiteLLM Salt Key ---
    this.litellmSaltKeySecret = new secretsmanager.Secret(this, 'LitellmSaltKey', {
      secretName: `${APP_NAME}/${SERVICE_NAME}/salt-key`,
      description: 'LiteLLM encryption salt key',
      encryptionKey: secretsKey,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
        includeSpace: false,
      },
    });

    // --- UI Credentials ---
    this.uiCredentialsSecret = new secretsmanager.Secret(this, 'UiCredentials', {
      secretName: `${APP_NAME}/${SERVICE_NAME}/ui-credentials`,
      description: 'LiteLLM Admin UI credentials',
      encryptionKey: secretsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 24,
      },
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'DbClusterEndpoint', {
      value: this.dbCluster.clusterEndpoint.hostname,
      exportName: `${APP_NAME}-${SERVICE_NAME}-db-endpoint`,
    });

    new cdk.CfnOutput(this, 'DatabaseUrlSecretArn', {
      value: this.databaseUrlSecret.secretArn,
      exportName: `${APP_NAME}-${SERVICE_NAME}-database-url-secret-arn`,
    });

    new cdk.CfnOutput(this, 'MasterKeySecretArn', {
      value: this.litellmMasterKeySecret.secretArn,
      exportName: `${APP_NAME}-${SERVICE_NAME}-admin-key-secret-arn`,
    });
  }
}
