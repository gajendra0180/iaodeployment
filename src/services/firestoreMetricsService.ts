/**
 * Firestore Metrics Service (replaces DynamoDB Metrics Service)
 * Tracks and aggregates API usage metrics, revenue, and performance data
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

/**
 * Individual call record (for last 100 calls tracking)
 */
export interface CallRecord {
  timestamp: string; // ISO timestamp
  success: boolean;
  latencyMs: number;
  revenue: string; // Fee paid (BigInt as string)
}

/**
 * Per-API metrics entry
 */
export interface ApiMetricsEntry {
  id: string; // `${tokenAddress}#${apiSlug}` (lowercase)
  tokenAddress: string; // Token address (lowercase)
  apiSlug: string; // API slug (lowercase)
  callCount: string; // BigInt as string (total historical count)
  totalRevenue: string; // BigInt as string (total USDC paid to contract - not builder revenue)
  successCount: string; // BigInt as string (total historical success)
  failureCount: string; // BigInt as string (total historical failure)
  totalLatency: string; // BigInt as string (total historical latency)
  averageLatency: string; // Number as string (average response time in ms)
  recentCalls?: CallRecord[]; // Last 100 calls (for rolling window metrics)
  lastCallAt: string; // ISO timestamp
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Server-level metrics (aggregated)
 */
export interface ServerMetrics {
  totalCalls: string; // Total API calls across all APIs
  totalRevenue: string; // Total USDC paid to contract (in wei) - not builder revenue
  totalRevenueUSD: number; // Total USDC paid to contract (in USD, assuming 6 decimals)
  averageLatency: number; // Average response time across all APIs (ms)
  p95Latency: number; // 95th percentile latency across all APIs (ms)
  successRate: number; // Success rate percentage (0-100)
  apiCount: number; // Number of APIs
  perApiMetrics: {
    apiSlug: string;
    callCount: string;
    revenue: string; // USDC paid to contract (not builder revenue)
    revenueUSD: number; // USDC paid to contract (USD)
    averageLatency: number;
    p95Latency: number;
    successRate: number;
  }[];
}

/**
 * Contract metrics (from blockchain)
 */
export interface ContractMetrics {
  tokenAddress: string;
  graduationThreshold: string; // BigInt as string
  totalTokensDistributed: string; // BigInt as string
  totalFeesCollected: string; // BigInt as string
  bondingProgress: number; // Percentage (0-100)
  isGraduated: boolean;
  uniswapLink?: string; // Uniswap pool link if graduated
}

class MetricsService {
  private collectionName: string;

  constructor(_region: string, _metricsTableName: string) {
    // Region and tableName are ignored - using Firestore
    this.collectionName = Collections.API_METRICS;
  }

  /**
   * Record an API call with metrics
   * Maintains a rolling window of the last 100 calls
   */
  async recordApiCall(
    tokenAddress: string,
    apiSlug: string,
    fee: string,
    success: boolean,
    latencyMs: number
  ): Promise<void> {
    try {
      const id = `${tokenAddress.toLowerCase()}#${apiSlug.toLowerCase()}`;
      const now = new Date().toISOString();
      const docRef = getFirestore().collection(this.collectionName).doc(id);

      // Create new call record
      const newCallRecord: CallRecord = {
        timestamp: now,
        success,
        latencyMs: Math.round(latencyMs),
        revenue: fee,
      };

      // Use a transaction to ensure atomic read-modify-write
      await getFirestore().runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (doc.exists) {
          // Update existing metrics
          const current = doc.data() as ApiMetricsEntry;
          const newCallCount = (BigInt(current.callCount) + BigInt(1)).toString();
          const newTotalRevenue = (BigInt(current.totalRevenue) + BigInt(fee)).toString();
          const newSuccessCount = success
            ? (BigInt(current.successCount) + BigInt(1)).toString()
            : current.successCount;
          const newFailureCount = !success
            ? (BigInt(current.failureCount) + BigInt(1)).toString()
            : current.failureCount;
          const newTotalLatency = (BigInt(current.totalLatency) + BigInt(Math.round(latencyMs))).toString();
          const newAverageLatency = (Number(newTotalLatency) / Number(newCallCount)).toFixed(2);

          // Update recent calls array (keep last 100)
          const recentCalls = current.recentCalls || [];
          recentCalls.push(newCallRecord);
          const updatedRecentCalls = recentCalls.slice(-100);

          transaction.update(docRef, {
            callCount: newCallCount,
            totalRevenue: newTotalRevenue,
            successCount: newSuccessCount,
            failureCount: newFailureCount,
            totalLatency: newTotalLatency,
            averageLatency: newAverageLatency,
            recentCalls: updatedRecentCalls,
            lastCallAt: now,
            updatedAt: now,
          });
        } else {
          // Create new metrics entry
          const newMetrics: ApiMetricsEntry = {
            id,
            tokenAddress: tokenAddress.toLowerCase(),
            apiSlug: apiSlug.toLowerCase(),
            callCount: "1",
            totalRevenue: fee,
            successCount: success ? "1" : "0",
            failureCount: success ? "0" : "1",
            totalLatency: Math.round(latencyMs).toString(),
            averageLatency: Math.round(latencyMs).toFixed(2),
            recentCalls: [newCallRecord],
            lastCallAt: now,
            createdAt: now,
            updatedAt: now,
          };

          transaction.set(docRef, newMetrics);
        }
      });
    } catch (error) {
      console.error(`❌ Failed to record API call metrics:`, error);
      // Don't throw - metrics are non-critical
    }
  }

  /**
   * Get metrics for a specific API
   */
  async getApiMetrics(tokenAddress: string, apiSlug: string): Promise<ApiMetricsEntry | null> {
    try {
      const id = `${tokenAddress.toLowerCase()}#${apiSlug.toLowerCase()}`;
      const doc = await getFirestore()
        .collection(this.collectionName)
        .doc(id)
        .get();

      if (!doc.exists) {
        return null;
      }
      return doc.data() as ApiMetricsEntry;
    } catch (error) {
      console.error(`❌ Failed to get API metrics:`, error);
      return null;
    }
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    const clampedIndex = Math.max(0, Math.min(index, sortedValues.length - 1));

    return sortedValues[clampedIndex];
  }

  /**
   * Calculate metrics from last 100 calls
   */
  calculateRecentMetrics(recentCalls: CallRecord[]): {
    callCount: number;
    totalRevenue: string;
    successCount: number;
    failureCount: number;
    averageLatency: number;
    p95Latency: number;
    successRate: number;
  } {
    if (!recentCalls || recentCalls.length === 0) {
      return {
        callCount: 0,
        totalRevenue: "0",
        successCount: 0,
        failureCount: 0,
        averageLatency: 0,
        p95Latency: 0,
        successRate: 0,
      };
    }

    const calls = recentCalls.slice(-100);

    let totalRevenue = BigInt(0);
    let successCount = 0;
    let failureCount = 0;
    let totalLatency = 0;
    const latencies: number[] = [];

    for (const call of calls) {
      totalRevenue += BigInt(call.revenue);
      if (call.success) {
        successCount++;
      } else {
        failureCount++;
      }
      totalLatency += call.latencyMs;
      latencies.push(call.latencyMs);
    }

    const callCount = calls.length;
    const averageLatency = callCount > 0 ? totalLatency / callCount : 0;

    const sortedLatencies = latencies.sort((a, b) => a - b);
    const p95Latency = this.calculatePercentile(sortedLatencies, 95);

    const totalAttempts = successCount + failureCount;
    const successRate = totalAttempts > 0
      ? (successCount / totalAttempts) * 100
      : 0;

    return {
      callCount,
      totalRevenue: totalRevenue.toString(),
      successCount,
      failureCount,
      averageLatency,
      p95Latency,
      successRate,
    };
  }

  /**
   * Calculate success rate from metrics entry
   */
  calculateSuccessRate(metrics: ApiMetricsEntry | null): number {
    if (!metrics) return 0;

    if (metrics.recentCalls && metrics.recentCalls.length > 0) {
      const recentMetrics = this.calculateRecentMetrics(metrics.recentCalls);
      return recentMetrics.successRate;
    }

    const success = BigInt(metrics.successCount);
    const failure = BigInt(metrics.failureCount);
    const totalAttempts = success + failure;

    if (totalAttempts === 0n) return 0;

    return (Number(success) / Number(totalAttempts)) * 100;
  }

  /**
   * Get all metrics for a server (all APIs)
   */
  async getServerMetrics(tokenAddress: string): Promise<ServerMetrics | null> {
    try {
      // Query all metrics for this token
      const snapshot = await getFirestore()
        .collection(this.collectionName)
        .where('tokenAddress', '==', tokenAddress.toLowerCase())
        .get();

      if (snapshot.empty) {
        return {
          totalCalls: "0",
          totalRevenue: "0",
          totalRevenueUSD: 0,
          averageLatency: 0,
          p95Latency: 0,
          successRate: 0,
          apiCount: 0,
          perApiMetrics: [],
        };
      }

      const apiMetrics = snapshot.docs.map(doc => doc.data() as ApiMetricsEntry);

      // Aggregate metrics
      let totalCalls = BigInt(0);
      let totalRevenue = BigInt(0);
      let totalLatency = BigInt(0);
      let totalSuccess = BigInt(0);
      let totalFailure = BigInt(0);
      const allLatencies: number[] = [];

      const perApiMetrics = apiMetrics.map(metric => {
        let recentMetrics;
        if (metric.recentCalls && metric.recentCalls.length > 0) {
          recentMetrics = this.calculateRecentMetrics(metric.recentCalls);
          metric.recentCalls.slice(-100).forEach(call => {
            allLatencies.push(call.latencyMs);
          });
        } else {
          const calls = BigInt(metric.callCount);
          const revenue = BigInt(metric.totalRevenue);
          const success = BigInt(metric.successCount);
          const failure = BigInt(metric.failureCount);

          const totalAttempts = success + failure;
          recentMetrics = {
            callCount: Number(calls),
            totalRevenue: revenue.toString(),
            successCount: Number(success),
            failureCount: Number(failure),
            averageLatency: Number(metric.averageLatency),
            p95Latency: Number(metric.averageLatency),
            successRate: totalAttempts > 0
              ? (Number(success) / Number(totalAttempts)) * 100
              : 0,
          };
        }

        totalCalls += BigInt(recentMetrics.callCount);
        totalRevenue += BigInt(recentMetrics.totalRevenue);
        totalLatency += BigInt(Math.round(recentMetrics.averageLatency * recentMetrics.callCount));
        totalSuccess += BigInt(recentMetrics.successCount);
        totalFailure += BigInt(recentMetrics.failureCount);

        return {
          apiSlug: metric.apiSlug,
          callCount: recentMetrics.callCount.toString(),
          revenue: recentMetrics.totalRevenue,
          revenueUSD: Number(BigInt(recentMetrics.totalRevenue)) / 1e6,
          averageLatency: recentMetrics.averageLatency,
          p95Latency: recentMetrics.p95Latency,
          successRate: recentMetrics.successRate,
        };
      });

      const totalCallsNum = Number(totalCalls);
      const averageLatency = totalCallsNum > 0
        ? Number(totalLatency) / totalCallsNum
        : 0;

      const sortedAllLatencies = allLatencies.sort((a, b) => a - b);
      const p95Latency = this.calculatePercentile(sortedAllLatencies, 95);

      const successRate = (totalSuccess + totalFailure) > 0n
        ? (Number(totalSuccess) / Number(totalSuccess + totalFailure)) * 100
        : 0;

      return {
        totalCalls: totalCalls.toString(),
        totalRevenue: totalRevenue.toString(),
        totalRevenueUSD: Number(totalRevenue) / 1e6,
        averageLatency,
        p95Latency,
        successRate,
        apiCount: apiMetrics.length,
        perApiMetrics,
      };
    } catch (error) {
      console.error(`❌ Failed to get server metrics:`, error);
      return null;
    }
  }
}

export { MetricsService };
