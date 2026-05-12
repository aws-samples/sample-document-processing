# VPC — Shared Network Infrastructure

Shared VPC and security groups used by all platform layers.

## Network Layout

```
VPC: 10.0.0.0/22 (1024 IPs)
├── Public Subnets (2 AZs)
│   ├── 10.0.0.0/24  — AZ-a  (ALBs, NAT Gateway)
│   └── 10.0.1.0/24  — AZ-b  (ALBs)
└── Private Subnets (2 AZs)
    ├── 10.0.2.0/24  — AZ-a  (ECS tasks, Aurora, Lambda)
    └── 10.0.3.0/24  — AZ-b  (ECS tasks, Aurora, Lambda)
```

## Security Groups

| Security Group | Purpose | Inbound Rules |
|----------------|---------|---------------|
| `alb-external-sg` | Internet-facing ALB (UI) | 80, 443 from `0.0.0.0/0` |
| `alb-internal-sg` | Internal ALB (LLM Gateway) | 80 from VPC CIDR |
| `ecs-sg` | ECS Fargate tasks | 4000, 8001 from `alb-internal-sg`; 3000 from `alb-external-sg` |
| `aurora-db-sg` | Aurora Serverless v2 | 5432 from `ecs-sg` |

## VPC Endpoints

- **DynamoDB** — Gateway endpoint (private subnets, no NAT cost)
- **S3** — Gateway endpoint (private subnets, no NAT cost)

## Deployment

```bash
cd vpc/infra
npm install
npx cdk deploy --all
```

## CloudFormation Exports

All resources are exported for cross-stack references by other layers:

- `document-processing-vpc-id`
- `document-processing-vpc-cidr`
- `document-processing-public-subnet-ids`
- `document-processing-private-subnet-ids`
- `document-processing-alb-external-sg-id`
- `document-processing-alb-internal-sg-id`
- `document-processing-ecs-sg-id`
- `document-processing-aurora-db-sg-id`
