#!/bin/bash

# Multi-Chain Migration Script
# This script migrates existing DynamoDB tables to support multi-chain architecture
# Run this AFTER existing tables are created but BEFORE deploying new code

REGION=${DYNAMODB_REGION:-us-west-1}
ENDPOINT=${DYNAMODB_ENDPOINT:-""}

if [ -n "$ENDPOINT" ]; then
  ENDPOINT_FLAG="--endpoint-url $ENDPOINT"
  echo "Using local DynamoDB endpoint: $ENDPOINT"
else
  ENDPOINT_FLAG=""
  echo "Using AWS DynamoDB in region: $REGION"
fi

echo ""
echo "================================================="
echo "  Multi-Chain Migration Script"
echo "================================================="
echo ""

# Step 1: Create chain config table if it doesn't exist
echo "Step 1: Creating apix-iao-chain-config table..."
aws dynamodb create-table $ENDPOINT_FLAG \
  --region $REGION \
  --table-name apix-iao-chain-config \
  --attribute-definitions AttributeName=chainId,AttributeType=S \
  --key-schema AttributeName=chainId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST 2>/dev/null

if [ $? -eq 0 ]; then
  echo "✅ apix-iao-chain-config table created successfully"

  # Wait for table to be active
  echo "   Waiting for table to become active..."
  aws dynamodb wait table-exists $ENDPOINT_FLAG --region $REGION --table-name apix-iao-chain-config
  echo "   ✅ Table is active"
else
  echo "⏭️  apix-iao-chain-config table already exists (skipping)"
fi

echo ""

# Step 2: Add GSI to apix-iao-tokens table for chainId-slug lookup
echo "Step 2: Adding chainId-slug-index GSI to apix-iao-tokens table..."

# Check if GSI already exists
GSI_EXISTS=$(aws dynamodb describe-table $ENDPOINT_FLAG \
  --region $REGION \
  --table-name apix-iao-tokens \
  --query "Table.GlobalSecondaryIndexes[?IndexName=='chainId-slug-index'].IndexName" \
  --output text 2>/dev/null)

if [ "$GSI_EXISTS" = "chainId-slug-index" ]; then
  echo "⏭️  chainId-slug-index GSI already exists (skipping)"
else
  # Add the GSI
  aws dynamodb update-table $ENDPOINT_FLAG \
    --region $REGION \
    --table-name apix-iao-tokens \
    --attribute-definitions \
      AttributeName=chainId,AttributeType=S \
      AttributeName=slug,AttributeType=S \
    --global-secondary-index-updates '[{
      "Create": {
        "IndexName": "chainId-slug-index",
        "KeySchema": [
          {"AttributeName": "chainId", "KeyType": "HASH"},
          {"AttributeName": "slug", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"}
      }
    }]' 2>/dev/null

  if [ $? -eq 0 ]; then
    echo "✅ chainId-slug-index GSI creation initiated"
    echo "   Waiting for GSI to become active (this may take a few minutes)..."

    # Wait for GSI to become active
    while true; do
      GSI_STATUS=$(aws dynamodb describe-table $ENDPOINT_FLAG \
        --region $REGION \
        --table-name apix-iao-tokens \
        --query "Table.GlobalSecondaryIndexes[?IndexName=='chainId-slug-index'].IndexStatus" \
        --output text 2>/dev/null)

      if [ "$GSI_STATUS" = "ACTIVE" ]; then
        echo "   ✅ GSI is active"
        break
      elif [ "$GSI_STATUS" = "CREATING" ]; then
        echo "   ... GSI status: CREATING"
        sleep 10
      else
        echo "   ⚠️  GSI status: $GSI_STATUS"
        break
      fi
    done
  else
    echo "❌ Failed to add GSI - check if table exists and has correct permissions"
  fi
fi

echo ""

# Step 3: Instructions for data backfill
echo "Step 3: Data Backfill"
echo "================================================="
echo ""
echo "To backfill existing tokens with chainId and chainType, run:"
echo ""
echo "  # Start the backend server first"
echo "  yarn dev"
echo ""
echo "  # Then call the backfill endpoint (to be created)"
echo "  curl -X POST http://localhost:3000/api/admin/backfill-chain-data"
echo ""
echo "Or programmatically call dynamoDBService.backfillChainData() method."
echo ""

# Step 4: Seed chain configurations
echo "Step 4: Chain Configuration Seeding"
echo "================================================="
echo ""
echo "Chain configurations will be auto-seeded when the backend starts."
echo "Alternatively, call chainConfigService.seedDefaultConfigs() manually."
echo ""

echo "================================================="
echo "  Migration Complete!"
echo "================================================="
echo ""
echo "Next steps:"
echo "1. Deploy the updated backend code"
echo "2. Run the backfill endpoint to update existing tokens"
echo "3. Verify chain configs are seeded correctly"
echo "4. Test API endpoints with chain filtering"
echo ""
