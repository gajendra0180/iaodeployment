import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

let dynamoDBClient: DynamoDBClient | null = null;
let dynamoDBDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDBClient(region: string): DynamoDBClient {
  if (!dynamoDBClient) {
    // Connect to deployed AWS DynamoDB instance by default
    // AWS SDK v3 uses the default credential chain in this order:
    // 1. Explicit credentials passed to the client (via credentials option)
    // 2. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
    // 3. AWS credentials file (~/.aws/credentials)
    // 4. IAM roles (if running on EC2, Lambda, ECS, etc.)
    // 
    // For Vercel deployment, set these environment variables:
    // - AWS_ACCESS_KEY_ID
    // - AWS_SECRET_ACCESS_KEY
    // - AWS_REGION (or use DYNAMODB_REGION)
    //
    // For local testing, set DYNAMODB_ENDPOINT environment variable (e.g., http://localhost:8000)
    const config: { 
      region: string; 
      endpoint?: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      };
    } = {
      region,
    };
    
    // Explicitly set credentials if provided via environment variables
    // This is optional - if not set, AWS SDK will use the default credential chain
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
      };
      console.log(`🔑 Using explicit AWS credentials from environment variables`);
    } else {
      console.log(`🔍 Using AWS SDK default credential chain (env vars, credentials file, or IAM role)`);
    }
    
    // Only set endpoint if explicitly provided for local testing
    // if (process.env.DYNAMODB_ENDPOINT) {
    //   config.endpoint = process.env.DYNAMODB_ENDPOINT;
    //   console.log(`🔧 Using local DynamoDB endpoint: ${config.endpoint}`);
    // } else {
    //   console.log(`🌐 Connecting to deployed AWS DynamoDB in region: ${region}`);
    // }
    
    dynamoDBClient = new DynamoDBClient(config);
  }
  return dynamoDBClient;
}

function getDynamoDBDocClient(region: string): DynamoDBDocumentClient {
  if (!dynamoDBDocClient) {
    dynamoDBDocClient = DynamoDBDocumentClient.from(getDynamoDBClient(region));
  }
  return dynamoDBDocClient;
}

/**
 * Individual API entry within a token
 * Multiple APIs can be registered under a single token
 */
export interface ApiEntry {
  index: number;        // 0-based index (order of registration)
  name: string;         // API name/title
  apiUrl: string;       // Builder's API endpoint URL
  description?: string; // Optional description
  createdAt: string;    // ISO timestamp when this API was added
}

/**
 * IAO Token database entry
 * One token can have multiple APIs (1:N relationship)
 * All APIs under a token share the same subscription fee and payment token
 */
export interface IAOTokenDBEntry {
  id: string;                    // Token address (lowercase) - Primary Key
  name: string;                  // Token name
  symbol: string;                // Token symbol
  builder: string;               // Builder address (lowercase)
  paymentToken: string;          // Payment token address (lowercase)
  subscriptionFee: string;       // BigInt as string - same for all APIs
  subscriptionCount: string;     // BigInt as string, default "0" - aggregated across all APIs
  refundCount: string;           // BigInt as string, default "0"
  fulfilledCount: string;        // BigInt as string, default "0"
  apis: ApiEntry[];              // Array of registered APIs (NEW)
  apiUrl?: string;               // DEPRECATED: For backward compatibility, use apis[0].apiUrl
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
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

  /**
   * Add a new API to an existing token
   * The new API will be assigned the next available index
   */
  async addApiToToken(tokenAddress: string, apiName: string, apiUrl: string, description?: string): Promise<ApiEntry | null> {
    const token = await this.getItem(tokenAddress);
    if (!token) {
      console.error(`❌ Token ${tokenAddress} not found`);
      return null;
    }

    // Ensure apis array exists (for backward compatibility)
    const apis = token.apis || [];
    
    // Calculate next index
    const nextIndex = apis.length;
    
    // Create new API entry
    const newApi: ApiEntry = {
      index: nextIndex,
      name: apiName,
      apiUrl: apiUrl,
      description: description,
      createdAt: new Date().toISOString(),
    };

    // Add to apis array
    apis.push(newApi);

    // Update token
    const updatedToken: IAOTokenDBEntry = {
      ...token,
      apis: apis,
      updatedAt: new Date().toISOString(),
    };

    await this.putItem(updatedToken);
    console.log(`✅ Added API ${apiName} (index: ${nextIndex}) to token ${tokenAddress}`);
    
    return newApi;
  }

  /**
   * Get a specific API from a token by index
   */
  getApiByIndex(token: IAOTokenDBEntry, index: number): ApiEntry | null {
    // Handle backward compatibility - if apis array doesn't exist but apiUrl does
    if (!token.apis || token.apis.length === 0) {
      if (token.apiUrl && index === 0) {
        return {
          index: 0,
          name: token.name,
          apiUrl: token.apiUrl,
          createdAt: token.createdAt,
        };
      }
      return null;
    }

    return token.apis.find(api => api.index === index) || null;
  }
}

export { DynamoDBService };

