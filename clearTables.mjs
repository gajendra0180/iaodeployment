import { DynamoDBClient, ScanCommand, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";

const DYNAMODB_REGION = "us-west-1";
const TABLES = [
  "apix-iao-tokens",
  "apix-iao-user-requests", 
  "apix-iao-request-queue"
];

const client = new DynamoDBClient({ region: DYNAMODB_REGION });

async function clearTable(tableName) {
  let deletedCount = 0;
  let lastEvaluatedKey = undefined;

  console.log(`🗑️  Clearing table: ${tableName}`);

  do {
    const scanResult = await client.send(new ScanCommand({
      TableName: tableName,
      ProjectionExpression: "id",
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const items = scanResult.Items || [];
    
    if (items.length === 0) {
      console.log(`   Table ${tableName} is empty`);
      break;
    }

    // Batch delete (max 25 items per batch)
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      
      await client.send(new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: batch.map(item => ({
            DeleteRequest: {
              Key: { id: item.id }
            }
          }))
        }
      }));

      deletedCount += batch.length;
      console.log(`   Deleted ${deletedCount} items...`);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`✅ Cleared ${deletedCount} items from ${tableName}\n`);
  return deletedCount;
}

async function main() {
  console.log("🚀 Clearing DynamoDB tables...\n");
  
  for (const table of TABLES) {
    try {
      await clearTable(table);
    } catch (error) {
      console.error(`❌ Error clearing ${table}:`, error.message);
    }
  }

  console.log("🎉 Done!");
}

main();

