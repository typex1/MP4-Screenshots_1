import json
import boto3
import os

# Get the service clients.
bedrock_client = boto3.client('bedrock-runtime')
client = boto3.client('bedrock')
s3_client = boto3.client('s3')

# Use the provided model ID to invoke the model.
BEDROCK_MODEL_ID = os.getenv('BEDROCK_MODEL_ID')
BEDROCK_GUARDRAIL_ID = os.getenv('BEDROCK_GUARDRAIL_ID')

# Use the provided instructions to provide the summary. Use a default if no intructions are provided.
SUMMARY_INSTRUCTIONS = os.getenv('SUMMARY_INSTRUCTIONS', 'Mask all the sensitive details and PII.')

#--------------------------------------------------
# function: lambda_handler
#--------------------------------------------------
def lambda_handler(event, context):

    # print(json.dumps(event))

    result = {"status": "FAILED"}

    # Get transcription URI from the event
    transcript_uri =  event['TranscriptionJob']['TranscriptionJob']['Transcript']['TranscriptFileUri']

    print(f"\nTranscript URI: {transcript_uri}")

    # The transcript URI will look something like this:
    # https://s3.[REGION].amazonaws.com/[BUCKET NAME]/transcriptions/bf90bf05-5300-415f-9dc2-a89d2f03a59f.json

    # ...so get the bucket name and filename based on that format.
    bucket_name = transcript_uri.split('/')[3]
    file_name = transcript_uri.split('/')[-2] + '/' + transcript_uri.split('/')[-1]

    try:
        # Download the file from S3.
        file_object = s3_client.get_object(Bucket=bucket_name, Key=file_name)
        # print(f"S3 Get Object Response: {file_object}")
        data = json.loads(file_object['Body'].read())

        # Get the transcript.
        transcript = json.dumps(data['results']['transcripts'][0]['transcript'])

        # Create the payload to provide to the Anthropic model.
        user_message = {"role": "user", "content": f"{SUMMARY_INSTRUCTIONS}{transcript}"}
        messages = [user_message]

        response = generate_message(bedrock_client, 'anthropic.claude-3-sonnet-20240229-v1:0', "", messages, 1000)
        assistant_response = response['content'][0]['text']
        print(assistant_response)

        summary_file_name =  f"transcriptions/{event['Source']['Payload']['SourceFileName']}-summary.txt"

        # Save the response value in S3.
        s3_put_response = s3_client.put_object(
            Bucket=bucket_name,
            Key=summary_file_name,
            Body=assistant_response,
            ContentType='text/plain'
            )
        # print(f"S3 Put Object Response: {s3_put_response}")

        result = {
            "bucket_name": bucket_name,
            "summary_key_name": summary_file_name,
            "status": "SUCCEEDED"
        }

    except Exception as e:
        result['Error'] = str(e)

    return result

def generate_message(bedrock_runtime, model_id, system_prompt, messages, max_tokens):
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": messages
        }
    )
    print(f'Invoking model: {BEDROCK_MODEL_ID}')

    response = bedrock_runtime.invoke_model(
        body=body,
        modelId=BEDROCK_MODEL_ID,
        # contentType=contentType,
        guardrailIdentifier =BEDROCK_GUARDRAIL_ID,
        guardrailVersion ="1",
        trace ="ENABLED")
    response_body = json.loads(response.get('body').read())
    print(f'response: {response}')
    return response_body