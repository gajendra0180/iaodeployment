import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-west-1" });
const docClient = DynamoDBDocumentClient.from(client);

const result = await docClient.send(new ScanCommand({
  TableName: "apix-iao-request-queue",
  Limit: 5
}));

console.log('Transaction count:', result.Items?.length || 0);
if (result.Items && result.Items.length > 0) {
  console.log('Sample transaction:', JSON.stringify(result.Items[0], null, 2));
} else {
  console.log('No transactions found in database');
}
