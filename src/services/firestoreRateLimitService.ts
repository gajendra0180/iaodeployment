/**
 * Firestore-based Rate Limiting Service (replaces DynamoDB Rate Limiting)
 *
 * Provides distributed rate limiting that works across multiple server instances.
 * Uses Firestore with TTL for automatic cleanup.
 */

import { getFirestoreClient, Collections, FieldValue, Timestamp } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';

// Firestore client singleton
let firestoreClient: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestoreClient) {
    firestoreClient = getFirestoreClient();
  }
  return firestoreClient;
}

// Rate limit configuration (can be overridden via env vars)
export const RATE_LIMITS = {
  global: {
    windowMs: parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '1000'),
  },
  ip: {
    windowMs: parseInt(process.env.RATE_LIMIT_IP_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_IP_MAX || '100'),
  },
  wallet: {
    windowMs: parseInt(process.env.RATE_LIMIT_WALLET_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_WALLET_MAX || '50'),
  },
  api: {
    windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_API_MAX || '200'),
  },
};

/**
 * Rate limit entry stored in Firestore
 */
interface RateLimitEntry {
  id: string;           // Document ID (e.g., "ip:1.2.3.4", "wallet:0xabc")
  count: number;        // Current request count in window
  windowStart: number;  // Timestamp when window started (ms)
  ttl: Timestamp;       // TTL for auto-deletion
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  allowed: boolean;     // Whether request is allowed
  current: number;      // Current count in window
  limit: number;        // Maximum allowed
  remaining: number;    // Remaining requests in window
  resetAt: number;      // When window resets (timestamp ms)
  retryAfter?: number;  // Seconds until retry (if blocked)
}

/**
 * Check and update rate limit for a given key
 * Uses Firestore transaction to prevent race conditions
 */
export async function checkRateLimit(
  key: string,
  limitType: 'global' | 'ip' | 'wallet' | 'api'
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[limitType];
  const now = Date.now();
  const windowMs = config.windowMs;
  const maxRequests = config.max;

  try {
    const docRef = getFirestore().collection(Collections.RATE_LIMITS).doc(key);

    // Use a transaction to ensure atomic read-modify-write
    const result = await getFirestore().runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      const entry = doc.exists ? doc.data() as RateLimitEntry : null;

      const windowStart = entry?.windowStart || 0;
      const currentCount = entry?.count || 0;

      // Check if we're in a new window
      const windowExpired = (now - windowStart) >= windowMs;

      if (windowExpired) {
        // Start new window with count = 1
        const newWindowStart = now;
        const ttlTime = now + windowMs * 2; // TTL = 2x window for safety

        const newEntry: RateLimitEntry = {
          id: key,
          count: 1,
          windowStart: newWindowStart,
          ttl: Timestamp.fromMillis(ttlTime),
        };

        transaction.set(docRef, newEntry);

        return {
          allowed: true,
          current: 1,
          limit: maxRequests,
          remaining: maxRequests - 1,
          resetAt: newWindowStart + windowMs,
        };
      }

      // Same window - check if limit exceeded
      if (currentCount >= maxRequests) {
        const resetAt = windowStart + windowMs;
        const retryAfter = Math.ceil((resetAt - now) / 1000);

        return {
          allowed: false,
          current: currentCount,
          limit: maxRequests,
          remaining: 0,
          resetAt,
          retryAfter: Math.max(1, retryAfter),
        };
      }

      // Increment counter
      const newCount = currentCount + 1;
      transaction.update(docRef, { count: FieldValue.increment(1) });

      return {
        allowed: newCount <= maxRequests,
        current: newCount,
        limit: maxRequests,
        remaining: Math.max(0, maxRequests - newCount),
        resetAt: windowStart + windowMs,
      };
    });

    return result;

  } catch (error: any) {
    // If collection doesn't exist or other error, allow request but log warning
    if (error.code === 5) { // NOT_FOUND
      console.warn(`⚠️ Rate limit collection not found. Rate limiting disabled.`);
    } else {
      console.error(`❌ Rate limit check failed for ${key}:`, error.message);
    }

    // Fail open - allow request if rate limiting fails
    return {
      allowed: true,
      current: 0,
      limit: maxRequests,
      remaining: maxRequests,
      resetAt: now + windowMs,
    };
  }
}

/**
 * Generate rate limit key for IP
 */
export function getIpKey(ip: string): string {
  return `ip:${ip}`;
}

/**
 * Generate rate limit key for wallet
 */
export function getWalletKey(wallet: string): string {
  return `wallet:${wallet.toLowerCase()}`;
}

/**
 * Generate rate limit key for API endpoint
 */
export function getApiKey(serverSlug: string, apiSlug: string): string {
  return `api:${serverSlug.toLowerCase()}:${apiSlug.toLowerCase()}`;
}

/**
 * Generate rate limit key for global limit
 */
export function getGlobalKey(): string {
  return 'global';
}

/**
 * Check multiple rate limits at once
 * Returns the most restrictive result
 */
export async function checkMultipleRateLimits(
  checks: Array<{ key: string; type: 'global' | 'ip' | 'wallet' | 'api' }>
): Promise<{ allowed: boolean; result: RateLimitResult; failedType?: string }> {
  for (const check of checks) {
    const result = await checkRateLimit(check.key, check.type);
    if (!result.allowed) {
      return { allowed: false, result, failedType: check.type };
    }
  }

  // All passed - return last result
  const lastCheck = checks[checks.length - 1];
  const result = await checkRateLimit(lastCheck.key, lastCheck.type);
  return { allowed: true, result };
}

/**
 * Get current rate limit status without incrementing
 */
export async function getRateLimitStatus(key: string): Promise<RateLimitEntry | null> {
  try {
    const doc = await getFirestore()
      .collection(Collections.RATE_LIMITS)
      .doc(key)
      .get();

    if (!doc.exists) {
      return null;
    }
    return doc.data() as RateLimitEntry;
  } catch (error) {
    console.error(`❌ Failed to get rate limit status for ${key}:`, error);
    return null;
  }
}

export default {
  checkRateLimit,
  checkMultipleRateLimits,
  getRateLimitStatus,
  getIpKey,
  getWalletKey,
  getApiKey,
  getGlobalKey,
  RATE_LIMITS,
};
