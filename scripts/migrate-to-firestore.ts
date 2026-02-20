/**
 * DynamoDB to Firestore Migration Script
 *
 * This script migrates all data from AWS DynamoDB tables to Google Cloud Firestore.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-firestore.ts
 *
 * Environment variables required:
 *   AWS side:
 *     - AWS_ACCESS_KEY_ID
 *     - AWS_SECRET_ACCESS_KEY
 *     - DYNAMODB_REGION (default: us-west-1)
 *
 *   GCP side:
 *     - GCP_PROJECT_ID
 *     - GCP_CREDENTIALS (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (file path)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Firestore, Timestamp } from '@google-cloud/firestore';

// Configuration
const DYNAMODB_REGION = process.env.DYNAMODB_REGION || 'us-west-1';
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;

// Table to Collection mapping
const TABLES_TO_COLLECTIONS: Record<string, string> = {
  'apix-iao-tokens': 'iao-tokens',
  'apix-iao-user-requests': 'user-requests',
  'apix-iao-request-queue': 'request-queue',
  'apix-iao-metrics': 'api-metrics',
  'apix-iao-agents': 'agents',
  'apix-iao-chat-sessions': 'chat-sessions',
  'apix-iao-chat-messages': 'chat-messages',
  'apix-iao-agent-payments': 'agent-payments',
  'apix-cache': 'cache',
  'apix-rate-limits': 'rate-limits',
  'apix-chain-configs': 'chain-configs',
  'apix-iao-alerts': 'alerts',
  'apix-iao-webhooks': 'webhooks',
};

// Initialize DynamoDB client
function getDynamoClient(): DynamoDBDocumentClient {
  const config: any = {
    region: DYNAMODB_REGION,
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
    };
  }

  if (process.env.DYNAMODB_ENDPOINT) {
    config.endpoint = process.env.DYNAMODB_ENDPOINT;
  }

  const client = new DynamoDBClient(config);
  return DynamoDBDocumentClient.from(client);
}

// Initialize Firestore client
function getFirestoreClient(): Firestore {
  let credentials: any = undefined;

  if (process.env.GCP_CREDENTIALS) {
    try {
      credentials = JSON.parse(process.env.GCP_CREDENTIALS);
    } catch (error) {
      console.error('Failed to parse GCP_CREDENTIALS:', error);
    }
  }

  return new Firestore({
    projectId: GCP_PROJECT_ID,
    ...(credentials && { credentials }),
  });
}

// Scan all items from a DynamoDB table with pagination
async function scanDynamoTable(
  docClient: DynamoDBDocumentClient,
  tableName: string
): Promise<any[]> {
  const items: any[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const command = new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const result = await docClient.send(command);

    if (result.Items) {
      items.push(...result.Items);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

// Transform item for Firestore (convert date strings to Timestamps where appropriate)
function transformItem(item: any, collectionName: string): any {
  const transformed = { ...item };

  // Convert ISO date strings to Firestore Timestamps for ttl fields
  if (collectionName === 'cache' || collectionName === 'rate-limits') {
    if (typeof transformed.ttl === 'number') {
      // TTL is in seconds, convert to Firestore Timestamp
      transformed.ttl = Timestamp.fromMillis(transformed.ttl * 1000);
    }
  }

  // Keep ISO date strings as-is (Firestore can handle them)
  // BigInt strings are kept as strings (Firestore doesn't support BigInt natively)

  return transformed;
}

// Write items to Firestore in batches
async function writeToFirestore(
  firestore: Firestore,
  collectionName: string,
  items: any[]
): Promise<number> {
  const BATCH_SIZE = 500; // Firestore batch limit
  let written = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = firestore.batch();
    const chunk = items.slice(i, i + BATCH_SIZE);

    for (const item of chunk) {
      // Use 'id' field as document ID, or generate one
      const docId = item.id || item.chainId || `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const docRef = firestore.collection(collectionName).doc(docId);

      const transformedItem = transformItem(item, collectionName);
      batch.set(docRef, transformedItem);
    }

    await batch.commit();
    written += chunk.length;

    console.log(`  Written ${written}/${items.length} documents to ${collectionName}`);
  }

  return written;
}

// Verify migration by comparing counts
async function verifyMigration(
  docClient: DynamoDBDocumentClient,
  firestore: Firestore,
  tableName: string,
  collectionName: string
): Promise<{ dynamoCount: number; firestoreCount: number; match: boolean }> {
  // Count DynamoDB items
  let dynamoCount = 0;
  let lastEvaluatedKey: any = undefined;

  do {
    const command = new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastEvaluatedKey,
      Select: 'COUNT',
    });

    const result = await docClient.send(command);
    dynamoCount += result.Count || 0;
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Count Firestore documents
  const snapshot = await firestore.collection(collectionName).count().get();
  const firestoreCount = snapshot.data().count;

  return {
    dynamoCount,
    firestoreCount,
    match: dynamoCount === firestoreCount,
  };
}

// Main migration function
async function migrate() {
  console.log('='.repeat(60));
  console.log('DynamoDB to Firestore Migration');
  console.log('='.repeat(60));

  if (!GCP_PROJECT_ID) {
    console.error('ERROR: GCP_PROJECT_ID environment variable is required');
    process.exit(1);
  }

  console.log(`\nDynamoDB Region: ${DYNAMODB_REGION}`);
  console.log(`GCP Project: ${GCP_PROJECT_ID}`);
  console.log(`Tables to migrate: ${Object.keys(TABLES_TO_COLLECTIONS).length}`);
  console.log();

  const docClient = getDynamoClient();
  const firestore = getFirestoreClient();

  const results: Array<{
    table: string;
    collection: string;
    itemsFound: number;
    itemsMigrated: number;
    verified: boolean;
    error?: string;
  }> = [];

  for (const [tableName, collectionName] of Object.entries(TABLES_TO_COLLECTIONS)) {
    console.log(`\nMigrating: ${tableName} -> ${collectionName}`);
    console.log('-'.repeat(50));

    try {
      // Scan DynamoDB table
      console.log(`  Scanning ${tableName}...`);
      const items = await scanDynamoTable(docClient, tableName);
      console.log(`  Found ${items.length} items`);

      if (items.length === 0) {
        results.push({
          table: tableName,
          collection: collectionName,
          itemsFound: 0,
          itemsMigrated: 0,
          verified: true,
        });
        console.log('  Skipping (no items)');
        continue;
      }

      // Write to Firestore
      console.log(`  Writing to ${collectionName}...`);
      const written = await writeToFirestore(firestore, collectionName, items);

      // Verify
      console.log(`  Verifying...`);
      const verification = await verifyMigration(docClient, firestore, tableName, collectionName);

      results.push({
        table: tableName,
        collection: collectionName,
        itemsFound: items.length,
        itemsMigrated: written,
        verified: verification.match,
      });

      if (verification.match) {
        console.log(`  ✅ Migration verified (${verification.firestoreCount} documents)`);
      } else {
        console.log(`  ⚠️ Count mismatch: DynamoDB=${verification.dynamoCount}, Firestore=${verification.firestoreCount}`);
      }

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
      results.push({
        table: tableName,
        collection: collectionName,
        itemsFound: 0,
        itemsMigrated: 0,
        verified: false,
        error: error.message,
      });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));

  let totalItems = 0;
  let totalMigrated = 0;
  let allVerified = true;

  for (const result of results) {
    const status = result.error ? '❌' : result.verified ? '✅' : '⚠️';
    console.log(`${status} ${result.table} -> ${result.collection}`);
    console.log(`   Found: ${result.itemsFound}, Migrated: ${result.itemsMigrated}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }

    totalItems += result.itemsFound;
    totalMigrated += result.itemsMigrated;
    if (!result.verified) allVerified = false;
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`Total items found: ${totalItems}`);
  console.log(`Total items migrated: ${totalMigrated}`);
  console.log(`All verified: ${allVerified ? '✅ Yes' : '⚠️ No'}`);
  console.log('='.repeat(60));

  if (!allVerified) {
    process.exit(1);
  }
}

// Run migration
migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
