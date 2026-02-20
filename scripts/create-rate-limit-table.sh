#!/bin/bash

# Create DynamoDB table for rate limiting
# This table stores rate limit counters with TTL for auto-cleanup

REGION="${AWS_REGION:-us-west-1}"
TABLE_NAME="${RATE_LIMIT_TABLE_NAME:-apix-rate-limits}"

echo "Creating rate limit table: $TABLE_NAME in region: $REGION"

# Create the table
aws dynamodb create-table \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=APIX Key=Purpose,Value=RateLimiting

if [ $? -eq 0 ]; then
  echo "✅ Table created successfully"

  # Wait for table to be active
  echo "Waiting for table to become active..."
  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"

  # Enable TTL on the 'ttl' attribute for auto-cleanup
  echo "Enabling TTL on 'ttl' attribute..."
  aws dynamodb update-time-to-live \
    --region "$REGION" \
    --table-name "$TABLE_NAME" \
    --time-to-live-specification "Enabled=true, AttributeName=ttl"

  if [ $? -eq 0 ]; then
    echo "✅ TTL enabled successfully"
  else
    echo "⚠️ Failed to enable TTL (table may still work, but old entries won't auto-delete)"
  fi

  echo ""
  echo "Table created with:"
  echo "  - Partition Key: id (String)"
  echo "  - TTL Attribute: ttl (auto-deletes expired entries)"
  echo "  - Billing: On-demand (pay per request)"
  echo ""
  echo "Example entries:"
  echo '  { "id": "global", "count": 150, "windowStart": 1234567890, "ttl": 1234567950 }'
  echo '  { "id": "ip:1.2.3.4", "count": 50, "windowStart": 1234567890, "ttl": 1234567950 }'
  echo '  { "id": "wallet:0xabc...", "count": 25, "windowStart": 1234567890, "ttl": 1234567950 }'
  echo '  { "id": "api:magpie:generate", "count": 100, "windowStart": 1234567890, "ttl": 1234567950 }'
else
  echo "❌ Failed to create table"
  exit 1
fi
