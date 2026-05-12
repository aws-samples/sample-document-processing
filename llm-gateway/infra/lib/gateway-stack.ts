import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { APP_NAME, SERVICE_NAME, REGION } from './constants';

export interface GatewayStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  ecsSecurityGroup: ec2.ISecurityGroup;
  albSecurityGroup: ec2.ISecurityGroup;
  loggingKey: kms.IKey;
  databaseUrlSecret: secretsmanager.ISecret;
  litellmMasterKeySecret: secretsmanager.ISecret;
  litellmSaltKeySecret: secretsmanager.ISecret;
  uiCredentialsSecret: secretsmanager.ISecret;
}

export class GatewayStack extends cdk.Stack {
  public readonly serviceUrl: string;
  public readonly logGroup: logs.LogGroup;
  public readonly ecsClusterName: string;
  public readonly ecsServiceName: string;
  public readonly albFullName: string;

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);

    const {
      vpc,
      ecsSecurityGroup,
      albSecurityGroup,
      loggingKey,
      databaseUrlSecret,
      litellmMasterKeySecret,
      litellmSaltKeySecret,
      uiCredentialsSecret,
    } = props;

    // --- Docker Image ---
    const imageAsset = new ecrAssets.DockerImageAsset(this, 'LlmGatewayImage', {
      directory: path.join(__dirname, '../..'),
      file: 'Dockerfile',
      platform: ecrAssets.Platform.LINUX_ARM64,
    });

    // --- ECS Cluster ---
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: SERVICE_NAME,
      containerInsights: true,
    });

    // --- Log Group ---
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/${APP_NAME}/${SERVICE_NAME}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryptionKey: loggingKey,
    });

    // --- Task Definition ---
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },
    });

    // Bedrock permissions
    taskDef.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
          `arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-*`,
        ],
      })
    );

    // Grant secrets read access
    databaseUrlSecret.grantRead(taskDef.taskRole);
    litellmMasterKeySecret.grantRead(taskDef.taskRole);
    litellmSaltKeySecret.grantRead(taskDef.taskRole);
    uiCredentialsSecret.grantRead(taskDef.taskRole);

    // --- Container ---
    const container = taskDef.addContainer('litellm', {
      image: ecs.ContainerImage.fromDockerImageAsset(imageAsset),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: SERVICE_NAME,
        logGroup: this.logGroup,
      }),
      environment: {
        AWS_REGION_NAME: REGION,
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
        LITELLM_ADMIN_KEY: ecs.Secret.fromSecretsManager(litellmMasterKeySecret),
        LITELLM_SALT_KEY: ecs.Secret.fromSecretsManager(litellmSaltKeySecret),
        UI_USERNAME: ecs.Secret.fromSecretsManager(uiCredentialsSecret, 'username'),
        UI_PASSWORD: ecs.Secret.fromSecretsManager(uiCredentialsSecret, 'password'),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'python -c "import urllib.request; urllib.request.urlopen(\'http://localhost:4000/health/liveliness\')" || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120),
      },
      portMappings: [
        { containerPort: 4000, name: 'proxy' },
      ],
    });

    // --- Fargate Service ---
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      enableExecuteCommand: true,
      circuitBreaker: { rollback: true },
      serviceName: `${SERVICE_NAME}-service`,
    });

    // --- Auto-scaling ---
    const scaling = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // --- ALB (internal, fronted by CloudFront VPC Origin) ---
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: false,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      idleTimeout: cdk.Duration.seconds(3600),
    });

    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    listener.addTargets('LitellmTarget', {
      port: 4000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health/liveliness',
        port: '4000',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // --- CloudFront Distribution (VPC Origin → internal ALB) ---
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${APP_NAME} ${SERVICE_NAME} - CloudFront VPC Origin`,
      defaultBehavior: {
        origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
          httpPort: 80,
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          readTimeout: cdk.Duration.seconds(60),
          keepaliveTimeout: cdk.Duration.seconds(60),
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    this.serviceUrl = `https://${distribution.distributionDomainName}`;
    this.ecsClusterName = cluster.clusterName;
    this.ecsServiceName = service.serviceName;
    this.albFullName = alb.loadBalancerFullName;

    // --- Outputs ---
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      exportName: `${APP_NAME}-${SERVICE_NAME}-alb-dns`,
      description: 'Internal ALB DNS for LLM Gateway',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      exportName: `${APP_NAME}-${SERVICE_NAME}-cloudfront-domain`,
      description: 'CloudFront domain for LLM Gateway',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      exportName: `${APP_NAME}-${SERVICE_NAME}-cloudfront-distribution-id`,
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      exportName: `${APP_NAME}-${SERVICE_NAME}-cluster-name`,
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: service.serviceName,
      exportName: `${APP_NAME}-${SERVICE_NAME}-service-name`,
    });
  }
}
