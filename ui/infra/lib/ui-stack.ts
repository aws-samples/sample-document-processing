import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';
import { APP_NAME, SERVICE_NAME } from './constants';

export class UiStack extends cdk.Stack {
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for static site hosting (private — access only via CloudFront OAC)
    // Access logs bucket must use SSE-S3 (KMS not supported for log delivery)
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `${APP_NAME}-${SERVICE_NAME}-access-logs-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
    });

    // CMK for site bucket encryption at rest
    const siteKey = new kms.Key(this, 'SiteBucketKey', {
      alias: `${APP_NAME}-${SERVICE_NAME}-site-key`,
      description: 'CMK for UI static site S3 bucket encryption at rest',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `${APP_NAME}-${SERVICE_NAME}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: siteKey,
      bucketKeyEnabled: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'site-bucket/',
    });

    // Enforce encryption in transit (PCSR requirement)
    siteBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'EnforceSecureTransport',
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ['s3:*'],
      resources: [siteBucket.bucketArn, `${siteBucket.bucketArn}/*`],
      conditions: {
        Bool: { 'aws:SecureTransport': 'false' },
      },
    }));

    // CloudFront distribution with S3 Origin Access Control
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${APP_NAME} ${SERVICE_NAME} — static site`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // SPA routing: redirect 403/404 to index.html so client-side routing works
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    this.distributionDomainName = distribution.distributionDomainName;

    // Deploy the Next.js static export to S3 and invalidate CloudFront
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../out'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'UI CloudFront domain',
      exportName: `${APP_NAME}-${SERVICE_NAME}-cloudfront-domain`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'UI CloudFront distribution ID',
      exportName: `${APP_NAME}-${SERVICE_NAME}-distribution-id`,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
      description: 'UI S3 bucket name',
      exportName: `${APP_NAME}-${SERVICE_NAME}-bucket-name`,
    });
  }
}
