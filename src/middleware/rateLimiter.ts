/**
 * Rate Limiting Middleware for APIX Proxy
 *
 * DynamoDB-based distributed rate limiting that works across multiple server instances.
 *
 * Four-tiered rate limiting:
 * 1. Global: Protect entire platform from overload
 * 2. Per-IP: Prevent single IP from overwhelming the system
 * 3. Per-wallet: Prevent abuse from a single wallet address
 * 4. Per-API: Protect individual builder endpoints
 */

import { Request, Response, NextFunction } from 'express';
import {
  checkRateLimit,
  getIpKey,
  getWalletKey,
  getApiKey,
  getGlobalKey,
  RATE_LIMITS,
  RateLimitResult,
} from '../services/firestoreRateLimitService.js';

/**
 * Extract IP address from request
 * Handles X-Forwarded-For for requests behind proxy/load balancer
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(',')[0].trim();
    return ip;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Extract wallet address from payment signature header
 */
function extractWalletFromPayment(paymentData: string | string[] | undefined): string | null {
  if (!paymentData || Array.isArray(paymentData)) return null;

  try {
    const decoded = Buffer.from(paymentData, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    // EVM: Look for "from" field in payment data
    if (parsed.from) {
      return parsed.from.toLowerCase();
    }

    // Solana: Look for "payer" field
    if (parsed.payer) {
      return parsed.payer;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Send rate limit response
 */
function sendRateLimitResponse(res: Response, result: RateLimitResult, message: string): void {
  res.set({
    'RateLimit-Limit': result.limit.toString(),
    'RateLimit-Remaining': result.remaining.toString(),
    'RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
    'Retry-After': (result.retryAfter || 60).toString(),
  });

  res.status(429).json({
    error: 'Too many requests',
    message,
    limit: result.limit,
    remaining: result.remaining,
    resetAt: new Date(result.resetAt).toISOString(),
    retryAfter: result.retryAfter,
  });
}

/**
 * Set rate limit headers on successful request
 */
function setRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.set({
    'RateLimit-Limit': result.limit.toString(),
    'RateLimit-Remaining': result.remaining.toString(),
    'RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
  });
}

/**
 * Global rate limiter middleware
 * Applies to all requests (except health checks)
 */
export async function globalRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip health checks
  if (req.path === '/health' || req.path === '/') {
    next();
    return;
  }

  try {
    const result = await checkRateLimit(getGlobalKey(), 'global');

    if (!result.allowed) {
      sendRateLimitResponse(res, result, 'Service is receiving too many requests. Please try again later.');
      return;
    }

    setRateLimitHeaders(res, result);
    next();
  } catch (error) {
    // Fail open - allow request if rate limiting fails
    console.error('Global rate limiter error:', error);
    next();
  }
}

/**
 * IP rate limiter middleware
 */
export async function ipRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip health checks
  if (req.path === '/health' || req.path === '/') {
    next();
    return;
  }

  try {
    const ip = getClientIp(req);
    const result = await checkRateLimit(getIpKey(ip), 'ip');

    if (!result.allowed) {
      sendRateLimitResponse(res, result, 'Too many requests from this IP. Please try again later.');
      return;
    }

    setRateLimitHeaders(res, result);
    next();
  } catch (error) {
    console.error('IP rate limiter error:', error);
    next();
  }
}

/**
 * Wallet rate limiter middleware
 * Only applies to API proxy routes with payment
 */
export async function walletRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Only apply to API proxy routes
  const isApiProxy = req.path.match(/^\/api\/[^\/]+\/[^\/]+$/);
  if (!isApiProxy) {
    next();
    return;
  }

  try {
    const paymentData = req.headers['payment-signature'] as string;
    const wallet = extractWalletFromPayment(paymentData);

    if (!wallet) {
      // No wallet found, skip wallet rate limiting
      next();
      return;
    }

    const result = await checkRateLimit(getWalletKey(wallet), 'wallet');

    if (!result.allowed) {
      sendRateLimitResponse(res, result, 'Rate limit exceeded for this wallet. Please try again later.');
      return;
    }

    setRateLimitHeaders(res, result);
    next();
  } catch (error) {
    console.error('Wallet rate limiter error:', error);
    next();
  }
}

/**
 * API endpoint rate limiter middleware
 * Protects individual builder endpoints
 */
export async function apiRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Only apply to API proxy routes
  const isApiProxy = req.path.match(/^\/api\/[^\/]+\/[^\/]+$/);
  if (!isApiProxy) {
    next();
    return;
  }

  try {
    const serverSlug = (req.params.serverSlug as string) || req.path.split('/')[2];
    const apiSlug = (req.params.apiSlug as string) || req.path.split('/')[3];

    const result = await checkRateLimit(getApiKey(serverSlug, apiSlug), 'api');

    if (!result.allowed) {
      sendRateLimitResponse(res, result, 'This API endpoint is receiving too many requests. Please try again later.');
      return;
    }

    setRateLimitHeaders(res, result);
    next();
  } catch (error) {
    console.error('API rate limiter error:', error);
    next();
  }
}

/**
 * Combined rate limiter for API proxy routes
 * Checks all limits in sequence: global → IP → wallet → API
 */
export async function combinedApiRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip health checks
  if (req.path === '/health' || req.path === '/') {
    next();
    return;
  }

  try {
    const ip = getClientIp(req);
    const serverSlug = (req.params.serverSlug as string) || req.path.split('/')[2];
    const apiSlug = (req.params.apiSlug as string) || req.path.split('/')[3];
    const paymentData = req.headers['payment-signature'] as string;
    const wallet = extractWalletFromPayment(paymentData);

    // Check global limit
    const globalResult = await checkRateLimit(getGlobalKey(), 'global');
    if (!globalResult.allowed) {
      sendRateLimitResponse(res, globalResult, 'Service is receiving too many requests. Please try again later.');
      return;
    }

    // Check IP limit
    const ipResult = await checkRateLimit(getIpKey(ip), 'ip');
    if (!ipResult.allowed) {
      sendRateLimitResponse(res, ipResult, 'Too many requests from this IP. Please try again later.');
      return;
    }

    // Check wallet limit (if wallet present)
    if (wallet) {
      const walletResult = await checkRateLimit(getWalletKey(wallet), 'wallet');
      if (!walletResult.allowed) {
        sendRateLimitResponse(res, walletResult, 'Rate limit exceeded for this wallet. Please try again later.');
        return;
      }
    }

    // Check API limit
    const apiResult = await checkRateLimit(getApiKey(serverSlug, apiSlug), 'api');
    if (!apiResult.allowed) {
      sendRateLimitResponse(res, apiResult, 'This API endpoint is receiving too many requests. Please try again later.');
      return;
    }

    // All checks passed - set headers from most restrictive (API)
    setRateLimitHeaders(res, apiResult);
    next();
  } catch (error) {
    console.error('Combined rate limiter error:', error);
    // Fail open
    next();
  }
}

/**
 * Rate limit middleware stack for API proxy routes
 * Use this array with spread operator: app.get('/api/:s/:a', ...apiProxyRateLimiters, handler)
 */
export const apiProxyRateLimiters = [
  ipRateLimiter,
  walletRateLimiter,
  apiRateLimiter,
];

/**
 * Get current rate limit configuration
 */
export function getRateLimitConfig() {
  return RATE_LIMITS;
}

export default {
  globalRateLimiter,
  ipRateLimiter,
  walletRateLimiter,
  apiRateLimiter,
  combinedApiRateLimiter,
  apiProxyRateLimiters,
  getRateLimitConfig,
};
