import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { APP_NAME, SERVICE_NAME } from './constants';

const METRIC_NAMESPACE = 'DocumentProcessing/LlmGateway';

export interface ObservabilityStackProps extends cdk.StackProps {
  logGroup: logs.ILogGroup;
  clusterName: string;
  serviceName: string;
  albFullName: string;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { logGroup, clusterName, serviceName, albFullName } = props;

    // ---------------------------------------------------------------
    // Metric Filters
    // ---------------------------------------------------------------

    // All metric lines emitted by our custom callback have litellm_metric = true
    const completedRequestPattern = logs.FilterPattern.literal('{ $.litellm_metric IS TRUE && $.status_code = 200 }');
    const allRequestPattern = logs.FilterPattern.literal('{ $.litellm_metric IS TRUE }');
    const errorRequestPattern = logs.FilterPattern.literal('{ $.litellm_metric IS TRUE && $.status_code >= 400 }');
    const appErrorPattern = logs.FilterPattern.literal('{ $.level = "ERROR" }');

    // MF-1: Request Count (all requests including errors)
    new logs.MetricFilter(this, 'MfRequestCount', {
      logGroup,
      filterPattern: allRequestPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'RequestCount',
      metricValue: '1',
      dimensions: { Model: '$.model' },
    });

    // MF-2: Input Tokens
    new logs.MetricFilter(this, 'MfInputTokens', {
      logGroup,
      filterPattern: completedRequestPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'InputTokens',
      metricValue: '$.prompt_tokens',
      dimensions: { Model: '$.model' },
    });

    // MF-3: Output Tokens
    new logs.MetricFilter(this, 'MfOutputTokens', {
      logGroup,
      filterPattern: completedRequestPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'OutputTokens',
      metricValue: '$.completion_tokens',
      dimensions: { Model: '$.model' },
    });

    // MF-4: Total Tokens
    new logs.MetricFilter(this, 'MfTotalTokens', {
      logGroup,
      filterPattern: completedRequestPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'TotalTokens',
      metricValue: '$.total_tokens',
      dimensions: { Model: '$.model' },
    });

    // MF-5: Response Cost (USD)
    new logs.MetricFilter(this, 'MfResponseCost', {
      logGroup,
      filterPattern: completedRequestPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'ResponseCostUSD',
      metricValue: '$.response_cost',
      dimensions: { Model: '$.model' },
    });

    // MF-6: Response Time (ms)
    new logs.MetricFilter(this, 'MfResponseTime', {
      logGroup,
      filterPattern: allRequestPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'ResponseTimeMs',
      metricValue: '$.response_time_ms',
      dimensions: { Model: '$.model' },
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    // MF-7: Request Errors (4xx/5xx)
    new logs.MetricFilter(this, 'MfRequestErrors', {
      logGroup,
      filterPattern: errorRequestPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'RequestErrors',
      metricValue: '1',
      dimensions: { Model: '$.model' },
    });

    // MF-8: Application Errors
    new logs.MetricFilter(this, 'MfAppErrors', {
      logGroup,
      filterPattern: appErrorPattern,
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'ApplicationErrors',
      metricValue: '1',
    });

    // ---------------------------------------------------------------
    // Helper: create a metric reference
    // ---------------------------------------------------------------
    const metric = (
      metricName: string,
      stat: string,
      opts?: { dimensionsMap?: Record<string, string>; period?: cdk.Duration },
    ) =>
      new cloudwatch.Metric({
        namespace: METRIC_NAMESPACE,
        metricName,
        statistic: stat,
        period: opts?.period ?? cdk.Duration.minutes(1),
        dimensionsMap: opts?.dimensionsMap,
      });

    // ---------------------------------------------------------------
    // Dashboard
    // ---------------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `LlmGateway-${APP_NAME}`,
      defaultInterval: cdk.Duration.hours(3),
    });

    // --- Row 0: Title ---
    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# LLM Gateway — Document Processing | ${this.region}`,
        width: 24,
        height: 1,
      }),
    );

    // --- Row 1: KPIs (sum across both models using metric math) ---
    const kpiPeriod = cdk.Duration.hours(1);
    const sonnetDim = { Model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' };
    const haikuDim = { Model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' };

    const kpiTotal = (metricName: string, label: string) =>
      new cloudwatch.MathExpression({
        expression: 'sonnet + haiku',
        label,
        usingMetrics: {
          sonnet: metric(metricName, 'Sum', { dimensionsMap: sonnetDim, period: kpiPeriod }),
          haiku: metric(metricName, 'Sum', { dimensionsMap: haikuDim, period: kpiPeriod }),
        },
        period: kpiPeriod,
      });

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Total Requests',
        metrics: [kpiTotal('RequestCount', 'Requests')],
        width: 6,
        height: 3,
        setPeriodToTimeRange: true,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Input Tokens',
        metrics: [kpiTotal('InputTokens', 'Input Tokens')],
        width: 6,
        height: 3,
        setPeriodToTimeRange: true,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Output Tokens',
        metrics: [kpiTotal('OutputTokens', 'Output Tokens')],
        width: 6,
        height: 3,
        setPeriodToTimeRange: true,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Est. Cost (USD)',
        metrics: [kpiTotal('ResponseCostUSD', 'Cost USD')],
        width: 6,
        height: 3,
        setPeriodToTimeRange: true,
      }),
    );

    // --- Row 2: Request Rate & Errors ---
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Request Rate by Model',
        left: [
          metric('RequestCount', 'Sum', { dimensionsMap: { Model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' } }),
          metric('RequestCount', 'Sum', { dimensionsMap: { Model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' } }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Error Rate',
        left: [
          metric('RequestErrors', 'Sum'),
          metric('ApplicationErrors', 'Sum'),
        ],
        width: 12,
        height: 6,
      }),
    );

    // --- Row 3: Latency ---
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Avg Response Time (ms) by Model',
        left: [
          metric('ResponseTimeMs', 'Average', { dimensionsMap: { Model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' } }),
          metric('ResponseTimeMs', 'Average', { dimensionsMap: { Model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' } }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.LogQueryWidget({
        title: 'Latency Percentiles (p50 / p95 / p99)',
        logGroupNames: [logGroup.logGroupName],
        queryLines: [
          'filter litellm_metric = 1',
          'stats pct(response_time_ms, 50) as p50, pct(response_time_ms, 95) as p95, pct(response_time_ms, 99) as p99 by bin(5min)',
        ],
        view: cloudwatch.LogQueryVisualizationType.LINE,
        width: 12,
        height: 6,
      }),
    );

    // --- Row 4: Token Usage ---
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Avg Tokens per Request by Model',
        left: [
          metric('InputTokens', 'Average', { dimensionsMap: { Model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' } }),
          metric('OutputTokens', 'Average', { dimensionsMap: { Model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' } }),
          metric('InputTokens', 'Average', { dimensionsMap: { Model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' } }),
          metric('OutputTokens', 'Average', { dimensionsMap: { Model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' } }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Total Tokens Over Time',
        left: [
          metric('TotalTokens', 'Sum', {
            dimensionsMap: { Model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' },
            period: cdk.Duration.minutes(5),
          }),
          metric('TotalTokens', 'Sum', {
            dimensionsMap: { Model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
            period: cdk.Duration.minutes(5),
          }),
        ],
        stacked: true,
        width: 12,
        height: 6,
      }),
    );

    // --- Row 5: Cost ---
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Cost per Request (USD) by Model',
        left: [
          metric('ResponseCostUSD', 'Average', {
            dimensionsMap: { Model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' },
            period: cdk.Duration.minutes(5),
          }),
          metric('ResponseCostUSD', 'Average', {
            dimensionsMap: { Model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.LogQueryWidget({
        title: 'Cost Breakdown (last 24h)',
        logGroupNames: [logGroup.logGroupName],
        queryLines: [
          'filter litellm_metric = 1',
          'stats count() as requests, sum(prompt_tokens) as input_tokens, sum(completion_tokens) as output_tokens, sum(response_cost) as total_cost_usd, avg(response_cost) as avg_cost by model',
          'sort total_cost_usd desc',
        ],
        view: cloudwatch.LogQueryVisualizationType.TABLE,
        width: 12,
        height: 6,
      }),
    );

    // --- Row 6: ECS Health ---
    const ecsDimensions = { ClusterName: clusterName, ServiceName: serviceName };
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS CPU Utilization %',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            dimensionsMap: ecsDimensions,
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS Memory Utilization %',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'MemoryUtilization',
            dimensionsMap: ecsDimensions,
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
    );

    // --- Row 7: ALB Health ---
    const albDimensions = { LoadBalancer: albFullName };
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB Requests & 5xx Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: albDimensions,
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: albDimensions,
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB Target Response Time (s)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'TargetResponseTime',
            dimensionsMap: albDimensions,
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'TargetResponseTime',
            dimensionsMap: albDimensions,
            statistic: 'p99',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
    );
  }
}
