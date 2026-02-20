/**
 * Firestore User Request Service (replaces DynamoDB User Request Service)
 * Handles user request tracking and request queue management
 */

import { getFirestoreClient, Collections, FieldValue } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';

// Firestore client singleton
let firestoreClient: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestoreClient) {
    firestoreClient = getFirestoreClient();
  }
  return firestoreClient;
}

export interface UserRequestDBEntry {
  id: string; // Composite key: `${iaoToken}#${from}` (lowercase for EVM, original for Solana)
  iaoToken: string; // Token address (lowercase for EVM, original for Solana)
  from: string; // User address (lowercase for EVM, original for Solana)
  totalRequest: string; // BigInt as string
  fulfilledRequest: string; // BigInt as string
  refundRequest: string; // BigInt as string
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface RequestQueueDBEntry {
  id: string; // Unique identifier: `${iaoToken}#${from}#${userRequestNumber}`
  iaoToken: string; // Token address (lowercase for EVM, original for Solana)
  from: string; // User address (lowercase for EVM, original for Solana)
  userRequestNumber: string; // BigInt as string
  globalRequestNumber: string; // BigInt as string
  fee: string; // Fee paid by user in payment token wei (e.g., "10000" for $0.01)
  createdAt: string; // ISO timestamp
}

/**
 * Normalize address based on type
 * EVM addresses (0x...) are lowercased for consistency
 * Solana addresses (base58) are kept original because base58 is case-sensitive
 */
function normalizeAddress(address: string): string {
  if (address.startsWith('0x')) {
    return address.toLowerCase(); // EVM address
  }
  return address; // Solana address - keep original case
}

class UserRequestService {
  private userRequestCollection: string;
  private requestQueueCollection: string;

  constructor(_region: string, _userRequestTableName: string, _requestQueueTableName: string) {
    // Region and table names are ignored - using Firestore collections
    this.userRequestCollection = Collections.USER_REQUESTS;
    this.requestQueueCollection = Collections.REQUEST_QUEUE;
  }

  /**
   * Get or create a user request
   */
  async getOrCreateUserRequest(iaoToken: string, from: string): Promise<UserRequestDBEntry> {
    const normalizedToken = normalizeAddress(iaoToken);
    const normalizedFrom = normalizeAddress(from);
    const id = `${normalizedToken}#${normalizedFrom}`;

    try {
      const docRef = getFirestore().collection(this.userRequestCollection).doc(id);
      const doc = await docRef.get();

      if (doc.exists) {
        return doc.data() as UserRequestDBEntry;
      }

      // Create new user request
      const now = new Date().toISOString();
      const newUserRequest: UserRequestDBEntry = {
        id,
        iaoToken: normalizedToken,
        from: normalizedFrom,
        totalRequest: "0",
        fulfilledRequest: "0",
        refundRequest: "0",
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(newUserRequest);
      return newUserRequest;
    } catch (err) {
      console.error(`❌ Firestore getOrCreateUserRequest fail for ${id}:`, err);
      throw err;
    }
  }

  /**
   * Increment totalRequest and create a RequestQueue entry
   */
  async createRequestQueueEntry(
    iaoToken: string,
    from: string,
    globalRequestNumber: string,
    fee: string
  ): Promise<RequestQueueDBEntry> {
    try {
      // Get or create user request
      const userRequest = await this.getOrCreateUserRequest(iaoToken, from);

      // Increment totalRequest
      const newTotalRequest = (BigInt(userRequest.totalRequest) + BigInt(1)).toString();
      const userRequestNumber = newTotalRequest;

      // Update user request
      const userDocRef = getFirestore().collection(this.userRequestCollection).doc(userRequest.id);
      await userDocRef.update({
        totalRequest: newTotalRequest,
        updatedAt: new Date().toISOString(),
      });

      // Create request queue entry
      const normalizedToken = normalizeAddress(iaoToken);
      const normalizedFrom = normalizeAddress(from);
      const queueId = `${normalizedToken}#${normalizedFrom}#${userRequestNumber}`;
      const requestQueueEntry: RequestQueueDBEntry = {
        id: queueId,
        iaoToken: normalizedToken,
        from: normalizedFrom,
        userRequestNumber,
        globalRequestNumber,
        fee,
        createdAt: new Date().toISOString(),
      };

      await getFirestore()
        .collection(this.requestQueueCollection)
        .doc(queueId)
        .set(requestQueueEntry);

      console.log(`✅ Created RequestQueue entry: ${queueId} (globalRequestNumber: ${globalRequestNumber}, fee: ${fee})`);
      return requestQueueEntry;
    } catch (err) {
      console.error(`❌ Firestore createRequestQueueEntry fail:`, err);
      throw err;
    }
  }

  /**
   * Scan all user requests from the collection
   */
  async scanAllUserRequests(): Promise<UserRequestDBEntry[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.userRequestCollection)
        .get();

      return snapshot.docs.map(doc => doc.data() as UserRequestDBEntry);
    } catch (err) {
      console.error(`❌ Firestore scanAllUserRequests fail:`, err);
      throw err;
    }
  }

  /**
   * Scan all request queue entries from the collection
   */
  async scanAllRequestQueue(): Promise<RequestQueueDBEntry[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.requestQueueCollection)
        .get();

      return snapshot.docs.map(doc => doc.data() as RequestQueueDBEntry);
    } catch (err) {
      console.error(`❌ Firestore scanAllRequestQueue fail:`, err);
      throw err;
    }
  }

  /**
   * Get recent transactions (request queue entries) sorted by createdAt descending
   * @param limit - Maximum number of transactions to return (default: 20)
   */
  async getRecentTransactions(limit: number = 20): Promise<RequestQueueDBEntry[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.requestQueueCollection)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => doc.data() as RequestQueueDBEntry);
    } catch (err) {
      console.error(`❌ Failed to get recent transactions:`, err);
      throw err;
    }
  }
}

export { UserRequestService };
