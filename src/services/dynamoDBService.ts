import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

let dynamoDBClient: DynamoDBClient | null = null;
let dynamoDBDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDBClient(region: string): DynamoDBClient {
  if (!dynamoDBClient) {
    dynamoDBClient = new DynamoDBClient({
      region,
      endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    });
  }
  return dynamoDBClient;
}

function getDynamoDBDocClient(region: string): DynamoDBDocumentClient {
  if (!dynamoDBDocClient) {
    dynamoDBDocClient = DynamoDBDocumentClient.from(getDynamoDBClient(region));
  }
  return dynamoDBDocClient;
}

export interface IAOTokenDBEntry {
  id: string; // Token address (lowercase)
  name: string;
  symbol: string;
  apiUrl: string;
  builder: string; // Builder address (lowercase)
  paymentToken: string; // Payment token address (lowercase)
  subscriptionFee: string; // BigInt as string
  subscriptionTokenAmount: string; // BigInt as string
  maxSubscriptionCount?: string; // BigInt as string (optional)
  subscriptionCount: string; // BigInt as string, default "0"
  refundCount: string; // BigInt as string, default "0"
  fulfilledCount: string; // BigInt as string, default "0"
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

class DynamoDBService {
  private ddbDocClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(region: string, tableName: string) {
    this.ddbDocClient = getDynamoDBDocClient(region);
    this.tableName = tableName;
  }

  async putItem(item: IAOTokenDBEntry): Promise<void> {
    const params = {
      TableName: this.tableName,
      Item: item,
    };

    try {
      await this.ddbDocClient.send(new PutCommand(params));
      console.log(`✅ DynamoDB putItem success for ${item.id}`);
    } catch (err) {
      console.error(`❌ DynamoDB putItem fail for ${item.id}:`, err);
      throw err;
    }
  }

  async getItem(id: string): Promise<IAOTokenDBEntry | null> {
    const params = {
      TableName: this.tableName,
      Key: { id: id.toLowerCase() },
    };

    try {
      const data = await this.ddbDocClient.send(new GetCommand(params));
      return (data.Item as IAOTokenDBEntry) || null;
    } catch (err) {
      console.error(`❌ DynamoDB getItem fail for ${id}:`, err);
      return null;
    }
  }

  async deleteItem(id: string): Promise<void> {
    const params = {
      TableName: this.tableName,
      Key: { id: id.toLowerCase() },
    };

    try {
      await this.ddbDocClient.send(new DeleteCommand(params));
      console.log(`✅ DynamoDB deleteItem success for ${id}`);
    } catch (err) {
      console.error(`❌ DynamoDB deleteItem fail for ${id}:`, err);
      throw err;
    }
  }

  async scanAllItems(): Promise<IAOTokenDBEntry[]> {
    const params = {
      TableName: this.tableName,
    };

    try {
      const data = await this.ddbDocClient.send(new ScanCommand(params));
      return (data.Items as IAOTokenDBEntry[]) || [];
    } catch (err) {
      console.error("❌ DynamoDB scanAllItems error:", err);
      throw err;
    }
  }

  async scanItemsByBuilder(builderAddress: string): Promise<IAOTokenDBEntry[]> {
    const params = {
      TableName: this.tableName,
      FilterExpression: "#builder = :builder",
      ExpressionAttributeNames: {
        "#builder": "builder"
      },
      ExpressionAttributeValues: {
        ":builder": builderAddress.toLowerCase()
      }
    };

    try {
      const data = await this.ddbDocClient.send(new ScanCommand(params));
      return (data.Items as IAOTokenDBEntry[]) || [];
    } catch (err) {
      console.error(`❌ DynamoDB scanItemsByBuilder error for ${builderAddress}:`, err);
      throw err;
    }
  }
}

export { DynamoDBService };

