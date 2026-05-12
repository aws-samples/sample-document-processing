import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';
import { APP_NAME, DOCUMENT_BUCKET_PREFIX } from './constants';

export class BackendStack extends cdk.Stack {
  public readonly restApiUrl: string;
  public readonly websocketApiUrl: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // nosemgrep: path-join-resolve-traversal — static CDK build paths, no user input
    const lambdasDir = path.resolve(__dirname, '..', '..', 'lambdas');
    const sharedDir = path.resolve(__dirname, '..', '..', 'shared');

    // ── Import CMK for data-at-rest encryption ─────────────────────────────
    const dataKey = kms.Key.fromKeyArn(this, 'DataKey',
      cdk.Fn.importValue(`${APP_NAME}-data-key-arn`));

    // ── DynamoDB Tables ─────────────────────────────────────────────────────

    const documentsTable = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: 'DocumentProcessing-Documents',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
    });

    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'DocumentProcessing-WebSocketConnections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
    });

    // ── Shared Lambda Layer (shared/ utilities) ─────────────────────────────

    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset(sharedDir, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'mkdir -p /asset-output/python/shared && cp -r /asset-input/* /asset-output/python/shared/',
          ],
        },
      }),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared utilities for backend lambdas',
    });

    // ── Reference the existing document bucket ──────────────────────────────

    const documentBucketName = `${DOCUMENT_BUCKET_PREFIX}-${this.account}`;
    const docBucket = s3.Bucket.fromBucketName(this, 'DocBucket', documentBucketName);

    // ── Common Lambda environment ───────────────────────────────────────────

    const commonEnv: Record<string, string> = {
      DOCUMENTS_TABLE: documentsTable.tableName,
      CONNECTIONS_TABLE: connectionsTable.tableName,
      DOCUMENT_BUCKET: documentBucketName,
    };

    // Helper to create a Lambda function
    const createLambda = (name: string, dir: string, extraEnv?: Record<string, string>) => {
      const fn = new lambda.Function(this, name, {
        functionName: `${APP_NAME}-${dir}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'handler.handler',
        code: lambda.Code.fromAsset(path.join(lambdasDir, dir)), // nosemgrep: path-join-resolve-traversal
        layers: [sharedLayer],
        environment: { ...commonEnv, ...extraEnv },
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
      });
      documentsTable.grantReadWriteData(fn);
      connectionsTable.grantReadWriteData(fn);
      return fn;
    };

    // ── REST Lambda Functions ───────────────────────────────────────────────

    const requestSignedUrlFn = createLambda('RequestSignedUrlFn', 'request_signedurl');
    docBucket.grantPut(requestSignedUrlFn);
    // Grant s3:PutObject for pre-signed URL generation
    requestSignedUrlFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [docBucket.arnForObjects('uploads/*')],
    }));

    const startWorkflowFn = createLambda('StartWorkflowFn', 'start_workflow');
    // Step Functions permission will be added when workflow is deployed
    startWorkflowFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: ['*'], // Scoped to specific state machine via env var at runtime
    }));

    const listDocumentsFn = createLambda('ListDocumentsFn', 'list_documents');

    const getDocumentFn = createLambda('GetDocumentFn', 'get_document');
    docBucket.grantRead(getDocumentFn);

    const updateStatusFn = createLambda('UpdateStatusFn', 'update_status');

    // ── REST API Gateway ────────────────────────────────────────────────────

    const restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: `${APP_NAME}-api`,
      description: 'Document Processing REST API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'dev',
      },
    });

    // GET /presigned-url
    const presignedUrlResource = restApi.root.addResource('presigned-url');
    presignedUrlResource.addMethod('GET', new apigateway.LambdaIntegration(requestSignedUrlFn));

    // POST /workflow/start
    const workflowResource = restApi.root.addResource('workflow');
    const workflowStartResource = workflowResource.addResource('start');
    workflowStartResource.addMethod('POST', new apigateway.LambdaIntegration(startWorkflowFn));

    // GET /documents
    const documentsResource = restApi.root.addResource('documents');
    documentsResource.addMethod('GET', new apigateway.LambdaIntegration(listDocumentsFn));

    // GET /documents/{id}
    const documentByIdResource = documentsResource.addResource('{id}');
    documentByIdResource.addMethod('GET', new apigateway.LambdaIntegration(getDocumentFn));

    // PATCH /documents/{id}/status
    const statusResource = documentByIdResource.addResource('status');
    statusResource.addMethod('PATCH', new apigateway.LambdaIntegration(updateStatusFn));

    this.restApiUrl = restApi.url;

    // ── WebSocket Lambda Functions ──────────────────────────────────────────

    const wsConnectFn = createLambda('WsConnectFn', 'websocket_connect');
    const wsDisconnectFn = createLambda('WsDisconnectFn', 'websocket_disconnect');
    const wsNotifyFn = createLambda('WsNotifyFn', 'notify_websocket');

    // ── WebSocket API Gateway ───────────────────────────────────────────────

    const webSocketApi = new apigwv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `${APP_NAME}-ws`,
      description: 'Document Processing WebSocket API',
      connectRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration('ConnectIntegration', wsConnectFn),
      },
      disconnectRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration('DisconnectIntegration', wsDisconnectFn),
      },
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'dev',
      autoDeploy: true,
    });

    // The callback URL for postToConnection
    const wsCallbackUrl = `https://${webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`;

    // Grant the notify function permission to post to connections
    wsNotifyFn.addEnvironment('WEBSOCKET_API_ENDPOINT', wsCallbackUrl);
    wsNotifyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
      ],
    }));

    this.websocketApiUrl = `wss://${webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`;

    // ── Outputs ─────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'RestApiUrl', {
      value: restApi.url,
      description: 'REST API URL',
      exportName: `${APP_NAME}-backend-rest-api-url`,
    });

    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: this.websocketApiUrl,
      description: 'WebSocket API URL',
      exportName: `${APP_NAME}-backend-ws-api-url`,
    });

    new cdk.CfnOutput(this, 'DocumentsTableName', {
      value: documentsTable.tableName,
      description: 'Documents DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'ConnectionsTableName', {
      value: connectionsTable.tableName,
      description: 'WebSocket connections DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'NotifyFunctionArn', {
      value: wsNotifyFn.functionArn,
      description: 'WebSocket notify Lambda ARN (for Step Functions to invoke)',
      exportName: `${APP_NAME}-backend-notify-fn-arn`,
    });
  }
}
