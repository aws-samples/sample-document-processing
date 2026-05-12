import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { APP_NAME } from './constants';

export interface BastionStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class BastionStack extends cdk.Stack {
  public readonly instance: ec2.BastionHostLinux;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: BastionStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    // Security group — SSM manages connectivity, only need VPC egress
    this.securityGroup = new ec2.SecurityGroup(this, 'BastionSg', {
      vpc,
      securityGroupName: `${APP_NAME}-bastion-sg`,
      description: 'Bastion host for SSM tunneling to internal resources',
      allowAllOutbound: true,
    });

    // Bastion host — Amazon Linux 2023, ARM64 (t4g.micro for cost)
    this.instance = new ec2.BastionHostLinux(this, 'Bastion', {
      vpc,
      instanceName: `${APP_NAME}-bastion`,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: this.securityGroup,
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
      requireImdsv2: true,
    });

    // Allow bastion to reach internal ALB (LLM Gateway UI, etc.)
    this.securityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.allTcp(),
      'Access to all VPC resources'
    );

    // Outputs
    new cdk.CfnOutput(this, 'BastionInstanceId', {
      value: this.instance.instanceId,
      exportName: `${APP_NAME}-bastion-instance-id`,
    });

    new cdk.CfnOutput(this, 'BastionSgId', {
      value: this.securityGroup.securityGroupId,
      exportName: `${APP_NAME}-bastion-sg-id`,
    });

    new cdk.CfnOutput(this, 'SsmConnectCommand', {
      value: `aws ssm start-session --target ${this.instance.instanceId} --region ${this.region}`,
      description: 'Connect to bastion via SSM',
    });

    const portForwardParams = '\'{"host":["<LLM_GATEWAY_ALB_DNS>"],"portNumber":["80"],"localPortNumber":["4000"]}\'';
    new cdk.CfnOutput(this, 'PortForwardCommand', {
      value: `aws ssm start-session --target ${this.instance.instanceId} --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters ${portForwardParams} --region ${this.region}`,
      description: 'Port-forward to LLM Gateway UI',
    });
  }
}
