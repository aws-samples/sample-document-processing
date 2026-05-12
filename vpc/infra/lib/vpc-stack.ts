import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { APP_NAME, VPC_CIDR } from './constants';

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const cidr = this.node.tryGetContext('vpcCidr') || VPC_CIDR;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${APP_NAME}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(cidr),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // VPC Flow Logs to CloudWatch
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: ec2.FlowLogTrafficType.REJECT,
    });

    // --- CloudFormation Exports ---
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      exportName: `${APP_NAME}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'VpcCidr', {
      value: this.vpc.vpcCidrBlock,
      exportName: `${APP_NAME}-vpc-cidr`,
    });

    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(','),
      exportName: `${APP_NAME}-public-subnet-ids`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.privateSubnets.map((s) => s.subnetId).join(','),
      exportName: `${APP_NAME}-private-subnet-ids`,
    });
  }
}
