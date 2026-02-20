/**
 * Multi-Chain Payment Service
 * Handles payment verification and settlement for both EVM (Base Sepolia) and Solana (Devnet)
 * Uses Thirdweb x402 protocol for both chains
 */

import { facilitator as thirdwebFacilitatorFn, settlePayment } from 'thirdweb/x402';
import { createThirdwebClient } from 'thirdweb';
import { baseSepolia } from 'thirdweb/chains';
import { ChainType, ChainConfigEntry } from './firestoreChainConfigService.js';

/**
 * Payment verification result
 */
export interface PaymentVerificationResult {
  valid: boolean;
  userAddress?: string;
  error?: string;
  chainType?: ChainType;
}

/**
 * Payment execution result
 */
export interface PaymentExecutionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  paymentReceipt?: any;
}

/**
 * Decoded EVM payment authorization (EIP-3009)
 */
interface EVMPaymentAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * Decoded Solana payment authorization
 */
interface SolanaPaymentAuthorization {
  from: string;        // Solana wallet pubkey
  to: string;          // Recipient pubkey
  amount: string;      // Amount in lamports/token units
  validAfter: number;
  validBefore: number;
  memo?: string;
}

class MultiChainPaymentService {
  private thirdwebClient: ReturnType<typeof createThirdwebClient> | null = null;
  private thirdwebFacilitator: any = null;

  constructor() {
    this.initializeThirdweb();
  }

  /**
   * Initialize Thirdweb client and facilitator
   */
  private initializeThirdweb(): void {
    const secretKey = process.env.THIRDWEB_SECRET_KEY;
    const walletAddress = process.env.THIRDWEB_SERVER_WALLET_ADDRESS;

    if (!secretKey || !walletAddress) {
      console.warn('⚠️  Thirdweb credentials not set - payment processing will fail');
      return;
    }

    try {
      this.thirdwebClient = createThirdwebClient({ secretKey });
      this.thirdwebFacilitator = thirdwebFacilitatorFn({
        client: this.thirdwebClient,
        serverWalletAddress: walletAddress,
        waitUntil: "confirmed",
      });
      console.log('✅ Multi-chain payment service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Thirdweb:', error);
    }
  }

  /**
   * Decode payment data from base64
   */
  private decodePaymentData(paymentData: string): any {
    try {
      const decoded = Buffer.from(paymentData, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch (error) {
      throw new Error('Failed to decode payment data');
    }
  }

  /**
   * Verify EVM payment authorization (EIP-3009)
   */
  verifyEVMPayment(
    paymentData: string,
    expectedPayTo: string,
    expectedAmount: string
  ): PaymentVerificationResult {
    try {
      const paymentProof = this.decodePaymentData(paymentData);
      const authorization = paymentProof?.payload?.authorization as EVMPaymentAuthorization;
      const signature = paymentProof?.payload?.signature;

      if (!authorization || !signature) {
        return { valid: false, error: 'Missing authorization or signature', chainType: 'evm' };
      }

      // Verify recipient matches
      if (authorization.to.toLowerCase() !== expectedPayTo.toLowerCase()) {
        return {
          valid: false,
          error: `Payment recipient mismatch: expected ${expectedPayTo}, got ${authorization.to}`,
          chainType: 'evm',
        };
      }

      // Verify amount matches
      if (authorization.value !== expectedAmount) {
        return {
          valid: false,
          error: `Payment amount mismatch: expected ${expectedAmount}, got ${authorization.value}`,
          chainType: 'evm',
        };
      }

      // Verify timing validity
      const now = Math.floor(Date.now() / 1000);
      const validAfter = parseInt(authorization.validAfter);
      const validBefore = parseInt(authorization.validBefore);

      if (now < validAfter) {
        return { valid: false, error: 'Payment authorization not yet valid', chainType: 'evm' };
      }

      if (now > validBefore) {
        return { valid: false, error: 'Payment authorization expired', chainType: 'evm' };
      }

      return {
        valid: true,
        userAddress: authorization.from.toLowerCase(),
        chainType: 'evm',
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || 'Failed to verify EVM payment authorization',
        chainType: 'evm',
      };
    }
  }

  /**
   * Verify Solana payment authorization
   * Solana uses Ed25519 signatures with a different structure
   */
  verifySolanaPayment(
    paymentData: string,
    expectedPayTo: string,
    expectedAmount: string
  ): PaymentVerificationResult {
    try {
      const paymentProof = this.decodePaymentData(paymentData);

      // Solana x402 payment structure
      // Thirdweb uses similar structure but with Solana-specific fields
      const authorization = paymentProof?.payload?.authorization as SolanaPaymentAuthorization;
      const signature = paymentProof?.payload?.signature;

      if (!authorization || !signature) {
        return { valid: false, error: 'Missing authorization or signature', chainType: 'solana' };
      }

      // Verify recipient matches (Solana addresses are base58)
      if (authorization.to !== expectedPayTo) {
        return {
          valid: false,
          error: `Payment recipient mismatch: expected ${expectedPayTo}, got ${authorization.to}`,
          chainType: 'solana',
        };
      }

      // Verify amount matches
      if (authorization.amount !== expectedAmount) {
        return {
          valid: false,
          error: `Payment amount mismatch: expected ${expectedAmount}, got ${authorization.amount}`,
          chainType: 'solana',
        };
      }

      // Verify timing validity
      const now = Math.floor(Date.now() / 1000);

      if (authorization.validAfter && now < authorization.validAfter) {
        return { valid: false, error: 'Payment authorization not yet valid', chainType: 'solana' };
      }

      if (authorization.validBefore && now > authorization.validBefore) {
        return { valid: false, error: 'Payment authorization expired', chainType: 'solana' };
      }

      return {
        valid: true,
        userAddress: authorization.from, // Solana address (base58)
        chainType: 'solana',
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || 'Failed to verify Solana payment authorization',
        chainType: 'solana',
      };
    }
  }

  /**
   * Verify payment authorization based on chain type
   */
  verifyPaymentAuthorization(
    paymentData: string,
    expectedPayTo: string,
    expectedAmount: string,
    chainType: ChainType
  ): PaymentVerificationResult {
    if (chainType === 'evm') {
      return this.verifyEVMPayment(paymentData, expectedPayTo, expectedAmount);
    } else if (chainType === 'solana') {
      return this.verifySolanaPayment(paymentData, expectedPayTo, expectedAmount);
    }

    return { valid: false, error: `Unsupported chain type: ${chainType}` };
  }

  /**
   * Execute EVM payment transfer using Thirdweb
   */
  async executeEVMPayment(
    paymentData: string,
    req: any,
    tokenAddress: string,
    fee: string,
    serverSlug: string,
    apiSlug: string,
    apiName: string
  ): Promise<PaymentExecutionResult> {
    try {
      if (!this.thirdwebFacilitator || !this.thirdwebClient) {
        return { success: false, error: 'Thirdweb facilitator not initialized' };
      }

      // Normalize HTTP method
      let normalizedMethod = req.method.toUpperCase();
      if (normalizedMethod === 'HEAD') normalizedMethod = 'GET';
      const supportedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      if (!supportedMethods.includes(normalizedMethod)) normalizedMethod = 'GET';

      // Calculate price string
      const feeWei = BigInt(fee);
      const feeUSD = Number(feeWei) / 1e6;
      const priceString = `$${feeUSD.toFixed(2)}`;

      console.log('💳 [EVM] Calling settlePayment:', {
        resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: normalizedMethod,
        payTo: tokenAddress,
        price: priceString,
        timestamp: new Date().toISOString(),
      });

      const paymentResult = await settlePayment({
        resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: normalizedMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        paymentData,
        payTo: tokenAddress,
        network: baseSepolia,
        price: priceString,
        facilitator: this.thirdwebFacilitator,
        routeConfig: {
          description: `IAO Proxy - ${serverSlug}/${apiSlug} - ${apiName}`,
          mimeType: 'application/json',
          maxTimeoutSeconds: 300,
        },
      });

      if (paymentResult.status === 200) {
        console.log('✅ [EVM] Payment settled successfully!');
        return {
          success: true,
          txHash: paymentResult.paymentReceipt?.transaction,
          paymentReceipt: paymentResult.paymentReceipt,
        };
      } else {
        const errorBody = (paymentResult as any).responseBody;
        console.error('❌ [EVM] Payment settlement failed:', errorBody);
        return {
          success: false,
          error: errorBody?.errorMessage || 'Payment settlement returned non-200 status',
        };
      }
    } catch (error: any) {
      console.error('❌ [EVM] executePaymentTransfer error:', error);
      return { success: false, error: error.message || 'Failed to execute EVM payment' };
    }
  }

  /**
   * Execute Solana payment transfer using Thirdweb
   */
  async executeSolanaPayment(
    paymentData: string,
    req: any,
    tokenAddress: string,
    fee: string,
    serverSlug: string,
    apiSlug: string,
    apiName: string,
    chainConfig: ChainConfigEntry
  ): Promise<PaymentExecutionResult> {
    try {
      if (!this.thirdwebFacilitator || !this.thirdwebClient) {
        return { success: false, error: 'Thirdweb facilitator not initialized' };
      }

      // Normalize HTTP method
      let normalizedMethod = req.method.toUpperCase();
      if (normalizedMethod === 'HEAD') normalizedMethod = 'GET';
      const supportedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      if (!supportedMethods.includes(normalizedMethod)) normalizedMethod = 'GET';

      // Calculate price string
      const feeAmount = BigInt(fee);
      const feeUSD = Number(feeAmount) / 1e6;
      const priceString = `$${feeUSD.toFixed(2)}`;

      console.log('💳 [Solana] Calling settlePayment:', {
        resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: normalizedMethod,
        payTo: tokenAddress,
        price: priceString,
        network: 'solana-devnet',
        timestamp: new Date().toISOString(),
      });

      // Thirdweb x402 supports Solana networks
      // Define Solana Devnet chain configuration
      // Note: If thirdweb adds native Solana support, update this
      const solanaDevnetChain = {
        id: 'solana-devnet',
        name: 'Solana Devnet',
        rpc: chainConfig.rpcUrl,
      } as any;

      const paymentResult = await settlePayment({
        resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: normalizedMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        paymentData,
        payTo: tokenAddress, // Solana token account or program
        network: solanaDevnetChain,
        price: priceString,
        facilitator: this.thirdwebFacilitator,
        routeConfig: {
          description: `IAO Proxy - ${serverSlug}/${apiSlug} - ${apiName}`,
          mimeType: 'application/json',
          maxTimeoutSeconds: 300,
        },
      });

      if (paymentResult.status === 200) {
        console.log('✅ [Solana] Payment settled successfully!');
        return {
          success: true,
          txHash: paymentResult.paymentReceipt?.transaction,
          paymentReceipt: paymentResult.paymentReceipt,
        };
      } else {
        const errorBody = (paymentResult as any).responseBody;
        console.error('❌ [Solana] Payment settlement failed:', errorBody);
        return {
          success: false,
          error: errorBody?.errorMessage || 'Payment settlement returned non-200 status',
        };
      }
    } catch (error: any) {
      console.error('❌ [Solana] executePaymentTransfer error:', error);
      return { success: false, error: error.message || 'Failed to execute Solana payment' };
    }
  }

  /**
   * Execute payment based on chain type
   */
  async executePaymentTransfer(
    paymentData: string,
    req: any,
    tokenAddress: string,
    fee: string,
    serverSlug: string,
    apiSlug: string,
    apiName: string,
    chainType: ChainType,
    chainConfig?: ChainConfigEntry
  ): Promise<PaymentExecutionResult> {
    if (chainType === 'evm') {
      return this.executeEVMPayment(
        paymentData,
        req,
        tokenAddress,
        fee,
        serverSlug,
        apiSlug,
        apiName
      );
    } else if (chainType === 'solana') {
      if (!chainConfig) {
        return { success: false, error: 'Chain config required for Solana payments' };
      }
      return this.executeSolanaPayment(
        paymentData,
        req,
        tokenAddress,
        fee,
        serverSlug,
        apiSlug,
        apiName,
        chainConfig
      );
    }

    return { success: false, error: `Unsupported chain type: ${chainType}` };
  }

  /**
   * Extract user address from payment data
   */
  extractUserAddress(paymentData: string, chainType: ChainType): string | null {
    try {
      const paymentProof = this.decodePaymentData(paymentData);
      const authorization = paymentProof?.payload?.authorization;

      if (!authorization?.from) {
        return null;
      }

      // For EVM, lowercase the address
      if (chainType === 'evm') {
        return authorization.from.toLowerCase();
      }

      // For Solana, return as-is (base58)
      return authorization.from;
    } catch {
      return null;
    }
  }

  /**
   * Check if service is properly initialized
   */
  isInitialized(): boolean {
    return this.thirdwebClient !== null && this.thirdwebFacilitator !== null;
  }
}

export { MultiChainPaymentService };
