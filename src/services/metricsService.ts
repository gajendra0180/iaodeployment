/**
 * Metrics Service
 * Tracks and aggregates API usage metrics, revenue, and performance data
 */

import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

let dynamoDBClient: DynamoDBClient | null = null;
let dynamoDBDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDBClient(region: string): DynamoDBClient {
  if (!dynamoDBClient) {
    dynamoDBClient = new DynamoDBClient({
      region
      // endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    });
  }
  return dynamoDBClient;
}

function getDynamoDBDocClient(region: string): DynamoDBDocumentClient {
  if (!dynamoDBDocClient) {
    dynamoDBDocClient = DynamoDBDocumentClient.from(getDynamoDBClient(region));
  }
  return dynamoDBDocClient;
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
  private ddbDocClient: DynamoDBDocumentClient;
  private metricsTableName: string;
  private region: string;

  constructor(region: string, metricsTableName: string) {
    this.region = region;
    this.ddbDocClient = getDynamoDBDocClient(region);
    this.metricsTableName = metricsTableName;
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

      // Try to get existing metrics
      const existing = await this.ddbDocClient.send(new GetCommand({
        TableName: this.metricsTableName,
        Key: { id },
      }));

      // Create new call record
      const newCallRecord: CallRecord = {
        timestamp: now,
        success,
        latencyMs: Math.round(latencyMs),
        revenue: fee,
      };

      if (existing.Item) {
        // Update existing metrics
        const current = existing.Item as ApiMetricsEntry;
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
        // Keep only last 100 calls
        const updatedRecentCalls = recentCalls.slice(-100);

        await this.ddbDocClient.send(new UpdateCommand({
          TableName: this.metricsTableName,
          Key: { id },
          UpdateExpression: `
            SET callCount = :callCount,
                totalRevenue = :totalRevenue,
                successCount = :successCount,
                failureCount = :failureCount,
                totalLatency = :totalLatency,
                averageLatency = :averageLatency,
                recentCalls = :recentCalls,
                lastCallAt = :lastCallAt,
                updatedAt = :updatedAt
          `,
          ExpressionAttributeValues: {
            ":callCount": newCallCount,
            ":totalRevenue": newTotalRevenue,
            ":successCount": newSuccessCount,
            ":failureCount": newFailureCount,
            ":totalLatency": newTotalLatency,
            ":averageLatency": newAverageLatency,
            ":recentCalls": updatedRecentCalls,
            ":lastCallAt": now,
            ":updatedAt": now,
          },
        }));
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
          recentCalls: [newCallRecord], // Start with first call
          lastCallAt: now,
          createdAt: now,
          updatedAt: now,
        };

        await this.ddbDocClient.send(new PutCommand({
          TableName: this.metricsTableName,
          Item: newMetrics,
        }));
      }
    } catch (error) {
      console.error(`❌ Failed to record API call metrics:`, error);
      // Don't throw - metrics are non-critical
    }
  }

  /**
   * Get metrics for a specific API
   * Returns the raw metrics entry with success/failure counts
   */
  async getApiMetrics(tokenAddress: string, apiSlug: string): Promise<ApiMetricsEntry | null> {
    try {
      const id = `${tokenAddress.toLowerCase()}#${apiSlug.toLowerCase()}`;
      const result = await this.ddbDocClient.send(new GetCommand({
        TableName: this.metricsTableName,
        Key: { id },
      }));

      return result.Item as ApiMetricsEntry | null;
    } catch (error) {
      console.error(`❌ Failed to get API metrics:`, error);
      return null;
    }
  }

  /**
   * Calculate percentile from sorted array
   * @param sortedValues - Array of numbers sorted in ascending order
   * @param percentile - Percentile value (0-100), e.g., 95 for p95
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];
    
    // Calculate index for percentile
    // For p95: 95% of values should be below this value
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    const clampedIndex = Math.max(0, Math.min(index, sortedValues.length - 1));
    
    return sortedValues[clampedIndex];
  }

  /**
   * Calculate metrics from last 100 calls
   * Returns metrics calculated only from recent calls (rolling window)
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

    // Use only last 100 calls
    const calls = recentCalls.slice(-100);
    
    let totalRevenue = BigInt(0);
    let successCount = 0;
    let failureCount = 0;
    let totalLatency = 0;
    const latencies: number[] = []; // For percentile calculation

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
    
    // Calculate p95 latency
    const sortedLatencies = latencies.sort((a, b) => a - b); // Sort ascending
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
   * Calculate success rate from metrics entry (using last 100 calls)
   * Formula: (successCount / (successCount + failureCount)) * 100
   */
  calculateSuccessRate(metrics: ApiMetricsEntry | null): number {
    if (!metrics) return 0;
    
    // Use recent calls if available (last 100), otherwise fall back to aggregated counts
    if (metrics.recentCalls && metrics.recentCalls.length > 0) {
      const recentMetrics = this.calculateRecentMetrics(metrics.recentCalls);
      return recentMetrics.successRate;
    }
    
    // Fallback to aggregated counts if no recent calls
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
      // Query all metrics for this token using GSI
      const result = await this.ddbDocClient.send(new QueryCommand({
        TableName: this.metricsTableName,
        IndexName: "tokenAddress-index", // Use GSI for querying by tokenAddress
        KeyConditionExpression: "tokenAddress = :tokenAddress",
        ExpressionAttributeValues: {
          ":tokenAddress": tokenAddress.toLowerCase(),
        },
      }));

      if (!result.Items || result.Items.length === 0) {
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

      const apiMetrics = result.Items as ApiMetricsEntry[];
      
      // Aggregate metrics
      let totalCalls = BigInt(0);
      let totalRevenue = BigInt(0);
      let totalLatency = BigInt(0);
      let totalSuccess = BigInt(0);
      let totalFailure = BigInt(0);
      const allLatencies: number[] = []; // Collect all latencies for server-level p95

      // Calculate metrics from last 100 calls per API
      const perApiMetrics = apiMetrics.map(metric => {
        // Use recent calls (last 100) if available, otherwise use aggregated counts
        let recentMetrics;
        if (metric.recentCalls && metric.recentCalls.length > 0) {
          recentMetrics = this.calculateRecentMetrics(metric.recentCalls);
          // Collect latencies for server-level p95 calculation
          metric.recentCalls.slice(-100).forEach(call => {
            allLatencies.push(call.latencyMs);
          });
        } else {
          // Fallback to aggregated counts
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
            p95Latency: Number(metric.averageLatency), // Use average as fallback when no recent calls
            successRate: totalAttempts > 0 
              ? (Number(success) / Number(totalAttempts)) * 100 
              : 0,
          };
        }

        // Aggregate for server-level totals (using recent metrics)
        totalCalls += BigInt(recentMetrics.callCount);
        totalRevenue += BigInt(recentMetrics.totalRevenue);
        totalLatency += BigInt(Math.round(recentMetrics.averageLatency * recentMetrics.callCount));
        totalSuccess += BigInt(recentMetrics.successCount);
        totalFailure += BigInt(recentMetrics.failureCount);

        return {
          apiSlug: metric.apiSlug,
          callCount: recentMetrics.callCount.toString(),
          revenue: recentMetrics.totalRevenue,
          revenueUSD: Number(BigInt(recentMetrics.totalRevenue)) / 1e6, // Assuming 6 decimals for USDC
          averageLatency: recentMetrics.averageLatency,
          p95Latency: recentMetrics.p95Latency,
          successRate: recentMetrics.successRate,
        };
      });

      // Calculate server-level metrics from aggregated recent metrics
      const totalCallsNum = Number(totalCalls);
      const averageLatency = totalCallsNum > 0 
        ? Number(totalLatency) / totalCallsNum 
        : 0;
      
      // Calculate server-level p95 latency from all API latencies
      const sortedAllLatencies = allLatencies.sort((a, b) => a - b);
      const p95Latency = this.calculatePercentile(sortedAllLatencies, 95);
      
      const successRate = (totalSuccess + totalFailure) > 0n
        ? (Number(totalSuccess) / Number(totalSuccess + totalFailure)) * 100
        : 0;

      return {
        totalCalls: totalCalls.toString(),
        totalRevenue: totalRevenue.toString(),
        totalRevenueUSD: Number(totalRevenue) / 1e6, // Assuming 6 decimals for USDC
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

