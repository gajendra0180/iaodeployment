#!/bin/bash

# DynamoDB Table Scan Script
# This script scans all IAO DynamoDB tables

REGION=${DYNAMODB_REGION:-us-east-1}
ENDPOINT=${DYNAMODB_ENDPOINT:-""}

if [ -n "$ENDPOINT" ]; then
  ENDPOINT_FLAG="--endpoint-url $ENDPOINT"
  echo "Scanning local DynamoDB tables at: $ENDPOINT"
else
  ENDPOINT_FLAG=""
  echo "Scanning AWS DynamoDB tables in region: $REGION"
fi

echo ""
echo "=========================================="
echo "Scanning all IAO DynamoDB tables..."
echo "=========================================="
echo ""

# 1. Scan iao-tokens table
echo "📊 Scanning iao-tokens table..."
echo "----------------------------------------"
aws dynamodb scan $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-tokens \
  --output json | jq '.Items | length' | xargs -I {} echo "Found {} items"
aws dynamodb scan $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-tokens \
  --output json | jq '.Items[] | {id, name, symbol, apiUrl, builder, paymentToken}'
echo ""

# 2. Scan iao-user-requests table
echo "📊 Scanning iao-user-requests table..."
echo "----------------------------------------"
aws dynamodb scan $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-user-requests \
  --output json | jq '.Items | length' | xargs -I {} echo "Found {} items"
aws dynamodb scan $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-user-requests \
  --output json | jq '.Items[] | {id, iaoToken, from, totalRequest, fulfilledRequest}'
echo ""

# 3. Scan iao-request-queue table
echo "📊 Scanning iao-request-queue table..."
echo "----------------------------------------"
aws dynamodb scan $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-request-queue \
  --output json | jq '.Items | length' | xargs -I {} echo "Found {} items"
aws dynamodb scan $ENDPOINT_FLAG \
  --region $REGION \
  --table-name iao-request-queue \
  --output json | jq '.Items[] | {id, iaoToken, from, userRequestNumber, requestType}'
echo ""

echo "=========================================="
echo "Scan complete!"
echo "=========================================="

