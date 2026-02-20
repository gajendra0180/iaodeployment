/**
 * Firestore-backed Cache Service (replaces DynamoDB Cache Service)
 *
 * Features:
 * - Persistent cache (survives server restarts)
 * - Shared cache across all instances
 * - Environment-aware keys (dev_ prefix for non-production)
 * - Graceful degradation (returns stale data with isExpired flag)
 * - TTL-based expiration with Firestore TTL policy auto-cleanup
 */

import { getFirestoreClient, Collections, Timestamp } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';
import dayjs from 'dayjs';

// Configuration
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Firestore client singleton
let firestoreClient: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestoreClient) {
    firestoreClient = getFirestoreClient();
  }
  return firestoreClient;
}

/**
 * Cache entry stored in Firestore
 */
interface CacheEntry {
  id: string;           // Cache key (with dev_ prefix for non-production)
  data: string;         // JSON stringified cache data
  dataTime: number;     // Unix timestamp of write (seconds)
  ttl: Timestamp;       // Firestore Timestamp for TTL auto-cleanup
}

/**
 * Internal cache data structure
 */
interface CacheData<T> {
  data: T;
  putTimestamp: number;          // Timestamp in milliseconds
  formatPutTimestamp: string;    // Human-readable timestamp
  duration: number;              // TTL in milliseconds, -1 = never expire
}

/**
 * Cache result returned by getCached()
 */
export interface CacheResult<T> {
  isExpired: boolean;   // Whether the cache entry has expired
  data: T;              // Cached data (may be stale if isExpired)
  maxAge?: number;      // Remaining TTL in seconds (if not expired)
}

/**
 * Predefined cache key generators for common use cases
 */
export const CacheKeys = {
  SERVER_BY_SLUG: (slug: string) => `server:${slug.toLowerCase()}`,
  SERVER_BY_ID: (tokenAddress: string) => `server:id:${tokenAddress.toLowerCase()}`,
  METRICS: (tokenAddress: string) => `metrics:${tokenAddress.toLowerCase()}`,
  CONTRACT_STATE: (tokenAddress: string) => `contract:${tokenAddress.toLowerCase()}`,
  ALL_SERVERS: () => 'servers:all',
  SERVERS_BY_CHAIN: (chainId: string) => `servers:chain:${chainId}`,
};

/**
 * Default TTL values in milliseconds
 */
export const CacheTTL = {
  SHORT: 1 * 60 * 1000,       // 1 minute
  MEDIUM: 5 * 60 * 1000,      // 5 minutes (default)
  LONG: 10 * 60 * 1000,       // 10 minutes
  HOUR: 60 * 60 * 1000,       // 1 hour
  NEVER: -1,                  // Never expire
};

/**
 * Get environment-aware cache key
 * Adds dev_ prefix for non-production environments to prevent pollution
 */
function getCacheKey(key: string): string {
  return IS_PRODUCTION ? key : `dev_${key}`;
}

/**
 * Store value in cache with optional TTL
 * @param key - Cache key
 * @param value - Value to cache
 * @param durationMs - TTL in milliseconds (default: 5 minutes)
 */
export async function setCached<T>(
  key: string,
  value: T,
  durationMs: number = CacheTTL.MEDIUM
): Promise<void> {
  try {
    const cacheKey = getCacheKey(key);
    const date = new Date();
    const currentTimeSeconds = Math.round(date.getTime() / 1000);

    const cacheData: CacheData<T> = {
      data: value,
      putTimestamp: date.getTime(),
      formatPutTimestamp: dayjs(date).format("YYYY-MM-DD HH:mm:ss:SSS"),
      duration: durationMs,
    };

    // Set TTL timestamp - Firestore will auto-delete expired documents
    // For "never expire", set TTL to 100 years
    const ttlSeconds = durationMs === -1
      ? currentTimeSeconds + (100 * 365 * 24 * 60 * 60)
      : currentTimeSeconds + Math.ceil(durationMs / 1000) + 86400; // Add 1 day buffer

    const cacheEntry: CacheEntry = {
      id: cacheKey,
      data: JSON.stringify(cacheData),
      dataTime: currentTimeSeconds,
      ttl: Timestamp.fromMillis(ttlSeconds * 1000),
    };

    await getFirestore()
      .collection(Collections.CACHE)
      .doc(cacheKey)
      .set(cacheEntry);

    console.log(`📦 Cache SET: ${key} (TTL: ${durationMs}ms)`);
  } catch (error) {
    console.error(`❌ setCacheError|${key}|${error}`);
    // Don't throw - cache failures shouldn't break the application
  }
}

/**
 * Get value from cache
 * Returns { isExpired, data, maxAge } or undefined if not found
 *
 * @param key - Cache key
 * @returns Cache result with expiration status, or undefined if not found
 */
export async function getCached<T>(key: string): Promise<CacheResult<T> | undefined> {
  try {
    const cacheKey = getCacheKey(key);
    const doc = await getFirestore()
      .collection(Collections.CACHE)
      .doc(cacheKey)
      .get();

    if (!doc.exists) {
      console.log(`📦 Cache MISS: ${key}`);
      return undefined;
    }

    const entry = doc.data() as CacheEntry;
    const cacheData: CacheData<T> = JSON.parse(entry.data);
    const currentTimestamp = Date.now();

    // Duration -1 means never expire
    if (cacheData.duration === -1) {
      console.log(`📦 Cache HIT: ${key} (never expires)`);
      return { isExpired: false, data: cacheData.data };
    }

    // Check if expired
    const expiresAt = cacheData.putTimestamp + cacheData.duration;
    if (expiresAt < currentTimestamp) {
      console.log(`📦 Cache STALE: ${key} (expired ${Math.round((currentTimestamp - expiresAt) / 1000)}s ago)`);
      return { isExpired: true, data: cacheData.data };
    }

    // Calculate remaining TTL in seconds
    const maxAge = Math.floor((expiresAt - currentTimestamp) / 1000);
    console.log(`📦 Cache HIT: ${key} (expires in ${maxAge}s)`);
    return { isExpired: false, data: cacheData.data, maxAge };
  } catch (error) {
    console.error(`❌ getCacheError|${key}|${error}`);
    return undefined;
  }
}

/**
 * Delete cache entry
 * @param key - Cache key to delete
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    const cacheKey = getCacheKey(key);
    await getFirestore()
      .collection(Collections.CACHE)
      .doc(cacheKey)
      .delete();
    console.log(`📦 Cache DELETE: ${key}`);
  } catch (error) {
    console.error(`❌ deleteCacheError|${key}|${error}`);
    // Don't throw - cache failures shouldn't break the application
  }
}

/**
 * Invalidate all cache entries matching a prefix
 * Note: This requires a query in Firestore
 * @param prefix - Key prefix to match (e.g., "server:" to invalidate all server caches)
 */
export async function invalidateCacheByPrefix(prefix: string): Promise<void> {
  try {
    const cachePrefix = getCacheKey(prefix);
    const snapshot = await getFirestore()
      .collection(Collections.CACHE)
      .where('id', '>=', cachePrefix)
      .where('id', '<', cachePrefix + '\uf8ff')
      .get();

    if (snapshot.empty) {
      console.log(`📦 No cache entries found with prefix: ${prefix}`);
      return;
    }

    const batch = getFirestore().batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    console.log(`📦 Cache DELETE by prefix: ${prefix} (${snapshot.docs.length} entries)`);
  } catch (error) {
    console.error(`❌ deleteCacheByPrefixError|${prefix}|${error}`);
    // Don't throw - cache failures shouldn't break the application
  }
}

/**
 * Helper function to get cached value or fetch fresh data
 * Implements cache-aside pattern with stale-while-revalidate behavior
 *
 * @param key - Cache key
 * @param fetchFn - Function to fetch fresh data if cache miss/expired
 * @param ttlMs - TTL in milliseconds
 * @param useStaleOnError - Whether to use stale data if fetch fails (default: true)
 */
export async function getOrSet<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = CacheTTL.MEDIUM,
  useStaleOnError: boolean = true
): Promise<T> {
  // Check cache first
  const cacheResult = await getCached<T>(key);

  // Cache hit and not expired - return immediately
  if (cacheResult && !cacheResult.isExpired) {
    return cacheResult.data;
  }

  // Cache miss or expired - fetch fresh data
  try {
    const freshData = await fetchFn();

    // Update cache with fresh data
    await setCached(key, freshData, ttlMs);

    return freshData;
  } catch (error) {
    // If fetch fails but we have stale data, return it
    if (useStaleOnError && cacheResult?.data) {
      console.warn(`⚠️ Fetch failed, returning stale cache for: ${key}`);
      return cacheResult.data;
    }

    // No stale data available, re-throw the error
    throw error;
  }
}
