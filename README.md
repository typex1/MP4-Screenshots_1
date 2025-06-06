# Recordings Summary Generation

This repository contains both a CloudFormation template and an AWS CDK implementation for a solution that summarizes call recordings using Amazon Transcribe and Amazon Bedrock Guardrails.

## Original Resources

- **Blog post**: [Summarize call transcriptions securely with Amazon Transcribe and Amazon Bedrock Guardrails](https://aws.amazon.com/blogs/machine-learning/summarize-call-transcriptions-securely-with-amazon-transcribe-and-amazon-bedrock-guardrails/)
- **Original CloudFormation template**: [recordings-summary-generation.yaml](https://aws-blogs-artifacts-public.s3.amazonaws.com/artifacts/ML-16483/recordings-summary-generation.yaml)

## Repository Structure

- `recordings-summary-generation.yaml`: The original CloudFormation template
- `cdk/`: AWS CDK implementation of the same solution

## Using the CDK Implementation

The CDK implementation provides the same functionality as the CloudFormation template but with the benefits of infrastructure as code using AWS CDK.

To use the CDK implementation:

1. Navigate to the `cdk` directory
2. Follow the instructions in the [CDK README](./cdk/README.md)

## Architecture

This solution uses the following AWS services:

- Amazon S3: Stores recordings, transcriptions, and summaries
- Amazon Transcribe: Transcribes audio recordings
- Amazon Bedrock: Generates summaries from transcriptions using Claude 3 models
- AWS Lambda: Processes data at various stages
- AWS Step Functions: Orchestrates the workflow
- Amazon SNS: Delivers summaries via email
- Amazon EventBridge: Triggers the workflow when recordings are uploaded
