import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import * as path from 'path';
import { APP_NAME, DOCUMENT_BUCKET_PREFIX } from './constants';

export class WorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // nosemgrep: path-join-resolve-traversal — static CDK build paths, no user input
    const lambdasDir = path.resolve(__dirname, '..', '..', 'lambdas');
    const sharedDir = path.resolve(__dirname, '..', '..', '..', 'backend', 'shared');

    // ── Required CDK context / environment values ─────────────────────────
    const guarddutyDetectorId = this.node.tryGetContext('guarddutyDetectorId') || '';
    const agentRuntimeArn = this.node.tryGetContext('agentRuntimeArn');
    if (!agentRuntimeArn) {
      throw new Error(
        'CDK context value "agentRuntimeArn" is required. ' +
        'Pass it via: npx cdk deploy -c agentRuntimeArn=arn:aws:bedrock-agentcore:REGION:ACCOUNT:runtime/AGENT_ID'
      );
    }

    const documentBucketName = `${DOCUMENT_BUCKET_PREFIX}-${this.account}`;

    // ── Import cross-stack references ─────────────────────────────────────

    const notifyFnArn = cdk.Fn.importValue(`${APP_NAME}-backend-notify-fn-arn`);
    const dataKey = kms.Key.fromKeyArn(this, 'DataKey',
      cdk.Fn.importValue(`${APP_NAME}-data-key-arn`));
    const loggingKey = kms.Key.fromKeyArn(this, 'LoggingKey',
      cdk.Fn.importValue(`${APP_NAME}-logging-key-arn`));

    // ── DynamoDB: Scan Task Tokens table ──────────────────────────────────

    const taskTokenTable = new dynamodb.Table(this, 'ScanTaskTokensTable', {
      tableName: 'DocumentProcessing-ScanTaskTokens',
      partitionKey: { name: 'scanId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
    });

    // ── Reference existing resources ──────────────────────────────────────

    const docBucket = s3.Bucket.fromBucketName(this, 'DocBucket', documentBucketName);
    const documentsTable = dynamodb.Table.fromTableName(this, 'DocumentsTable', 'DocumentProcessing-Documents');

    // ── Shared Lambda Layer (reuse backend shared/) ───────────────────────

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
      description: 'Shared utilities for workflow lambdas',
    });

    // ── Common Lambda environment ─────────────────────────────────────────

    const commonEnv: Record<string, string> = {
      DOCUMENTS_TABLE: 'DocumentProcessing-Documents',
      DOCUMENT_BUCKET: documentBucketName,
      TASK_TOKEN_TABLE: taskTokenTable.tableName,
      NOTIFY_FUNCTION_ARN: notifyFnArn,
    };

    // Helper to create a Lambda function
    const createLambda = (
      name: string,
      dir: string,
      extraEnv?: Record<string, string>,
      timeout?: cdk.Duration,
    ) => {
      const fn = new lambda.Function(this, name, {
        functionName: `${APP_NAME}-wf-${dir}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'handler.handler',
        code: lambda.Code.fromAsset(path.join(lambdasDir, dir)), // nosemgrep: path-join-resolve-traversal
        layers: [sharedLayer],
        environment: { ...commonEnv, ...extraEnv },
        timeout: timeout || cdk.Duration.seconds(30),
        memorySize: 256,
      });
      return fn;
    };

    // ── Lambda Functions ──────────────────────────────────────────────────

    const triggerScanFn = createLambda('TriggerScanFn', 'trigger_scan');
    taskTokenTable.grantReadWriteData(triggerScanFn);

    const processScanResultFn = createLambda('ProcessScanResultFn', 'process_scan_result');
    taskTokenTable.grantReadWriteData(processScanResultFn);
    // send_task_success/failure permission added after state machine creation

    const retrieveDataFn = createLambda('RetrieveDataFn', 'retrieve_data', {
      SSM_PREFIX: '/document-processing/',
    });
    documentsTable.grantReadData(retrieveDataFn);
    docBucket.grantRead(retrieveDataFn);
    retrieveDataFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/document-processing/*`],
    }));

    const invokeAgentFn = createLambda('InvokeAgentFn', 'invoke_agent', {
      AGENT_RUNTIME_ARN: agentRuntimeArn,
    }, cdk.Duration.minutes(15));
    invokeAgentFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: [agentRuntimeArn, `${agentRuntimeArn}/*`, '*'],
    }));

    const persistResultsFn = createLambda('PersistResultsFn', 'persist_results');
    documentsTable.grantReadWriteData(persistResultsFn);
    docBucket.grantReadWrite(persistResultsFn);

    const notifyStatusFn = createLambda('NotifyStatusFn', 'notify_status');
    notifyStatusFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [notifyFnArn],
    }));

    const handleFailureFn = createLambda('HandleFailureFn', 'handle_failure');
    documentsTable.grantReadWriteData(handleFailureFn);
    handleFailureFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [notifyFnArn],
    }));

    // ── Step Functions State Machine (ASL) ────────────────────────────────

    const stateMachineDefinition = {
      Comment: 'Document Processing Workflow — scan, retrieve, invoke agent, persist, notify',
      StartAt: 'TriggerVirusScan',
      States: {
        // Step 1: Virus Scan (callback pattern)
        TriggerVirusScan: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke.waitForTaskToken',
          Parameters: {
            FunctionName: triggerScanFn.functionArn,
            Payload: {
              'documentId.$': '$.documentId',
              'pdfS3Path.$': '$.pdfS3Path',
              'taskToken.$': '$$.Task.Token',
            },
          },
          TimeoutSeconds: 300,
          ResultPath: '$.scanResult',
          Catch: [{
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'HandleFailure',
          }],
          Next: 'CheckScanResult',
        },

        // Choice: route based on scan result
        CheckScanResult: {
          Type: 'Choice',
          Choices: [{
            Variable: '$.scanResult.scanResult',
            StringEquals: 'CLEAN',
            Next: 'ParallelRetrieval',
          }],
          Default: 'HandleMalwareDetected',
        },

        // Malware detected — fail path
        HandleMalwareDetected: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: handleFailureFn.functionArn,
            Payload: {
              'documentId.$': '$.documentId',
              'error': 'MalwareDetected',
              'cause.$': "States.Format('Malware detected in document {}', $.documentId)",
            },
          },
          ResultPath: '$.failureResult',
          End: true,
        },

        // Step 2: Parallel data retrieval
        ParallelRetrieval: {
          Type: 'Parallel',
          ResultPath: '$.retrievalResults',
          Branches: [
            {
              StartAt: 'RetrieveCustomFields',
              States: {
                RetrieveCustomFields: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::lambda:invoke',
                  Parameters: {
                    FunctionName: retrieveDataFn.functionArn,
                    Payload: {
                      'retrievalType': 'custom_fields',
                      'documentId.$': '$.documentId',
                      'schemaType.$': '$.schemaType',
                    },
                  },
                  ResultSelector: { 'result.$': '$.Payload' },
                  OutputPath: '$.result',
                  End: true,
                },
              },
            },
            {
              StartAt: 'RetrieveLookups',
              States: {
                RetrieveLookups: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::lambda:invoke',
                  Parameters: {
                    FunctionName: retrieveDataFn.functionArn,
                    Payload: {
                      'retrievalType': 'lookups',
                      'documentId.$': '$.documentId',
                      'schemaType.$': '$.schemaType',
                    },
                  },
                  ResultSelector: { 'result.$': '$.Payload' },
                  OutputPath: '$.result',
                  End: true,
                },
              },
            },
            {
              StartAt: 'RetrieveSSMParams',
              States: {
                RetrieveSSMParams: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::lambda:invoke',
                  Parameters: {
                    FunctionName: retrieveDataFn.functionArn,
                    Payload: {
                      'retrievalType': 'ssm_params',
                      'documentId.$': '$.documentId',
                    },
                  },
                  ResultSelector: { 'result.$': '$.Payload' },
                  OutputPath: '$.result',
                  End: true,
                },
              },
            },
          ],
          Catch: [{
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'HandleFailure',
          }],
          Retry: [{
            ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2,
          }],
          Next: 'AssembleAgentInput',
        },

        // Pass state: assemble agent payload from parallel results
        AssembleAgentInput: {
          Type: 'Pass',
          Parameters: {
            'documentId.$': '$.documentId',
            'pdfS3Path.$': '$.pdfS3Path',
            'customerName.$': '$.customerName',
            'userName.$': '$.userName',
            'schemaType.$': '$.schemaType',
            'agentPayload': {
              'pdfS3Path.$': '$.pdfS3Path',
              'customerName.$': '$.customerName',
              'userName.$': '$.userName',
              'customFields.$': '$.retrievalResults[0].customFields',
              'outputSchema.$': '$.retrievalResults[0].outputSchema',
              'schemaType.$': '$.schemaType',
              'lookups.$': '$.retrievalResults[1].lookups',
              'ssmParams': {
                'chunk_size.$': '$.retrievalResults[2].params.chunk_size',
                'pages_per_chunk.$': '$.retrievalResults[2].params.pages_per_chunk',
              },
            },
          },
          Next: 'InvokeAgent',
        },

        // Step 3: Invoke AgentCore Supervisor (Lambda wrapper for extended timeout)
        InvokeAgent: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: invokeAgentFn.functionArn,
            Payload: {
              'documentId.$': '$.documentId',
              'pdfS3Path.$': '$.pdfS3Path',
              'customerName.$': '$.customerName',
              'userName.$': '$.userName',
              'customFields.$': '$.agentPayload.customFields',
              'outputSchema.$': '$.agentPayload.outputSchema',
              'schemaType.$': '$.schemaType',
              'lookups.$': '$.agentPayload.lookups',
              'ssmParams.$': '$.agentPayload.ssmParams',
            },
          },
          ResultSelector: {
            'documentId.$': '$.Payload.documentId',
            'customerName.$': '$.Payload.customerName',
            'pdfS3Path.$': '$.Payload.pdfS3Path',
            'outputS3Path.$': '$.Payload.outputS3Path',
            'errors.$': '$.Payload.errors',
          },
          TimeoutSeconds: 900,
          Retry: [{
            ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
            IntervalSeconds: 5,
            MaxAttempts: 2,
            BackoffRate: 2,
          }],
          Catch: [{
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'HandleFailureWithContext',
          }],
          Next: 'PersistResults',
        },

        // Step 4: Persist Results
        PersistResults: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: persistResultsFn.functionArn,
            Payload: {
              'documentId.$': '$.documentId',
              'customerName.$': '$.customerName',
              'pdfS3Path.$': '$.pdfS3Path',
              'outputS3Path.$': '$.outputS3Path',
              'errors.$': '$.errors',
            },
          },
          ResultSelector: {
            'documentId.$': '$.Payload.documentId',
            'customerName.$': '$.Payload.customerName',
            'pdfS3Path.$': '$.Payload.pdfS3Path',
            'status.$': '$.Payload.status',
            'outputS3Path.$': '$.Payload.outputS3Path',
          },
          Retry: [{
            ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2,
          }],
          Catch: [{
            ErrorEquals: ['States.ALL'],
            ResultPath: '$.error',
            Next: 'HandleFailureWithContext',
          }],
          Next: 'NotifyWebSocket',
        },

        // Step 5: Notify WebSocket
        NotifyWebSocket: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: notifyStatusFn.functionArn,
            Payload: {
              'documentId.$': '$.documentId',
              'customerName.$': '$.customerName',
              'pdfS3Path.$': '$.pdfS3Path',
              'status.$': '$.status',
              'outputS3Path.$': '$.outputS3Path',
            },
          },
          ResultPath: '$.notifyResult',
          Retry: [{
            ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2,
          }],
          End: true,
        },

        // Error handler (early stages — documentId available at top level)
        HandleFailure: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: handleFailureFn.functionArn,
            Payload: {
              'documentId.$': '$.documentId',
              'error.$': '$.error.Error',
              'cause.$': '$.error.Cause',
            },
          },
          ResultPath: '$.failureResult',
          End: true,
        },

        // Error handler (later stages — documentId might be nested)
        HandleFailureWithContext: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: handleFailureFn.functionArn,
            Payload: {
              'documentId.$': '$.documentId',
              'error.$': '$.error.Error',
              'cause.$': '$.error.Cause',
            },
          },
          ResultPath: '$.failureResult',
          End: true,
        },
      },
    };

    // ── Create State Machine ──────────────────────────────────────────────

    const logGroup = new logs.LogGroup(this, 'WorkflowLogGroup', {
      logGroupName: `/aws/stepfunctions/${APP_NAME}-workflow`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryptionKey: loggingKey,
    });

    const stateMachine = new sfn.StateMachine(this, 'WorkflowStateMachine', {
      stateMachineName: `${APP_NAME}-workflow`,
      definitionBody: sfn.DefinitionBody.fromString(JSON.stringify(stateMachineDefinition)),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ERROR,
        includeExecutionData: true,
      },
    });

    // Grant state machine permission to invoke workflow Lambdas + AgentCore
    stateMachine.grantTaskResponse(processScanResultFn);
    // trigger_scan also needs task response permissions (for race condition handling)
    // Using explicit policy to avoid circular dependency with grantInvoke below
    triggerScanFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
      resources: ['*'],
    }));
    triggerScanFn.grantInvoke(stateMachine);
    retrieveDataFn.grantInvoke(stateMachine);
    persistResultsFn.grantInvoke(stateMachine);
    notifyStatusFn.grantInvoke(stateMachine);
    handleFailureFn.grantInvoke(stateMachine);

    invokeAgentFn.grantInvoke(stateMachine);

    // ── EventBridge Rule: GuardDuty scan completion ───────────────────────

    const scanCompleteRule = new events.Rule(this, 'GuardDutyMalwareScanComplete', {
      ruleName: `${APP_NAME}-guardduty-scan-complete`,
      description: 'Routes GuardDuty malware scan results to the workflow callback handler',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Malware Protection Object Scan Result'],
      },
    });

    scanCompleteRule.addTarget(new targets.LambdaFunction(processScanResultFn));

    // ── Outputs ───────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Workflow State Machine ARN',
      exportName: `${APP_NAME}-workflow-state-machine-arn`,
    });

    new cdk.CfnOutput(this, 'StateMachineName', {
      value: stateMachine.stateMachineName!,
      description: 'Workflow State Machine Name',
    });

    new cdk.CfnOutput(this, 'TaskTokenTableName', {
      value: taskTokenTable.tableName,
      description: 'Scan task token DynamoDB table name',
    });
  }
}
