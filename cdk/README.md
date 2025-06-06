# Recordings Summary Generation CDK Project

This project is a CDK implementation of the solution described in the AWS blog post: [Summarize call transcriptions securely with Amazon Transcribe and Amazon Bedrock Guardrails](https://aws.amazon.com/blogs/machine-learning/summarize-call-transcriptions-securely-with-amazon-transcribe-and-amazon-bedrock-guardrails/).

## Architecture

This solution uses the following AWS services:

- Amazon S3: Stores recordings, transcriptions, and summaries
- Amazon Transcribe: Transcribes audio recordings
- Amazon Bedrock: Generates summaries from transcriptions using Claude 3 models
- AWS Lambda: Processes data at various stages
- AWS Step Functions: Orchestrates the workflow
- Amazon SNS: Delivers summaries via email
- Amazon EventBridge: Triggers the workflow when recordings are uploaded

## Prerequisites

- [AWS CDK](https://aws.amazon.com/cdk/) installed
- [Node.js](https://nodejs.org/) installed
- [AWS CLI](https://aws.amazon.com/cli/) installed and configured
- A Bedrock Guardrail ID

## Setup

1. Clone this repository
2. Install dependencies:

```bash
cd cdk
npm install
```

3. Deploy the stack:

```bash
cdk deploy --context emailAddressForSummary=your-email@example.com --context bedrockGuardrailId=your-guardrail-id
```

You can also customize the following parameters:

- `summaryInstructions`: Instructions for the Bedrock model to generate the summary
- `bedrockModelId`: The Bedrock model ID to use (default: anthropic.claude-3-sonnet-20240229-v1:0)

Example:

```bash
cdk deploy \
  --context emailAddressForSummary=your-email@example.com \
  --context bedrockGuardrailId=your-guardrail-id \
  --context summaryInstructions="Create a concise summary with key points and action items" \
  --context bedrockModelId=anthropic.claude-3-haiku-20240307-v1:0
```

## Usage

1. After deployment, you'll receive an email to confirm your subscription to the SNS topic.
2. Upload audio recordings to the `recordings/` folder in the S3 bucket created by the stack.
3. The workflow will automatically start, transcribe the recording, generate a summary, and send it to your email.

## Cleanup

To remove all resources created by this stack:

```bash
cdk destroy
```

Note: The S3 bucket will not be deleted by default to prevent data loss. You'll need to manually empty and delete it if desired.

## License

This project is licensed under the MIT License - see the LICENSE file for details.