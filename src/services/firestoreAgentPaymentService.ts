/**
 * Firestore Agent Payment Service (replaces DynamoDB Agent Payment Service)
 * Handles payment tracking for agent API calls
 */

import { getFirestoreClient, Collections } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';

// Firestore client singleton
let firestoreClient: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestoreClient) {
    firestoreClient = getFirestoreClient();
  }
  return firestoreClient;
}

export interface PaymentRecord {
  id: string;
  agentId: string;
  sessionId: string;
  serverSlug: string;
  apiSlug: string;
  fee: string; // Amount paid in wei
  paymentToken: string; // USDC address
  txHash?: string; // On-chain transaction hash
  paidBy: 'company'; // For now, only company pays
  timestamp: string;
}

export class AgentPaymentService {
  private collectionName: string;
  private companyWalletAddress: string;

  constructor(
    _region: string,
    _tableName: string,
    companyWalletAddress?: string
  ) {
    this.collectionName = Collections.AGENT_PAYMENTS;
    this.companyWalletAddress = companyWalletAddress || process.env.THIRDWEB_SERVER_WALLET_ADDRESS || '';

    if (!this.companyWalletAddress) {
      console.warn('⚠️  Company wallet not configured. Set THIRDWEB_SERVER_WALLET_ADDRESS in .env');
    }
  }

  /**
   * Record a payment for an API call
   */
  async recordPayment(
    agentId: string,
    sessionId: string,
    serverSlug: string,
    apiSlug: string,
    fee: string,
    paymentToken: string,
    txHash?: string
  ): Promise<PaymentRecord> {
    const now = new Date().toISOString();

    const payment: PaymentRecord = {
      id: uuidv4(),
      agentId,
      sessionId,
      serverSlug,
      apiSlug,
      fee,
      paymentToken,
      txHash,
      paidBy: 'company',
      timestamp: now
    };

    try {
      await getFirestore()
        .collection(this.collectionName)
        .doc(payment.id)
        .set(payment);

      console.log(
        `💳 Payment recorded: ${serverSlug}/${apiSlug} - ${fee} wei (${agentId})`
      );

      return payment;
    } catch (error) {
      console.error(`❌ Failed to record payment:`, error);
      throw error;
    }
  }

  /**
   * Get total spending for an agent
   */
  async getAgentSpending(agentId: string): Promise<{
    totalSpent: string;
    paymentCount: number;
    apiCalls: Array<{ serverSlug: string; apiSlug: string; count: number; total: string }>;
  }> {
    try {
      const snapshot = await getFirestore()
        .collection(this.collectionName)
        .where('agentId', '==', agentId)
        .get();

      if (snapshot.empty) {
        return {
          totalSpent: '0',
          paymentCount: 0,
          apiCalls: []
        };
      }

      const payments = snapshot.docs.map(doc => doc.data() as PaymentRecord);
      let totalSpent = BigInt(0);
      const apiCallsMap = new Map<string, { serverSlug: string; apiSlug: string; count: number; total: bigint }>();

      for (const payment of payments) {
        totalSpent += BigInt(payment.fee);
        const key = `${payment.serverSlug}/${payment.apiSlug}`;
        const existing = apiCallsMap.get(key);
        if (existing) {
          existing.count++;
          existing.total += BigInt(payment.fee);
        } else {
          apiCallsMap.set(key, {
            serverSlug: payment.serverSlug,
            apiSlug: payment.apiSlug,
            count: 1,
            total: BigInt(payment.fee)
          });
        }
      }

      return {
        totalSpent: totalSpent.toString(),
        paymentCount: payments.length,
        apiCalls: Array.from(apiCallsMap.values()).map(item => ({
          serverSlug: item.serverSlug,
          apiSlug: item.apiSlug,
          count: item.count,
          total: item.total.toString()
        }))
      };
    } catch (error) {
      console.error('Error getting agent spending:', error);
      throw error;
    }
  }

  /**
   * Get total spending for a session
   */
  async getSessionSpending(sessionId: string): Promise<{
    totalSpent: string;
    paymentCount: number;
  }> {
    try {
      const snapshot = await getFirestore()
        .collection(this.collectionName)
        .where('sessionId', '==', sessionId)
        .get();

      if (snapshot.empty) {
        return {
          totalSpent: '0',
          paymentCount: 0
        };
      }

      const payments = snapshot.docs.map(doc => doc.data() as PaymentRecord);
      let totalSpent = BigInt(0);

      for (const payment of payments) {
        totalSpent += BigInt(payment.fee);
      }

      return {
        totalSpent: totalSpent.toString(),
        paymentCount: payments.length
      };
    } catch (error) {
      console.error('Error getting session spending:', error);
      throw error;
    }
  }

  /**
   * Check if payment should be executed
   */
  canExecutePayment(): boolean {
    return !!this.companyWalletAddress && this.companyWalletAddress !== '';
  }

  /**
   * Get company wallet address
   */
  getCompanyWallet(): string {
    return this.companyWalletAddress;
  }

  /**
   * Check spending limit for safety
   */
  async checkSpendingLimit(
    agentId: string,
    upcomingFee: string,
    dailyLimitWei: string = '1000000000000000000'
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const spending = await this.getAgentSpending(agentId);
      const total = BigInt(spending.totalSpent) + BigInt(upcomingFee);

      if (total > BigInt(dailyLimitWei)) {
        return {
          allowed: false,
          reason: `Spending limit exceeded. Current: ${spending.totalSpent}, Upcoming: ${upcomingFee}, Limit: ${dailyLimitWei}`
        };
      }

      return { allowed: true };
    } catch (error) {
      console.error('Error checking spending limit:', error);
      return { allowed: false, reason: 'Error checking spending limit' };
    }
  }

  /**
   * Format fee for display
   */
  static formatFeeForDisplay(feeWei: string, decimals: number = 6): string {
    try {
      const feeNum = BigInt(feeWei);
      const divisor = BigInt(10 ** decimals);
      const wholePart = feeNum / divisor;
      const fractionalPart = feeNum % divisor;

      if (fractionalPart === BigInt(0)) {
        return `$${wholePart.toString()}`;
      }

      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      return `$${wholePart}.${fractionalStr.substring(0, 2)}`;
    } catch {
      return `${feeWei} wei`;
    }
  }

  /**
   * Calculate total cost for multiple API calls
   */
  static calculateTotalFee(fees: string[]): string {
    try {
      const total = fees.reduce((sum, fee) => BigInt(sum) + BigInt(fee), BigInt(0));
      return total.toString();
    } catch {
      return '0';
    }
  }
}
