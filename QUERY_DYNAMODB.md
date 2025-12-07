# DynamoDB Query Commands

## Check Request Queue Entries

### Scan All Entries (Local DynamoDB)
```bash
aws dynamodb scan \
  --endpoint-url http://localhost:8000 \
  --table-name iao-request-queue
```

### Scan All Entries (AWS DynamoDB)
```bash
aws dynamodb scan \
  --region us-east-1 \
  --table-name iao-request-queue
```

### Get Specific Entry by ID
```bash
aws dynamodb get-item \
  --endpoint-url http://localhost:8000 \
  --table-name iao-request-queue \
  --key '{"id": {"S": "0x123...#0xabc...#1"}}'
```

### Query by Token Address (using GSI)
```bash
aws dynamodb query \
  --endpoint-url http://localhost:8000 \
  --table-name iao-request-queue \
  --index-name iaoToken-from-index \
  --key-condition-expression "iaoToken = :token" \
  --expression-attribute-values '{":token": {"S": "0x123..."}}'
```

### Query by Token and User (using GSI)
```bash
aws dynamodb query \
  --endpoint-url http://localhost:8000 \
  --table-name iao-request-queue \
  --index-name iaoToken-from-index \
  --key-condition-expression "iaoToken = :token AND #from = :user" \
  --expression-attribute-names '{"#from": "from"}' \
  --expression-attribute-values '{":token": {"S": "0x123..."}, ":user": {"S": "0xabc..."}}'
```

## Check User Requests

### Scan All User Requests
```bash
aws dynamodb scan \
  --endpoint-url http://localhost:8000 \
  --table-name iao-user-requests
```

### Query by Token Address (using GSI)
```bash
aws dynamodb query \
  --endpoint-url http://localhost:8000 \
  --table-name iao-user-requests \
  --index-name iaoToken-index \
  --key-condition-expression "iaoToken = :token" \
  --expression-attribute-values '{":token": {"S": "0x123..."}}'
```

## Check IAO Tokens

### Scan All Tokens
```bash
aws dynamodb scan \
  --endpoint-url http://localhost:8000 \
  --table-name iao-tokens
```

### Get Specific Token
```bash
aws dynamodb get-item \
  --endpoint-url http://localhost:8000 \
  --table-name iao-tokens \
  --key '{"id": {"S": "0x123..."}}'
```

## Pretty Print JSON Output

Add `| jq` to any command for formatted output:
```bash
aws dynamodb scan \
  --endpoint-url http://localhost:8000 \
  --table-name iao-request-queue | jq
```

## Count Items

```bash
aws dynamodb scan \
  --endpoint-url http://localhost:8000 \
  --table-name iao-request-queue \
  --select COUNT
```

