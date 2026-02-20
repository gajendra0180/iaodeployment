#!/bin/bash

# Script to add Global Secondary Index (GSI) for slug lookups
# This enables O(1) lookups instead of O(n) table scans

# Configuration
TABLE_NAME="apix-iao-tokens"
REGION="${AWS_REGION:-us-west-1}"
INDEX_NAME="slug-index"

echo "Adding GSI '$INDEX_NAME' to table '$TABLE_NAME' in region '$REGION'..."
echo ""
echo "Note: GSI creation is non-blocking. The table remains available during creation."
echo ""

# Check if running against local DynamoDB
if [ -n "$DYNAMODB_ENDPOINT" ]; then
  ENDPOINT_FLAG="--endpoint-url $DYNAMODB_ENDPOINT"
  echo "Using local DynamoDB endpoint: $DYNAMODB_ENDPOINT"
else
  ENDPOINT_FLAG=""
  echo "Using AWS DynamoDB in region: $REGION"
fi

# Add the GSI
aws dynamodb update-table \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  $ENDPOINT_FLAG \
  --attribute-definitions \
    AttributeName=slug,AttributeType=S \
  --global-secondary-index-updates \
    "[{
      \"Create\": {
        \"IndexName\": \"$INDEX_NAME\",
        \"KeySchema\": [{\"AttributeName\":\"slug\",\"KeyType\":\"HASH\"}],
        \"Projection\": {\"ProjectionType\":\"ALL\"},
        \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
      }
    }]"

if [ $? -eq 0 ]; then
  echo ""
  echo "GSI creation initiated successfully!"
  echo ""
  echo "To check GSI status:"
  echo "  aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION --query 'Table.GlobalSecondaryIndexes'"
  echo ""
  echo "The GSI is ready when IndexStatus is 'ACTIVE'"
else
  echo ""
  echo "Failed to create GSI. Check if:"
  echo "  1. The GSI already exists (use describe-table to check)"
  echo "  2. Your AWS credentials are configured correctly"
  echo "  3. You have permission to modify the table"
fi
