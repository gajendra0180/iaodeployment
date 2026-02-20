/**
 * Insert test data for automation testing
 * Creates a test Solana server and pending request
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: "us-east-1",
  endpoint: "http://localhost:8000"
});
const docClient = DynamoDBDocumentClient.from(client);

async function insertTestData() {
  console.log("🔧 Inserting test data for Solana automation...\n");

  // Test Solana server
  const testServer = {
    id: "test-solana-token-mint-123",  // Mock Solana mint address
    slug: "test-solana-server",
    name: "Test Solana Server",
    symbol: "TST",
    builder: "4mXDfRXPPh1234567890ABC",  // Mock Solana address
    paymentToken: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",  // USDC Devnet
    chainId: "devnet",
    subscriptionCount: "0",
    refundCount: "0",
    fulfilledCount: "0",
    totalFeesCollected: "0",
    apis: [{
      index: 0,
      slug: "test-api",
      name: "Test API",
      apiUrl: "https://httpbin.org/uuid",
      description: "Test API for automation",
      fee: "10000",  // 0.01 USDC (6 decimals)
      createdAt: new Date().toISOString()
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Test pending request in queue
  const testRequest = {
    id: "test-solana-token-mint-123#9MG8XYZ1234567890#1",  // tokenAddress#userAddress#requestNumber
    iaoToken: "test-solana-token-mint-123",
    from: "9MG8XYZ1234567890",  // Mock user Solana address
    userRequestNumber: "1",
    globalRequestNumber: "1",
    fee: "10000",
    createdAt: new Date().toISOString()
  };

  try {
    // Insert server
    await docClient.send(new PutCommand({
      TableName: "apix-iao-tokens",
      Item: testServer
    }));
    console.log("✅ Inserted test server:", testServer.slug);

    // Insert pending request
    await docClient.send(new PutCommand({
      TableName: "apix-iao-request-queue",
      Item: testRequest
    }));
    console.log("✅ Inserted pending request:", testRequest.id);

    console.log("\n📊 Test Data Summary:");
    console.log(`   Server: ${testServer.slug} (${testServer.id})`);
    console.log(`   Chain: Solana Devnet`);
    console.log(`   API: ${testServer.apis[0].name}`);
    console.log(`   Fee: ${testRequest.fee} (0.01 USDC)`);
    console.log(`   User: ${testRequest.from}`);
    console.log(`   Request: #${testRequest.userRequestNumber}`);

    console.log("\n✅ Test data inserted successfully!");
    console.log("Now run: cd /home/error0180/tools/automations/hyperpie/batch-transfer-x402-solana && npm run invoke");

  } catch (error) {
    console.error("❌ Failed to insert test data:", error);
    throw error;
  }
}

insertTestData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
