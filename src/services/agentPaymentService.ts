/**
 * Agent Payment Service
 * Handles:
 * - Company wallet payments for agent API calls
 * - x402 V2 payment authorization
 * - Payment tracking in DynamoDB
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid'

export interface PaymentRecord {
  id: string
  agentId: string
  sessionId: string
  serverSlug: string
  apiSlug: string
  fee: string // Amount paid in wei
  paymentToken: string // USDC address
  txHash?: string // On-chain transaction hash
  paidBy: 'company' // For now, only company pays
  timestamp: string
}

export class AgentPaymentService {
  private docClient: DynamoDBDocumentClient
  private tableName: string
  private companyWalletAddress: string

  constructor(
    region: string,
    tableName: string,
    companyWalletAddress?: string
  ) {
    const config: any = { region }

    // Use local DynamoDB endpoint if configured (for development/testing)
    // if (process.env.DYNAMODB_ENDPOINT) {
    //   config.endpoint = process.env.DYNAMODB_ENDPOINT
    // }

    const client = new DynamoDBClient(config)
    this.docClient = DynamoDBDocumentClient.from(client)
    this.tableName = tableName
    this.companyWalletAddress = companyWalletAddress || process.env.THIRDWEB_SERVER_WALLET_ADDRESS || ''

    if (!this.companyWalletAddress) {
      console.warn('⚠️  Company wallet not configured. Set THIRDWEB_SERVER_WALLET_ADDRESS in .env')
    }
  }

  /**
   * Record a payment for an API call
   * In Phase 3, we're just tracking. Phase 4 will implement actual x402 payment execution.
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
    const now = new Date().toISOString()

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
    }

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: payment
        })
      )

      console.log(
        `💳 Payment recorded: ${serverSlug}/${apiSlug} - ${fee} wei (${agentId})`
      )

      return payment
    } catch (error) {
      console.error(`❌ Failed to record payment:`, error)
      throw error
    }
  }

  /**
   * Get total spending for an agent
   */
  async getAgentSpending(agentId: string): Promise<{
    totalSpent: string
    paymentCount: number
    apiCalls: Array<{ serverSlug: string; apiSlug: string; count: number; total: string }>
  }> {
    try {
      // TODO: Implement DynamoDB query for agentId GSI
      // For now, return placeholder
      return {
        totalSpent: '0',
        paymentCount: 0,
        apiCalls: []
      }
    } catch (error) {
      console.error('Error getting agent spending:', error)
      throw error
    }
  }

  /**
   * Get total spending for a session
   */
  async getSessionSpending(sessionId: string): Promise<{
    totalSpent: string
    paymentCount: number
  }> {
    try {
      // TODO: Implement DynamoDB query for sessionId GSI
      // For now, return placeholder
      return {
        totalSpent: '0',
        paymentCount: 0
      }
    } catch (error) {
      console.error('Error getting session spending:', error)
      throw error
    }
  }

  /**
   * Check if payment should be executed (has company wallet and proper config)
   */
  canExecutePayment(): boolean {
    return !!this.companyWalletAddress && this.companyWalletAddress !== ''
  }

  /**
   * Get company wallet address
   */
  getCompanyWallet(): string {
    return this.companyWalletAddress
  }

  /**
   * Set spending limit for an agent (for safety)
   * This prevents runaway API calls
   */
  async checkSpendingLimit(
    agentId: string,
    upcomingFee: string,
    dailyLimitWei: string = '1000000000000000000' // 1 token default
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const spending = await this.getAgentSpending(agentId)
      const total = BigInt(spending.totalSpent) + BigInt(upcomingFee)

      if (total > BigInt(dailyLimitWei)) {
        return {
          allowed: false,
          reason: `Spending limit exceeded. Current: ${spending.totalSpent}, Upcoming: ${upcomingFee}, Limit: ${dailyLimitWei}`
        }
      }

      return { allowed: true }
    } catch (error) {
      console.error('Error checking spending limit:', error)
      return { allowed: false, reason: 'Error checking spending limit' }
    }
  }

  /**
   * Format fee for display (convert from wei to human-readable)
   * Assumes 6 decimal places (USDC standard)
   */
  static formatFeeForDisplay(feeWei: string, decimals: number = 6): string {
    try {
      const feeNum = BigInt(feeWei)
      const divisor = BigInt(10 ** decimals)
      const wholePart = feeNum / divisor
      const fractionalPart = feeNum % divisor

      if (fractionalPart === BigInt(0)) {
        return `$${wholePart.toString()}`
      }

      const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
      return `$${wholePart}.${fractionalStr.substring(0, 2)}`
    } catch {
      return `${feeWei} wei`
    }
  }

  /**
   * Calculate total cost for multiple API calls
   */
  static calculateTotalFee(fees: string[]): string {
    try {
      const total = fees.reduce((sum, fee) => BigInt(sum) + BigInt(fee), BigInt(0))
      return total.toString()
    } catch {
      return '0'
    }
  }
}
