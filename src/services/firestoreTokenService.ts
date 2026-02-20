/**
 * Firestore Token Service (replaces DynamoDB Service)
 *
 * Handles IAO Token CRUD operations using Cloud Firestore.
 * Maintains the same interface as the original DynamoDB service.
 */

import { getFirestoreClient, Collections } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';

/**
 * Individual API entry within a token
 * Multiple APIs can be registered under a single token
 */
export interface ApiEntry {
  index: number;        // 0-based index (order of registration)
  slug: string;         // Unique slug within the token (e.g., "eigenpie-pool")
  name: string;         // API name/title
  apiUrl: string;       // Builder's API endpoint URL (hidden from public)
  description: string;  // Required description
  fee: string;          // Fee in payment token smallest unit (e.g., "10000" = $0.01 USDC with 6 decimals)
  method?: 'GET' | 'POST';  // HTTP method (defaults to GET)
  createdAt: string;    // ISO timestamp when this API was added
}

/**
 * IAO Token database entry (represents a server/builder)
 * One token can have multiple APIs (1:N relationship)
 * Each API has its own fee (per-API pricing)
 */
export interface IAOTokenDBEntry {
  id: string;                    // Token address (lowercase) - Document ID
  slug: string;                  // Unique server slug (e.g., "magpie")
  name: string;                  // Token/server name
  symbol: string;                // Token symbol
  builder: string;               // Builder address (lowercase for EVM, original case for Solana)
  paymentToken: string;          // Payment token address
  chainId: string;               // Chain ID: "84532" (Base Sepolia), "devnet" (Solana), etc.
  subscriptionCount: string;     // BigInt as string, default "0" - aggregated across all APIs
  refundCount: string;           // BigInt as string, default "0"
  fulfilledCount: string;        // BigInt as string, default "0"
  totalFeesCollected?: string;   // BigInt as string - for Solana bonding progress tracking
  tags?: string[];               // Array of category tags (e.g., ["crypto", "trading"])
  apis: ApiEntry[];              // Array of registered APIs (each with own fee)
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}

/**
 * Normalize address for storage/lookup
 * EVM addresses (0x...) are lowercased for consistency
 * Solana addresses (base58) are kept as-is since base58 is case-sensitive
 */
function normalizeAddress(address: string): string {
  if (address.startsWith('0x')) {
    return address.toLowerCase();
  }
  return address; // Solana addresses - keep original case
}

class DynamoDBService {
  private firestore: Firestore;
  private collectionName: string;

  constructor(_region: string, _tableName: string) {
    // Region and tableName are ignored - using Firestore
    this.firestore = getFirestoreClient();
    this.collectionName = Collections.IAO_TOKENS;
  }

  async putItem(item: IAOTokenDBEntry): Promise<void> {
    try {
      const docRef = this.firestore.collection(this.collectionName).doc(item.id);
      await docRef.set(item);
      console.log(`✅ Firestore putItem success for ${item.id}`);
    } catch (err) {
      console.error(`❌ Firestore putItem fail for ${item.id}:`, err);
      throw err;
    }
  }

  async getItem(id: string): Promise<IAOTokenDBEntry | null> {
    const normalizedId = normalizeAddress(id);
    try {
      const docRef = this.firestore.collection(this.collectionName).doc(normalizedId);
      const doc = await docRef.get();
      if (!doc.exists) {
        return null;
      }
      return doc.data() as IAOTokenDBEntry;
    } catch (err) {
      console.error(`❌ Firestore getItem fail for ${id}:`, err);
      return null;
    }
  }

  async deleteItem(id: string): Promise<void> {
    const normalizedId = normalizeAddress(id);
    try {
      const docRef = this.firestore.collection(this.collectionName).doc(normalizedId);
      await docRef.delete();
      console.log(`✅ Firestore deleteItem success for ${id}`);
    } catch (err) {
      console.error(`❌ Firestore deleteItem fail for ${id}:`, err);
      throw err;
    }
  }

  async scanAllItems(): Promise<IAOTokenDBEntry[]> {
    try {
      const snapshot = await this.firestore.collection(this.collectionName).get();
      return snapshot.docs.map(doc => doc.data() as IAOTokenDBEntry);
    } catch (err) {
      console.error("❌ Firestore scanAllItems error:", err);
      throw err;
    }
  }

  async scanItemsByBuilder(builderAddress: string): Promise<IAOTokenDBEntry[]> {
    const normalizedBuilder = normalizeAddress(builderAddress);
    try {
      const snapshot = await this.firestore
        .collection(this.collectionName)
        .where('builder', '==', normalizedBuilder)
        .get();
      return snapshot.docs.map(doc => doc.data() as IAOTokenDBEntry);
    } catch (err) {
      console.error(`❌ Firestore scanItemsByBuilder error for ${builderAddress}:`, err);
      throw err;
    }
  }

  /**
   * Get a token by its slug using Firestore index for O(1) lookup
   */
  async getItemBySlug(slug: string): Promise<IAOTokenDBEntry | null> {
    const normalizedSlug = slug.toLowerCase();
    try {
      const snapshot = await this.firestore
        .collection(this.collectionName)
        .where('slug', '==', normalizedSlug)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }
      return snapshot.docs[0].data() as IAOTokenDBEntry;
    } catch (err) {
      console.error(`❌ Firestore getItemBySlug fail for ${slug}:`, err);
      return null;
    }
  }

  /**
   * Check if a server slug already exists
   */
  async slugExists(slug: string): Promise<boolean> {
    const token = await this.getItemBySlug(slug);
    return token !== null;
  }

  /**
   * Check if an API URL + method combination already exists globally across all servers
   * Same URL with different methods (GET vs POST) is allowed
   * Returns the server slug and token address if found
   */
  async apiUrlExists(apiUrl: string, method: 'GET' | 'POST' = 'GET'): Promise<{ exists: boolean; serverSlug?: string; tokenAddress?: string }> {
    try {
      const tokens = await this.scanAllItems();
      for (const token of tokens) {
        if (token.apis) {
          // Check for same URL AND same method
          const matchingApi = token.apis.find(api =>
            api.apiUrl === apiUrl && (api.method || 'GET') === method
          );
          if (matchingApi) {
            return {
              exists: true,
              serverSlug: token.slug,
              tokenAddress: token.id
            };
          }
        }
      }
      return { exists: false };
    } catch (err) {
      console.error(`❌ Firestore apiUrlExists error:`, err);
      return { exists: false };
    }
  }

  /**
   * Check if multiple API URL + method combinations exist globally
   * Same URL with different methods (GET vs POST) is allowed
   * Returns array of duplicates found
   */
  async checkApiUrlsDuplicate(apis: { url: string; method: 'GET' | 'POST' }[]): Promise<{ url: string; method: string; serverSlug: string; tokenAddress: string }[]> {
    try {
      const tokens = await this.scanAllItems();
      const duplicates: { url: string; method: string; serverSlug: string; tokenAddress: string }[] = [];

      for (const token of tokens) {
        if (token.apis) {
          for (const existingApi of token.apis) {
            // Check if any of the new APIs match both URL and method
            const matchingNew = apis.find(newApi =>
              newApi.url === existingApi.apiUrl &&
              newApi.method === (existingApi.method || 'GET')
            );
            if (matchingNew) {
              duplicates.push({
                url: existingApi.apiUrl,
                method: existingApi.method || 'GET',
                serverSlug: token.slug,
                tokenAddress: token.id
              });
            }
          }
        }
      }

      return duplicates;
    } catch (err) {
      console.error(`❌ Firestore checkApiUrlsDuplicate error:`, err);
      return [];
    }
  }

  /**
   * Add a new API to an existing token
   * The new API will be assigned the next available index
   */
  async addApiToToken(tokenAddress: string, apiSlug: string, apiName: string, apiUrl: string, description: string, fee: string, method: 'GET' | 'POST' = 'GET'): Promise<ApiEntry | null> {
    const token = await this.getItem(tokenAddress);
    if (!token) {
      console.error(`❌ Token ${tokenAddress} not found`);
      return null;
    }

    // Ensure apis array exists
    const apis = token.apis || [];

    // Check if API slug already exists within this token
    if (apis.some(api => api.slug === apiSlug.toLowerCase())) {
      console.error(`❌ API slug ${apiSlug} already exists in token ${tokenAddress}`);
      return null;
    }

    // Calculate next index
    const nextIndex = apis.length;

    // Create new API entry
    const newApi: ApiEntry = {
      index: nextIndex,
      slug: apiSlug.toLowerCase(),
      name: apiName,
      apiUrl: apiUrl,
      description: description,
      fee: fee,
      method: method,
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
    console.log(`✅ Added API ${apiName} (slug: ${apiSlug}, index: ${nextIndex}) to token ${tokenAddress}`);

    return newApi;
  }

  /**
   * Get a specific API from a token by slug
   */
  getApiBySlug(token: IAOTokenDBEntry, apiSlug: string): ApiEntry | null {
    if (!token.apis || token.apis.length === 0) {
      return null;
    }
    return token.apis.find(api => api.slug === apiSlug.toLowerCase()) || null;
  }

  /**
   * Get a specific API from a token by index
   */
  getApiByIndex(token: IAOTokenDBEntry, index: number): ApiEntry | null {
    if (!token.apis || token.apis.length === 0) {
      return null;
    }
    return token.apis.find(api => api.index === index) || null;
  }
}

export { DynamoDBService };
