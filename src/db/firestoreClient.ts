/**
 * Firestore Client Initialization
 *
 * Shared Firestore client for all services.
 * Replaces DynamoDB client from AWS migration.
 */

import { Firestore, FieldValue, Timestamp, DocumentSnapshot, QueryDocumentSnapshot } from '@google-cloud/firestore';

let firestoreClient: Firestore | null = null;

/**
 * Get the shared Firestore client instance (singleton pattern)
 *
 * Authentication methods (in order of precedence):
 * 1. GCP_CREDENTIALS env var (JSON string) - for Vercel/Cloud Run deployment
 * 2. GOOGLE_APPLICATION_CREDENTIALS env var (file path) - for local development
 * 3. Default credentials (GCP compute instances, Cloud Run, etc.)
 */
export function getFirestoreClient(): Firestore {
  if (!firestoreClient) {
    const projectId = process.env.GCP_PROJECT_ID;

    if (!projectId) {
      console.warn('⚠️  GCP_PROJECT_ID not set. Firestore may fail to initialize.');
    }

    // Check for credentials in environment variable (JSON string)
    let credentials: any = undefined;
    if (process.env.GCP_CREDENTIALS) {
      try {
        credentials = JSON.parse(process.env.GCP_CREDENTIALS);
        console.log('🔑 Using GCP credentials from GCP_CREDENTIALS environment variable');
      } catch (error) {
        console.error('❌ Failed to parse GCP_CREDENTIALS:', error);
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log(`🔑 Using GCP credentials from file: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
    } else {
      console.log('🔍 Using GCP default credentials (service account, metadata server, etc.)');
    }

    firestoreClient = new Firestore({
      projectId,
      ...(credentials && { credentials }),
    });

    console.log(`✅ Firestore client initialized (Project: ${projectId || 'default'})`);
  }
  return firestoreClient;
}

/**
 * Collection names mapping (DynamoDB table → Firestore collection)
 */
export const Collections = {
  IAO_TOKENS: 'iao-tokens',
  USER_REQUESTS: 'user-requests',
  REQUEST_QUEUE: 'request-queue',
  API_METRICS: 'api-metrics',
  AGENTS: 'agents',
  CHAT_SESSIONS: 'chat-sessions',
  CHAT_MESSAGES: 'chat-messages',
  AGENT_PAYMENTS: 'agent-payments',
  CACHE: 'cache',
  RATE_LIMITS: 'rate-limits',
  CHAIN_CONFIGS: 'chain-configs',
  ALERTS: 'alerts',
  WEBHOOKS: 'webhooks',
} as const;

/**
 * Helper to convert Firestore DocumentSnapshot to plain object
 */
export function docToObject<T>(doc: DocumentSnapshot | QueryDocumentSnapshot): T | null {
  if (!doc.exists) {
    return null;
  }
  return { id: doc.id, ...doc.data() } as T;
}

/**
 * Helper to convert array of DocumentSnapshots to plain objects
 */
export function docsToObjects<T>(docs: QueryDocumentSnapshot[]): T[] {
  return docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
}

// Re-export Firestore utilities for use in services
export { FieldValue, Timestamp };
