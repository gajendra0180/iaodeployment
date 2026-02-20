/**
 * EVM Contract Service
 * Handles interactions with IAO contracts on EVM chains (Base Sepolia)
 * Reads contract state: graduation threshold, tokens distributed, bonding progress
 */

import { createThirdwebClient, getContract, readContract } from 'thirdweb';
import { baseSepolia } from 'thirdweb/chains';
import fs from 'fs';
import path from 'path';

// Load IAOToken ABI
let IAOTokenABI: any[] = [];
try {
  const abiPath = path.join(process.cwd(), 'abis/IAOToken.json');
  IAOTokenABI = JSON.parse(fs.readFileSync(abiPath, 'utf-8'));
} catch (error) {
  console.error('❌ Failed to load IAOToken ABI for evmContractService:', error);
}

// Load IAOTokenFactory ABI
let IAOTokenFactoryABI: any[] = [];
try {
  const factoryAbiPath = path.join(process.cwd(), 'abis/IAOTokenFactory.json');
  IAOTokenFactoryABI = JSON.parse(fs.readFileSync(factoryAbiPath, 'utf-8'));
} catch (error) {
  console.error('❌ Failed to load IAOTokenFactory ABI for evmContractService:', error);
}

/**
 * Token metrics from on-chain contract
 */
export interface EVMTokenMetrics {
  tokenAddress: string;
  graduationThreshold: string;      // BigInt as string
  totalTokensDistributed: string;   // BigInt as string
  totalFeesCollected: string;       // BigInt as string
  bondingProgress: number;          // Percentage (0-100)
  isGraduated: boolean;
  paymentTokenPrice: string;        // BigInt as string
  paymentTokenDecimals: number;
}

/**
 * Factory info from on-chain contract
 */
export interface EVMFactoryInfo {
  factoryAddress: string;
  paymentToken: string;
  paymentTokenPrice: string;
  paymentTokenDecimals: number;
}

class EVMContractService {
  private client: ReturnType<typeof createThirdwebClient> | null = null;
  private factoryAddress: string;

  constructor(factoryAddress: string) {
    this.factoryAddress = factoryAddress;
    this.initializeClient();
  }

  /**
   * Initialize Thirdweb client
   */
  private initializeClient(): void {
    const secretKey = process.env.THIRDWEB_SECRET_KEY;
    if (!secretKey) {
      console.warn('⚠️  THIRDWEB_SECRET_KEY not set - EVM contract reads will fail');
      return;
    }

    try {
      this.client = createThirdwebClient({ secretKey });
      console.log('✅ EVM Contract Service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Thirdweb client:', error);
    }
  }

  /**
   * Get token metrics from on-chain contract
   */
  async getTokenMetrics(tokenAddress: string): Promise<EVMTokenMetrics | null> {
    if (!this.client) {
      console.error('❌ Thirdweb client not initialized');
      return null;
    }

    try {
      const contract = getContract({
        client: this.client,
        chain: baseSepolia,
        address: tokenAddress,
        abi: IAOTokenABI,
      });

      // Read multiple contract values in parallel
      const [
        graduationThreshold,
        totalTokensDistributed,
        totalFeesCollected,
        paymentTokenPrice,
        paymentTokenDecimals,
      ] = await Promise.all([
        readContract({
          contract,
          method: 'function graduationThreshold() view returns (uint256)',
          params: [],
        }),
        readContract({
          contract,
          method: 'function totalTokensDistributed() view returns (uint256)',
          params: [],
        }),
        readContract({
          contract,
          method: 'function totalFeesCollected() view returns (uint256)',
          params: [],
        }),
        readContract({
          contract,
          method: 'function paymentTokenPrice() view returns (uint256)',
          params: [],
        }),
        readContract({
          contract,
          method: 'function paymentTokenDecimals() view returns (uint8)',
          params: [],
        }),
      ]);

      // Calculate bonding progress
      const threshold = BigInt(graduationThreshold.toString());
      const distributed = BigInt(totalTokensDistributed.toString());
      const bondingProgress = threshold > 0n
        ? Number((distributed * 100n) / threshold)
        : 0;

      const isGraduated = distributed >= threshold;

      return {
        tokenAddress: tokenAddress.toLowerCase(),
        graduationThreshold: graduationThreshold.toString(),
        totalTokensDistributed: totalTokensDistributed.toString(),
        totalFeesCollected: totalFeesCollected.toString(),
        bondingProgress: Math.min(bondingProgress, 100),
        isGraduated,
        paymentTokenPrice: paymentTokenPrice.toString(),
        paymentTokenDecimals: Number(paymentTokenDecimals),
      };
    } catch (error: any) {
      console.error(`❌ Failed to get EVM token metrics for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Get factory info from on-chain contract
   */
  async getFactoryInfo(): Promise<EVMFactoryInfo | null> {
    if (!this.client) {
      console.error('❌ Thirdweb client not initialized');
      return null;
    }

    try {
      const contract = getContract({
        client: this.client,
        chain: baseSepolia,
        address: this.factoryAddress,
        abi: IAOTokenFactoryABI,
      });

      // Read payment token info
      const paymentTokenInfo = await readContract({
        contract,
        method: 'function paymentTokenInfo() view returns (address token, uint256 price, uint8 decimals)',
        params: [],
      });

      return {
        factoryAddress: this.factoryAddress,
        paymentToken: paymentTokenInfo[0] as string,
        paymentTokenPrice: paymentTokenInfo[1].toString(),
        paymentTokenDecimals: Number(paymentTokenInfo[2]),
      };
    } catch (error: any) {
      console.error(`❌ Failed to get EVM factory info:`, error.message);
      return null;
    }
  }

  /**
   * Check if a token exists on-chain
   */
  async tokenExists(tokenAddress: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      const contract = getContract({
        client: this.client,
        chain: baseSepolia,
        address: tokenAddress,
        abi: IAOTokenABI,
      });

      // Try to read symbol - if it exists, token is valid
      await readContract({
        contract,
        method: 'function symbol() view returns (string)',
        params: [],
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get token symbol from contract
   */
  async getTokenSymbol(tokenAddress: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    try {
      const contract = getContract({
        client: this.client,
        chain: baseSepolia,
        address: tokenAddress,
        abi: IAOTokenABI,
      });

      const symbol = await readContract({
        contract,
        method: 'function symbol() view returns (string)',
        params: [],
      });

      return symbol as string;
    } catch {
      return null;
    }
  }

  /**
   * Get token name from contract
   */
  async getTokenName(tokenAddress: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    try {
      const contract = getContract({
        client: this.client,
        chain: baseSepolia,
        address: tokenAddress,
        abi: IAOTokenABI,
      });

      const name = await readContract({
        contract,
        method: 'function name() view returns (string)',
        params: [],
      });

      return name as string;
    } catch {
      return null;
    }
  }

  /**
   * Calculate token amount from fee (same formula as contract)
   * Formula: (fee * paymentTokenPrice) / (10^paymentTokenDecimals)
   */
  calculateTokenAmount(fee: bigint, paymentTokenPrice: bigint, paymentTokenDecimals: number): bigint {
    const divisor = BigInt(10 ** paymentTokenDecimals);
    return (fee * paymentTokenPrice) / divisor;
  }
}

export { EVMContractService };
