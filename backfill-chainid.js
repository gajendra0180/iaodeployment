/**
 * Backfill script to add chainId to existing servers
 * Run this ONCE in production to fix missing chainId on old servers
 *
 * All old servers were on Base Sepolia (chainId: "84532")
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = "us-west-1";
const TABLE_NAME = "apix-iao-tokens";
const DEFAULT_CHAIN_ID = "84532"; // Base Sepolia

async function backfillChainId() {
  console.log("🔧 Starting chainId backfill...");
  console.log(`📍 Region: ${REGION}`);
  console.log(`📋 Table: ${TABLE_NAME}`);
  console.log(`⛓️  Default chainId: ${DEFAULT_CHAIN_ID}`);

  const client = new DynamoDBClient({ region: REGION });
  const docClient = DynamoDBDocumentClient.from(client);

  try {
    // Scan all items
    console.log("\n📡 Scanning table for servers without chainId...");
    const scanResult = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    const items = scanResult.Items || [];
    console.log(`✅ Found ${items.length} total servers`);

    // Filter servers without chainId
    const serversWithoutChainId = items.filter(item => !item.chainId);
    console.log(`🔍 Servers without chainId: ${serversWithoutChainId.length}`);

    if (serversWithoutChainId.length === 0) {
      console.log("✨ All servers already have chainId! Nothing to backfill.");
      return;
    }

    // Update each server
    let updated = 0;
    let failed = 0;

    for (const server of serversWithoutChainId) {
      try {
        console.log(`\n📝 Updating server: ${server.slug} (${server.id})`);

        await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { id: server.id },
          UpdateExpression: "SET chainId = :chainId, updatedAt = :updatedAt",
          ExpressionAttributeValues: {
            ":chainId": DEFAULT_CHAIN_ID,
            ":updatedAt": new Date().toISOString()
          }
        }));

        console.log(`✅ Updated: ${server.slug}`);
        updated++;
      } catch (err) {
        console.error(`❌ Failed to update ${server.slug}:`, err.message);
        failed++;
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("📊 BACKFILL COMPLETE");
    console.log("=".repeat(50));
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📋 Total processed: ${updated + failed}`);
    console.log("=".repeat(50));

  } catch (error) {
    console.error("\n❌ BACKFILL FAILED:", error);
    throw error;
  }
}

// Run backfill
backfillChainId()
  .then(() => {
    console.log("\n✨ Backfill script finished successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Backfill script failed:", err);
    process.exit(1);
  });
