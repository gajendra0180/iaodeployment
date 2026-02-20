#!/bin/bash

# Script to create DynamoDB tables for the alerting system
# Tables: apix-iao-alerts, apix-iao-webhooks

# Configuration
REGION="${AWS_REGION:-us-west-1}"

echo "Creating DynamoDB tables for alerting system in region '$REGION'..."
echo ""

# Check if running against local DynamoDB
if [ -n "$DYNAMODB_ENDPOINT" ]; then
  ENDPOINT_FLAG="--endpoint-url $DYNAMODB_ENDPOINT"
  echo "Using local DynamoDB endpoint: $DYNAMODB_ENDPOINT"
else
  ENDPOINT_FLAG=""
  echo "Using AWS DynamoDB in region: $REGION"
fi

# Create apix-iao-alerts table
echo ""
echo "Creating 'apix-iao-alerts' table..."
aws dynamodb create-table \
  --table-name "apix-iao-alerts" \
  --region "$REGION" \
  $ENDPOINT_FLAG \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=tokenAddress,AttributeType=S \
    AttributeName=resolved,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "[
      {
        \"IndexName\": \"tokenAddress-index\",
        \"KeySchema\": [{\"AttributeName\":\"tokenAddress\",\"KeyType\":\"HASH\"}],
        \"Projection\": {\"ProjectionType\":\"ALL\"},
        \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
      }
    ]" \
  --provisioned-throughput \
    ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --tags \
    Key=Project,Value=APIX \
    Key=Purpose,Value=Alerting

if [ $? -eq 0 ]; then
  echo "✅ apix-iao-alerts table created successfully"
else
  echo "⚠️ Failed to create apix-iao-alerts (may already exist)"
fi

# Create apix-iao-webhooks table
echo ""
echo "Creating 'apix-iao-webhooks' table..."
aws dynamodb create-table \
  --table-name "apix-iao-webhooks" \
  --region "$REGION" \
  $ENDPOINT_FLAG \
  --attribute-definitions \
    AttributeName=tokenAddress,AttributeType=S \
    AttributeName=webhookUrl,AttributeType=S \
  --key-schema \
    AttributeName=tokenAddress,KeyType=HASH \
    AttributeName=webhookUrl,KeyType=RANGE \
  --provisioned-throughput \
    ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --tags \
    Key=Project,Value=APIX \
    Key=Purpose,Value=Alerting

if [ $? -eq 0 ]; then
  echo "✅ apix-iao-webhooks table created successfully"
else
  echo "⚠️ Failed to create apix-iao-webhooks (may already exist)"
fi

echo ""
echo "Done! To verify tables:"
echo "  aws dynamodb list-tables --region $REGION $ENDPOINT_FLAG"
