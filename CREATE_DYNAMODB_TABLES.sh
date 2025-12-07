#!/bin/bash

# DynamoDB Table Creation Script
# This script creates all required DynamoDB tables for IAO deployment

REGION=${DYNAMODB_REGION:-us-east-1}
ENDPOINT=${DYNAMODB_ENDPOINT:-""}

if [ -n "$ENDPOINT" ]; then
  ENDPOINT_FLAG="--endpoint-url $ENDPOINT"
  echo "Using local DynamoDB endpoint: $ENDPOINT"
else
  ENDPOINT_FLAG=""
  echo "Using AWS DynamoDB in region: $REGION"
fi

echo ""
echo "Creating DynamoDB tables..."
echo ""

# 1. IAO Tokens Table
echo "Creating iao-tokens table..."
aws dynamodb create-table $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-tokens \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

if [ $? -eq 0 ]; then
  echo "✅ iao-tokens table created successfully"
else
  echo "⚠️  iao-tokens table may already exist or creation failed"
fi

echo ""

# 2. User Requests Table
echo "Creating iao-user-requests table..."
aws dynamodb create-table $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-user-requests \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=iaoToken,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"iaoToken-index","KeySchema":[{"AttributeName":"iaoToken","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

if [ $? -eq 0 ]; then
  echo "✅ iao-user-requests table created successfully"
else
  echo "⚠️  iao-user-requests table may already exist or creation failed"
fi

echo ""

# 3. Request Queue Table
echo "Creating iao-request-queue table..."
aws dynamodb create-table $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-request-queue \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=iaoToken,AttributeType=S \
    AttributeName=from,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"iaoToken-from-index","KeySchema":[{"AttributeName":"iaoToken","KeyType":"HASH"},{"AttributeName":"from","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

if [ $? -eq 0 ]; then
  echo "✅ iao-request-queue table created successfully"
else
  echo "⚠️  iao-request-queue table may already exist or creation failed"
fi

echo ""
echo "Done! All tables created."
echo ""
echo "To verify, run:"
if [ -n "$ENDPOINT" ]; then
  echo "  aws dynamodb list-tables --endpoint-url $ENDPOINT"
else
  echo "  aws dynamodb list-tables --region $REGION"
fi

