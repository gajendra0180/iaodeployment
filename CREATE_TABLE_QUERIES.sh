# 1. iao-tokens table
aws dynamodb create-table --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --table-name apix-iao-tokens \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# 2. iao-user-requests table
aws dynamodb create-table --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --table-name apix-iao-user-requests \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=iaoToken,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"iaoToken-index","KeySchema":[{"AttributeName":"iaoToken","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

# 3. iao-request-queue table
aws dynamodb create-table --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --table-name apix-iao-request-queue \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=iaoToken,AttributeType=S \
    AttributeName=from,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"iaoToken-from-index","KeySchema":[{"AttributeName":"iaoToken","KeyType":"HASH"},{"AttributeName":"from","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

# 4. iao-metrics table (for API usage metrics)
aws dynamodb create-table --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --table-name apix-iao-metrics \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=tokenAddress,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"tokenAddress-index","KeySchema":[{"AttributeName":"tokenAddress","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

    # Create apix-iao-agents table
  aws dynamodb create-table --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --table-name apix-iao-agents \
    --attribute-definitions \
      AttributeName=id,AttributeType=S \
      AttributeName=creator,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --global-secondary-indexes '[{"IndexName":"creator-index","KeySchema":[{"AttributeName":"creator","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
    --billing-mode PAY_PER_REQUEST

  # Create apix-iao-chat-sessions table
  aws dynamodb create-table --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --table-name apix-iao-chat-sessions \
    --attribute-definitions \
      AttributeName=id,AttributeType=S \
      AttributeName=agentId,AttributeType=S \
      AttributeName=userAddress,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --global-secondary-indexes '[{"IndexName":"agentId-userAddress-index","KeySchema":[{"AttributeName":"agentId","KeyType":"HASH"},{"AttributeName":"userAddress","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"userAddress-index","KeySchema":[{"AttributeName":"userAddress","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
    --billing-mode PAY_PER_REQUEST

  # Create apix-iao-chat-messages table
  aws dynamodb create-table --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --table-name apix-iao-chat-messages \
    --attribute-definitions \
      AttributeName=id,AttributeType=S \
      AttributeName=sessionId,AttributeType=S \
      AttributeName=timestamp,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --global-secondary-indexes '[{"IndexName":"sessionId-timestamp-index","KeySchema":[{"AttributeName":"sessionId","KeyType":"HASH"},{"AttributeName":"timestamp","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
    --billing-mode PAY_PER_REQUEST

  # Create apix-iao-agent-payments table
  aws dynamodb create-table --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    --table-name apix-iao-agent-payments \
    --attribute-definitions \
      AttributeName=id,AttributeType=S \
      AttributeName=agentId,AttributeType=S \
      AttributeName=sessionId,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --global-secondary-indexes '[{"IndexName":"agentId-index","KeySchema":[{"AttributeName":"agentId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"sessionId-index","KeySchema":[{"AttributeName":"sessionId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
    --billing-mode PAY_PER_REQUEST