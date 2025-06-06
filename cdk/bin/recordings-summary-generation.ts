#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RecordingsSummaryStack } from '../lib/recordings-summary-stack';

const app = new cdk.App();

// Get parameters from context or use default values
const emailAddressForSummary = app.node.tryGetContext('emailAddressForSummary') || 'your-email@example.com';
const summaryInstructions = app.node.tryGetContext('summaryInstructions') || 'Your task is to create markdown-formatted list Key Stakeholders and highlight Key Discussion Points and list Decisions and outline Action Items and provide meeting notes and create a concise summary.';
const bedrockModelId = app.node.tryGetContext('bedrockModelId') || 'anthropic.claude-3-sonnet-20240229-v1:0';
const bedrockGuardrailId = app.node.tryGetContext('bedrockGuardrailId') || '';

if (!bedrockGuardrailId) {
  console.warn('WARNING: bedrockGuardrailId is not provided. Please provide a valid Bedrock Guardrail ID using --context bedrockGuardrailId=<your-guardrail-id>');
}

new RecordingsSummaryStack(app, 'RecordingsSummaryStack', {
  emailAddressForSummary,
  summaryInstructions,
  bedrockModelId,
  bedrockGuardrailId,
  
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

app.synth();