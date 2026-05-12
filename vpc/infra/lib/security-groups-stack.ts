import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { APP_NAME } from './constants';

export interface SecurityGroupsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class SecurityGroupsStack extends cdk.Stack {
  public readonly albExternalSg: ec2.SecurityGroup;
  public readonly albInternalSg: ec2.SecurityGroup;
  public readonly ecsSg: ec2.SecurityGroup;
  public readonly auroraDbSg: ec2.SecurityGroup;
  public readonly dynamoDbEndpointSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SecurityGroupsStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    // --- External ALB (internet-facing, for UI) ---
    this.albExternalSg = new ec2.SecurityGroup(this, 'AlbExternalSg', {
      vpc,
      securityGroupName: `${APP_NAME}-alb-external-sg`,
      description: 'External ALB -internet-facing for UI',
      allowAllOutbound: true,
    });
    this.albExternalSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS from internet'
    );
    this.albExternalSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP from internet (redirect to HTTPS)'
    );

    // --- Internal ALB (for LLM Gateway, agent-to-service traffic) ---
    this.albInternalSg = new ec2.SecurityGroup(this, 'AlbInternalSg', {
      vpc,
      securityGroupName: `${APP_NAME}-alb-internal-sg`,
      description: 'Internal ALB -VPC-only traffic for LLM Gateway',
      allowAllOutbound: true,
    });
    this.albInternalSg.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'HTTP from VPC'
    );
    this.albInternalSg.addIngressRule(
      ec2.Peer.prefixList('pl-3b927c52'),
      ec2.Port.tcp(80),
      'HTTP from CloudFront origin-facing IPs'
    );

    // --- ECS Tasks (LLM Gateway + future services) ---
    this.ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      securityGroupName: `${APP_NAME}-ecs-sg`,
      description: 'ECS Fargate tasks',
      allowAllOutbound: true,
    });
    this.ecsSg.addIngressRule(
      this.albInternalSg,
      ec2.Port.tcp(4000),
      'LiteLLM proxy from internal ALB'
    );
    this.ecsSg.addIngressRule(
      this.albInternalSg,
      ec2.Port.tcp(8001),
      'LiteLLM health check from internal ALB'
    );
    this.ecsSg.addIngressRule(
      this.albExternalSg,
      ec2.Port.tcp(3000),
      'UI app from external ALB'
    );

    // --- Aurora Serverless v2 (LiteLLM internal DB) ---
    this.auroraDbSg = new ec2.SecurityGroup(this, 'AuroraDbSg', {
      vpc,
      securityGroupName: `${APP_NAME}-aurora-db-sg`,
      description: 'Aurora Serverless v2 PostgreSQL -LiteLLM spend tracking',
      allowAllOutbound: false,
    });
    this.auroraDbSg.addIngressRule(
      this.ecsSg,
      ec2.Port.tcp(5432),
      'PostgreSQL from ECS tasks'
    );

    // --- VPC Endpoint for DynamoDB (gateway endpoint, no SG needed but useful for tagging) ---
    this.dynamoDbEndpointSg = new ec2.SecurityGroup(this, 'DynamoDbEndpointSg', {
      vpc,
      securityGroupName: `${APP_NAME}-dynamodb-endpoint-sg`,
      description: 'DynamoDB VPC Gateway Endpoint -Lambda and ECS access',
      allowAllOutbound: false,
    });
    this.dynamoDbEndpointSg.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'HTTPS from VPC for DynamoDB'
    );

    // --- DynamoDB Gateway Endpoint ---
    vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    // --- S3 Gateway Endpoint ---
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    // --- CloudFormation Exports ---
    new cdk.CfnOutput(this, 'AlbExternalSgId', {
      value: this.albExternalSg.securityGroupId,
      exportName: `${APP_NAME}-alb-external-sg-id`,
    });

    new cdk.CfnOutput(this, 'AlbInternalSgId', {
      value: this.albInternalSg.securityGroupId,
      exportName: `${APP_NAME}-alb-internal-sg-id`,
    });

    new cdk.CfnOutput(this, 'EcsSgId', {
      value: this.ecsSg.securityGroupId,
      exportName: `${APP_NAME}-ecs-sg-id`,
    });

    new cdk.CfnOutput(this, 'AuroraDbSgId', {
      value: this.auroraDbSg.securityGroupId,
      exportName: `${APP_NAME}-aurora-db-sg-id`,
    });
  }
}
