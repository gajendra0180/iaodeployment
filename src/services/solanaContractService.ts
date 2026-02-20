/**
 * Solana Contract Service
 * Handles interactions with IAO program on Solana (Devnet)
 * Reads program state: graduation threshold, tokens distributed, bonding progress
 */

import { Connection, PublicKey } from '@solana/web3.js';

// Solana RPC URLs
const SOLANA_DEVNET_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// IAO Program ID (update after deployment)
const IAO_PROGRAM_ID = process.env.IAO_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

/**
 * Token metrics from Solana program
 */
export interface SolanaTokenMetrics {
  tokenAddress: string;           // Mint address
  serverSlug: string;
  graduationThreshold: string;    // BigInt as string
  totalTokensDistributed: string; // BigInt as string
  totalFeesCollected: string;     // BigInt as string
  bondingProgress: number;        // Percentage (0-100)
  isGraduated: boolean;
  poolAddress: string | null;     // Raydium pool if graduated
  builder: string;
  createdAt: number;
}

/**
 * Factory state from Solana program
 */
export interface SolanaFactoryInfo {
  programId: string;
  admin: string;
  automationWallet: string;
  paymentTokenMint: string;
  paymentTokenPrice: string;
  paymentTokenDecimals: number;
  totalTokensCreated: number;
}

// Anchor discriminator (8 bytes) - skip when decoding
const ANCHOR_DISCRIMINATOR_LENGTH = 8;

/**
 * Buffer reader helper for Borsh deserialization
 */
class BorshReader {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  readU8(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readU64(): bigint {
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readI64(): bigint {
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readBool(): boolean {
    return this.readU8() === 1;
  }

  readPubkey(): Uint8Array {
    const bytes = this.buffer.slice(this.offset, this.offset + 32);
    this.offset += 32;
    return bytes;
  }

  readString(): string {
    const length = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    const str = this.buffer.slice(this.offset, this.offset + length).toString('utf-8');
    this.offset += length;
    return str;
  }
}

class SolanaContractService {
  private connection: Connection;
  private programId: PublicKey;

  constructor(rpcUrl?: string) {
    this.connection = new Connection(rpcUrl || SOLANA_DEVNET_RPC, 'confirmed');
    this.programId = new PublicKey(IAO_PROGRAM_ID);
    console.log(`✅ Solana Contract Service initialized (Program: ${IAO_PROGRAM_ID})`);
  }

  /**
   * Derive Factory State PDA
   */
  getFactoryStatePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('factory')],
      this.programId
    );
  }

  /**
   * Derive Token State PDA for a server slug
   */
  getTokenStatePDA(serverSlug: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('iao-token'), Buffer.from(serverSlug)],
      this.programId
    );
  }

  /**
   * Derive Mint PDA for a server slug
   */
  getMintPDA(serverSlug: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('mint'), Buffer.from(serverSlug)],
      this.programId
    );
  }

  /**
   * Convert Uint8Array to PublicKey base58 string
   */
  private pubkeyToBase58(bytes: Uint8Array): string {
    return new PublicKey(bytes).toBase58();
  }

  /**
   * Get token metrics from Solana program
   */
  async getTokenMetrics(serverSlug: string): Promise<SolanaTokenMetrics | null> {
    try {
      const [tokenStatePda] = this.getTokenStatePDA(serverSlug);
      const accountInfo = await this.connection.getAccountInfo(tokenStatePda);

      if (!accountInfo) {
        console.log(`Token state not found for slug: ${serverSlug}`);
        return null;
      }

      // Skip Anchor discriminator (first 8 bytes)
      const data = Buffer.from(accountInfo.data.slice(ANCHOR_DISCRIMINATOR_LENGTH));
      const reader = new BorshReader(data);

      // Decode IaoTokenState struct (matching Anchor struct layout)
      const decoded = {
        serverSlug: reader.readString(),
        name: reader.readString(),
        symbol: reader.readString(),
        mint: reader.readPubkey(),
        builder: reader.readPubkey(),
        factory: reader.readPubkey(),
        graduationThreshold: reader.readU64(),
        totalTokensDistributed: reader.readU64(),
        totalFeesCollected: reader.readU64(),
        isGraduated: reader.readBool(),
        hasPoolAddress: reader.readBool(),
        poolAddress: reader.readPubkey(),
        createdAt: reader.readI64(),
        updatedAt: reader.readI64(),
        bump: reader.readU8(),
        mintAuthorityBump: reader.readU8(),
      };

      // Calculate bonding progress
      const threshold = decoded.graduationThreshold;
      const distributed = decoded.totalTokensDistributed;
      const bondingProgress = threshold > 0n
        ? Number((distributed * 100n) / threshold)
        : 0;

      return {
        tokenAddress: this.pubkeyToBase58(decoded.mint),
        serverSlug: decoded.serverSlug,
        graduationThreshold: decoded.graduationThreshold.toString(),
        totalTokensDistributed: decoded.totalTokensDistributed.toString(),
        totalFeesCollected: decoded.totalFeesCollected.toString(),
        bondingProgress: Math.min(bondingProgress, 100),
        isGraduated: decoded.isGraduated,
        poolAddress: decoded.hasPoolAddress ? this.pubkeyToBase58(decoded.poolAddress) : null,
        builder: this.pubkeyToBase58(decoded.builder),
        createdAt: Number(decoded.createdAt),
      };
    } catch (error: any) {
      console.error(`❌ Failed to get Solana token metrics for ${serverSlug}:`, error.message);
      return null;
    }
  }

  /**
   * Get token metrics by mint address
   * Note: This requires scanning or knowing the server slug
   */
  async getTokenMetricsByMint(mintAddress: string): Promise<SolanaTokenMetrics | null> {
    // For now, this would require an index or database lookup
    // The mint address alone isn't enough to derive the PDA
    console.warn('getTokenMetricsByMint requires server slug - use getTokenMetrics instead');
    return null;
  }

  /**
   * Get factory info from Solana program
   */
  async getFactoryInfo(): Promise<SolanaFactoryInfo | null> {
    try {
      const [factoryPda] = this.getFactoryStatePDA();
      const accountInfo = await this.connection.getAccountInfo(factoryPda);

      if (!accountInfo) {
        console.log('Factory state not found');
        return null;
      }

      // Skip Anchor discriminator (first 8 bytes)
      const data = Buffer.from(accountInfo.data.slice(ANCHOR_DISCRIMINATOR_LENGTH));
      const reader = new BorshReader(data);

      // Decode FactoryState struct (matching Anchor struct layout)
      const decoded = {
        admin: reader.readPubkey(),
        automationWallet: reader.readPubkey(),
        paymentTokenMint: reader.readPubkey(),
        paymentTokenPrice: reader.readU64(),
        paymentTokenDecimals: reader.readU8(),
        totalTokensCreated: reader.readU64(),
        bump: reader.readU8(),
      };

      return {
        programId: this.programId.toBase58(),
        admin: this.pubkeyToBase58(decoded.admin),
        automationWallet: this.pubkeyToBase58(decoded.automationWallet),
        paymentTokenMint: this.pubkeyToBase58(decoded.paymentTokenMint),
        paymentTokenPrice: decoded.paymentTokenPrice.toString(),
        paymentTokenDecimals: decoded.paymentTokenDecimals,
        totalTokensCreated: Number(decoded.totalTokensCreated),
      };
    } catch (error: any) {
      console.error(`❌ Failed to get Solana factory info:`, error.message);
      return null;
    }
  }

  /**
   * Check if a token exists on Solana
   */
  async tokenExists(serverSlug: string): Promise<boolean> {
    try {
      const [tokenStatePda] = this.getTokenStatePDA(serverSlug);
      const accountInfo = await this.connection.getAccountInfo(tokenStatePda);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * Check if factory is initialized
   */
  async factoryInitialized(): Promise<boolean> {
    try {
      const [factoryPda] = this.getFactoryStatePDA();
      const accountInfo = await this.connection.getAccountInfo(factoryPda);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get mint address for a server slug
   */
  getMintAddress(serverSlug: string): string {
    const [mintPda] = this.getMintPDA(serverSlug);
    return mintPda.toBase58();
  }

  /**
   * Get token state PDA address for a server slug
   */
  getTokenStateAddress(serverSlug: string): string {
    const [tokenStatePda] = this.getTokenStatePDA(serverSlug);
    return tokenStatePda.toBase58();
  }

  /**
   * Calculate token amount from fee (same formula as program)
   * Formula: fee * 10^(18 - paymentTokenDecimals)
   */
  calculateTokenAmount(fee: bigint, paymentTokenDecimals: number): bigint {
    const multiplier = BigInt(10 ** (18 - paymentTokenDecimals));
    return fee * multiplier;
  }

  /**
   * Get connection for external use
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get program ID
   */
  getProgramId(): PublicKey {
    return this.programId;
  }

  /**
   * Validate Solana address format
   */
  static isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
}

export { SolanaContractService };
