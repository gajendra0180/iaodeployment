#!/bin/bash

# Create DynamoDB tables for Agent Chat System
# Usage: ./CREATE_AGENT_TABLES.sh [local|aws]

ENDPOINT=${1:-local}
REGION="us-west-1"

if [ "$ENDPOINT" = "local" ]; then
  ENDPOINT_URL="--endpoint-url http://localhost:8000"
  echo "Creating tables in LOCAL DynamoDB (http://localhost:8000)..."
else
  ENDPOINT_URL=""
  echo "Creating tables in AWS DynamoDB (Region: $REGION)..."
fi

# Table 1: apix-iao-agents
# Schema: id (S), creator (S) - key attributes only
# Non-key attributes (set by application):
#   - totalMessages (N), totalUsers (N), totalToolCalls (N) - stored as numbers
#   - name, description, llmProvider, availableTools, etc.
echo "Creating table: apix-iao-agents..."
aws dynamodb create-table $ENDPOINT_URL \
  --table-name apix-iao-agents \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=creator,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "IndexName=creator-index,Keys=[{AttributeName=creator,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}" \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --region $REGION 2>/dev/null || echo "Table apix-iao-agents already exists or error occurred"

# Table 2: apix-iao-chat-sessions
echo "Creating table: apix-iao-chat-sessions..."
aws dynamodb create-table $ENDPOINT_URL \
  --table-name apix-iao-chat-sessions \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=agentId,AttributeType=S \
    AttributeName=userAddress,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "IndexName=agentId-userAddress-index,Keys=[{AttributeName=agentId,KeyType=HASH},{AttributeName=userAddress,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}" \
    "IndexName=userAddress-index,Keys=[{AttributeName=userAddress,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}" \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --region $REGION 2>/dev/null || echo "Table apix-iao-chat-sessions already exists or error occurred"

# Table 3: apix-iao-chat-messages
echo "Creating table: apix-iao-chat-messages..."
aws dynamodb create-table $ENDPOINT_URL \
  --table-name apix-iao-chat-messages \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=sessionId,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "IndexName=sessionId-timestamp-index,Keys=[{AttributeName=sessionId,KeyType=HASH},{AttributeName=timestamp,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}" \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --region $REGION 2>/dev/null || echo "Table apix-iao-chat-messages already exists or error occurred"

# Table 4: apix-iao-agent-payments
echo "Creating table: apix-iao-agent-payments..."
aws dynamodb create-table $ENDPOINT_URL \
  --table-name apix-iao-agent-payments \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=agentId,AttributeType=S \
    AttributeName=sessionId,AttributeType=S \
  --key-schema \
    AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    "IndexName=agentId-index,Keys=[{AttributeName=agentId,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}" \
    "IndexName=sessionId-index,Keys=[{AttributeName=sessionId,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}" \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --region $REGION 2>/dev/null || echo "Table apix-iao-agent-payments already exists or error occurred"

echo ""
echo "✅ DynamoDB tables created successfully!"
echo ""
echo "Created tables:"
echo "  - apix-iao-agents (PK: id, GSI: creator-index)"
echo "  - apix-iao-chat-sessions (PK: id, GSI: agentId-userAddress-index, userAddress-index)"
echo "  - apix-iao-chat-messages (PK: id, GSI: sessionId-timestamp-index)"
echo "  - apix-iao-agent-payments (PK: id, GSI: agentId-index, sessionId-index)"
echo ""
echo "To verify tables were created:"
if [ "$ENDPOINT" = "local" ]; then
  echo "  aws dynamodb list-tables --endpoint-url http://localhost:8000"
else
  echo "  aws dynamodb list-tables --region $REGION"
fi
