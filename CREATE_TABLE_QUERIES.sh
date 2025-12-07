# 1. iao-tokens table
aws dynamodb create-table --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --table-name iao-tokens \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# 2. iao-user-requests table
aws dynamodb create-table --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --table-name iao-user-requests \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=iaoToken,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"iaoToken-index","KeySchema":[{"AttributeName":"iaoToken","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

# 3. iao-request-queue table
aws dynamodb create-table --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  --table-name iao-request-queue \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=iaoToken,AttributeType=S \
    AttributeName=from,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"iaoToken-from-index","KeySchema":[{"AttributeName":"iaoToken","KeyType":"HASH"},{"AttributeName":"from","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST