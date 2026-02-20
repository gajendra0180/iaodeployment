#!/bin/bash

# Script to create the apix-cache DynamoDB table for caching
# Following the ecoAPI pattern (magpiexyz-ecosystem-cache)

# Configuration
TABLE_NAME="apix-cache"
REGION="${AWS_REGION:-us-west-1}"

echo "Creating DynamoDB table '$TABLE_NAME' in region '$REGION'..."
echo ""

# Check if running against local DynamoDB
if [ -n "$DYNAMODB_ENDPOINT" ]; then
  ENDPOINT_FLAG="--endpoint-url $DYNAMODB_ENDPOINT"
  echo "Using local DynamoDB endpoint: $DYNAMODB_ENDPOINT"
else
  ENDPOINT_FLAG=""
  echo "Using AWS DynamoDB in region: $REGION"
fi

# Create the cache table
aws dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  $ENDPOINT_FLAG \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --provisioned-throughput \
    ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --tags \
    Key=Project,Value=APIX \
    Key=Purpose,Value=Caching

if [ $? -eq 0 ]; then
  echo ""
  echo "Table creation initiated successfully!"
  echo ""

  # Enable TTL on the table
  echo "Enabling TTL on 'ttl' attribute..."
  aws dynamodb update-time-to-live \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    $ENDPOINT_FLAG \
    --time-to-live-specification "Enabled=true,AttributeName=ttl"

  if [ $? -eq 0 ]; then
    echo "TTL enabled successfully!"
  else
    echo "Warning: Failed to enable TTL (may not be supported on local DynamoDB)"
  fi

  echo ""
  echo "To check table status:"
  echo "  aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION --query 'Table.TableStatus'"
else
  echo ""
  echo "Failed to create table. Check if:"
  echo "  1. The table already exists"
  echo "  2. Your AWS credentials are configured correctly"
  echo "  3. You have permission to create tables"
fi
