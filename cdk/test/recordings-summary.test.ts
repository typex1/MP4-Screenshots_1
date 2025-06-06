import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { RecordingsSummaryStack } from '../lib/recordings-summary-stack';

describe('RecordingsSummaryStack', () => {
  const app = new cdk.App({
    context: {
      emailAddressForSummary: 'test@example.com',
      bedrockGuardrailId: 'test-guardrail-id',
    },
  });
  
  const stack = new RecordingsSummaryStack(app, 'TestStack', {
    emailAddressForSummary: 'test@example.com',
    bedrockGuardrailId: 'test-guardrail-id',
  });
  
  const template = Template.fromStack(stack);

  test('S3 Bucket Created', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    });
  });

  test('Lambda Functions Created', () => {
    template.resourceCountIs('AWS::Lambda::Function', 5);
  });

  test('Step Functions State Machine Created', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  });

  test('SNS Topic Created', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'Recording Summary',
      TopicName: 'summary-generator-notification',
    });
  });

  test('EventBridge Rule Created', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'summary-generator-invoke-state-machine',
      EventPattern: {
        source: ['aws.s3'],
        'detail-type': ['Object Created'],
      },
    });
  });
});