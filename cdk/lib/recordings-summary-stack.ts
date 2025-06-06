import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

export interface RecordingsSummaryStackProps extends cdk.StackProps {
  emailAddressForSummary: string;
  summaryInstructions?: string;
  bedrockModelId?: string;
  bedrockGuardrailId: string;
}

export class RecordingsSummaryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RecordingsSummaryStackProps) {
    super(scope, id, props);

    // Default values for parameters
    const summaryInstructions = props.summaryInstructions || 'Your task is to create markdown-formatted list Key Stakeholders and highlight Key Discussion Points and list Decisions and outline Action Items and provide meeting notes and create a concise summary.';
    const bedrockModelId = props.bedrockModelId || 'anthropic.claude-3-sonnet-20240229-v1:0';

    // Create S3 bucket for assets
    const assetBucket = new s3.Bucket(this, 'AssetBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'DeleteRecordings',
          prefix: 'recordings/',
          expiration: cdk.Duration.days(7),
          noncurrentVersionExpiration: cdk.Duration.days(2),
        },
        {
          id: 'DeleteTranscriptions',
          prefix: 'transcriptions/',
          expiration: cdk.Duration.days(7),
          noncurrentVersionExpiration: cdk.Duration.days(2),
        },
      ],
      eventBridgeEnabled: true,
    });

    // Add bucket policy to enforce HTTPS
    assetBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [assetBucket.bucketArn, `${assetBucket.bucketArn}/*`],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    // Create KMS key for CloudWatch logs
    const cloudWatchLogsKey = new kms.Key(this, 'CloudWatchLogsKey', {
      description: 'An example symmetric encryption KMS key',
      enableKeyRotation: true,
      alias: 'summary-generator-cloudwatch-logs-key',
    });

    // Add policy to allow CloudWatch to use the key
    cloudWatchLogsKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'Allow CloudWatch use',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt',
          'kms:GenerateDataKey',
          'kms:DescribeKey',
        ],
        resources: ['*'],
        conditions: {
          ArnEquals: {
            'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/summary-generator-*`,
          },
        },
      })
    );

    // Create SNS topic for summary delivery
    const summaryDeliveryTopic = new sns.Topic(this, 'SummaryDeliveryTopic', {
      displayName: 'Recording Summary',
      topicName: 'summary-generator-notification',
      masterKey: kms.Key.fromLookup(this, 'SnsKey', { aliasName: 'alias/aws/sns' }),
    });

    // Add email subscription
    summaryDeliveryTopic.addSubscription(
      new sns_subscriptions.EmailSubscription(props.emailAddressForSummary)
    );

    // Add policy to allow Lambda to publish to the topic
    summaryDeliveryTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'Allow Services',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [summaryDeliveryTopic.topicArn],
      })
    );

    // Create Lambda functions
    // 1. Perform Prerequisites Function
    const performPrerequisitesFunction = new lambda.Function(this, 'PerformPrerequisitesFunction', {
      functionName: 'summary-generator-perform-prerequisites',
      description: 'Performs prerequisities for the solution',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/perform-prerequisites')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(300),
      environment: {
        ASSET_BUCKET_NAME: assetBucket.bucketName,
      },
    });

    // Grant permissions to the function
    assetBucket.grantPut(performPrerequisitesFunction);

    // Create custom resource to invoke the function
    const performPrerequisites = new cr.AwsCustomResource(this, 'PerformPrerequisites', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: performPrerequisitesFunction.functionName,
          Payload: JSON.stringify({
            RequestType: 'Create',
            ResponseURL: 'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/response',
            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/guid',
            RequestId: '1234',
            LogicalResourceId: 'PerformPrerequisites',
          }),
        },
        physicalResourceId: cr.PhysicalResourceId.of('PerformPrerequisitesInvocation'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [performPrerequisitesFunction.functionArn],
      }),
    });

    // 2. Prepare Input Function
    const prepareInputFunction = new lambda.Function(this, 'PrepareInputFunction', {
      functionName: 'summary-generator-prepare-input',
      description: 'Prepares the input for later Step Functions steps by getting basic file values',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/prepare-input')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
    });

    // Create log group for the function with encryption
    const prepareInputFunctionLogGroup = new logs.LogGroup(this, 'PrepareInputFunctionLogGroup', {
      logGroupName: `/aws/lambda/${prepareInputFunction.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: cloudWatchLogsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. Format Transcription Function
    const formatTranscriptionFunction = new lambda.Function(this, 'FormatTranscriptionFunction', {
      functionName: 'summary-generator-format-transcription',
      description: 'Formats the transcription produced by Transcribe using diarization for the recorded speakers',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/format-transcription')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
    });

    // Grant permissions to the function
    assetBucket.grantReadWrite(formatTranscriptionFunction);

    // Create log group for the function with encryption
    const formatTranscriptionFunctionLogGroup = new logs.LogGroup(this, 'FormatTranscriptionFunctionLogGroup', {
      logGroupName: `/aws/lambda/${formatTranscriptionFunction.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: cloudWatchLogsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 4. Invoke Bedrock Model Function
    const invokeBedrockModelFunction = new lambda.Function(this, 'InvokeBedrockModelFunction', {
      functionName: 'summary-generator-invoke-bedrock-model',
      description: 'Invokes the Bedrock model to create a summary of the recording',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/invoke-bedrock-model')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(300),
      environment: {
        SUMMARY_INSTRUCTIONS: summaryInstructions,
        BEDROCK_MODEL_ID: bedrockModelId,
        BEDROCK_GUARDRAIL_ID: props.bedrockGuardrailId,
      },
    });

    // Grant permissions to the function
    assetBucket.grantReadWrite(invokeBedrockModelFunction);
    
    // Add permission to invoke Bedrock model
    invokeBedrockModelFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${bedrockModelId}`],
      })
    );

    // Create log group for the function with encryption
    const invokeBedrockModelFunctionLogGroup = new logs.LogGroup(this, 'InvokeBedrockModelFunctionLogGroup', {
      logGroupName: `/aws/lambda/${invokeBedrockModelFunction.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: cloudWatchLogsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 5. Send Recording Summary Function
    const sendRecordingSummaryFunction = new lambda.Function(this, 'SendRecordingSummaryFunction', {
      functionName: 'summary-generator-send-recording-summary',
      description: 'Sends the recording summary to the recipient(s)',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/send-recording-summary')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      environment: {
        SNS_TOPIC_ARN: summaryDeliveryTopic.topicArn,
      },
    });

    // Grant permissions to the function
    assetBucket.grantRead(sendRecordingSummaryFunction);
    summaryDeliveryTopic.grantPublish(sendRecordingSummaryFunction);

    // Create log group for the function with encryption
    const sendRecordingSummaryFunctionLogGroup = new logs.LogGroup(this, 'SendRecordingSummaryFunctionLogGroup', {
      logGroupName: `/aws/lambda/${sendRecordingSummaryFunction.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: cloudWatchLogsKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Step Functions state machine
    // Define the individual steps
    
    // Prepare Input
    const prepareInput = new tasks.LambdaInvoke(this, 'Prepare Input', {
      lambdaFunction: prepareInputFunction,
      resultPath: '$.Source',
      resultSelector: {
        'Payload.$': '$.Payload',
      },
      retryOnServiceExceptions: true,
    });

    // Start Transcription Job
    const startTranscriptionJob = new sfn.CustomState(this, 'Start Transcription Job', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:transcribe:startTranscriptionJob',
        Parameters: {
          'Media': {
            'MediaFileUri.$': 'States.Format(\'s3://{}/{}\', $.detail.bucket.name, $.detail.object.key)',
          },
          'TranscriptionJobName.$': 'States.Format(\'summary-generator-{}\', $.Source.Payload.SourceFileNameWithDate)',
          'OutputBucketName.$': '$.detail.bucket.name',
          'OutputKey.$': 'States.Format(\'transcriptions/{}.json\', $.Source.Payload.SourceFileName)',
          'LanguageCode': 'en-US',
          'Settings': {
            'ShowSpeakerLabels': true,
            'MaxSpeakerLabels': 10,
          },
          'Tags': [
            {
              'Key': 'SourceBucketName',
              'Value.$': '$.Source.Payload.SourceBucketName',
            },
            {
              'Key': 'SourceKeyName',
              'Value.$': '$.Source.Payload.SourceKeyName',
            },
            {
              'Key': 'SourceFileName',
              'Value.$': '$.Source.Payload.SourceFileName',
            },
          ],
        },
        ResultPath: '$.TranscriptionJob',
      },
    });

    // Wait for Transcription Job
    const waitForTranscriptionJob = new sfn.Wait(this, 'Wait for Transcription Job', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(20)),
    });

    // Get Transcription Job Status
    const getTranscriptionJobStatus = new sfn.CustomState(this, 'Get Transcription Job Status', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:transcribe:getTranscriptionJob',
        Parameters: {
          'TranscriptionJobName.$': '$.TranscriptionJob.TranscriptionJob.TranscriptionJobName',
        },
        ResultPath: '$.TranscriptionJob',
      },
    });

    // Transcription Job Status Choice
    const transcriptionJobStatus = new sfn.Choice(this, 'Transcription Job Status');
    
    const transcriptionJobCompleted = sfn.Condition.stringEquals('$.TranscriptionJob.TranscriptionJob.TranscriptionJobStatus', 'COMPLETED');
    const transcriptionJobFailed = sfn.Condition.stringEquals('$.TranscriptionJob.TranscriptionJob.TranscriptionJobStatus', 'FAILED');

    // Format Transcription
    const formatTranscription = new tasks.LambdaInvoke(this, 'Format Transcription', {
      lambdaFunction: formatTranscriptionFunction,
      resultPath: '$.FormatTranscription',
      resultSelector: {
        'BucketName.$': '$.Payload.bucket_name',
        'SpeakerTranscriptionKeyName.$': '$.Payload.speaker_transcription_key_name',
      },
      retryOnServiceExceptions: true,
    });

    // Invoke Bedrock Model
    const invokeBedrockModel = new tasks.LambdaInvoke(this, 'Invoke Bedrock Model', {
      lambdaFunction: invokeBedrockModelFunction,
      resultPath: '$.RecordingSummary',
      retryOnServiceExceptions: true,
    });

    // Bedrock Model Status Choice
    const bedrockModelStatus = new sfn.Choice(this, 'Bedrock Model Status');
    
    const bedrockModelSucceeded = sfn.Condition.stringMatches('$.RecordingSummary.Payload.status', 'SUCCEEDED');

    // Send Recording Summary
    const sendRecordingSummary = new tasks.LambdaInvoke(this, 'Send Recording Summary', {
      lambdaFunction: sendRecordingSummaryFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Success and Failure states
    const success = new sfn.Succeed(this, 'Success');
    const processFailed = new sfn.Fail(this, 'Process Failed');

    // Send Failure Message
    const sendFailureMessage = new tasks.SnsPublish(this, 'Send Failure Message', {
      topic: summaryDeliveryTopic,
      message: sfn.TaskInput.fromObject({
        'Error.$': '$.RecordingSummary.Payload.Error',
        'Link.$': `States.Format('https://${this.region}.console.aws.amazon.com/states/home?region=${this.region}#/v2/executions/details/{}', $$.Execution.Id)`,
      }),
    });

    // Chain the steps together
    prepareInput.next(startTranscriptionJob);
    startTranscriptionJob.next(waitForTranscriptionJob);
    waitForTranscriptionJob.next(getTranscriptionJobStatus);
    getTranscriptionJobStatus.next(transcriptionJobStatus);
    
    transcriptionJobStatus.when(transcriptionJobCompleted, formatTranscription);
    transcriptionJobStatus.when(transcriptionJobFailed, sendFailureMessage);
    transcriptionJobStatus.otherwise(waitForTranscriptionJob);
    
    formatTranscription.next(invokeBedrockModel);
    invokeBedrockModel.next(bedrockModelStatus);
    
    bedrockModelStatus.when(bedrockModelSucceeded, sendRecordingSummary);
    bedrockModelStatus.otherwise(sendFailureMessage);
    
    sendRecordingSummary.next(success);
    sendFailureMessage.next(processFailed);

    // Create the state machine
    const stateMachine = new sfn.StateMachine(this, 'SummaryGeneratorStateMachine', {
      stateMachineName: 'summary-generator',
      definition: prepareInput,
      timeout: cdk.Duration.minutes(30),
    });

    // Create EventBridge rule to trigger the state machine
    const eventRule = new events.Rule(this, 'TriggerSummaryGeneratorStateMachineEventRule', {
      ruleName: 'summary-generator-invoke-state-machine',
      description: 'Invokes the summary generator state machine when a recording is put in the asset bucket recordings folder',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [assetBucket.bucketName],
          },
          object: {
            key: [{ prefix: 'recordings/' }],
          },
        },
      },
      targets: [new targets.SfnStateMachine(stateMachine)],
    });

    // Add permissions for Step Functions to invoke Transcribe
    stateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'transcribe:GetTranscriptionJob',
          'transcribe:StartTranscriptionJob',
          'transcribe:TagResource',
        ],
        resources: [`arn:aws:transcribe:${this.region}:${this.account}:transcription-job/summary-generator-*`],
      })
    );

    // Add permissions for Step Functions to access S3
    assetBucket.grantReadWrite(stateMachine);

    // Output the bucket name
    new cdk.CfnOutput(this, 'AssetBucketName', {
      description: 'Name of the S3 bucket you\'ll upload recordings to and where transcripts are stored',
      value: assetBucket.bucketName,
    });
  }
}