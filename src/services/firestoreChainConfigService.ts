/**
 * Firestore Chain Config Service (replaces DynamoDB Chain Config Service)
 * Manages blockchain network configurations for multi-chain support
 */

import { getFirestoreClient, Collections } from '../db/firestoreClient.js';
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
 * Supported chain types
 */
export type ChainType = "evm" | "solana";

/**
 * Chain configuration entry
 */
export interface ChainConfigEntry {
  chainId: string;
  chainType: ChainType;
  name: string;
  shortName: string;
  factoryAddress: string;
  paymentTokenAddress: string;
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
  rpcUrl: string;
  explorerUrl: string;
  explorerTxPath: string;
  explorerAddressPath: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Default chain configurations for seeding
 */
export const DEFAULT_CHAIN_CONFIGS: ChainConfigEntry[] = [
  {
    chainId: "84532",
    chainType: "evm",
    name: "Base Sepolia",
    shortName: "Base",
    factoryAddress: "0xF110bA6BBc7cD595842B6b56ab870faC811e41B5",
    paymentTokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    paymentTokenSymbol: "USDC",
    paymentTokenDecimals: 6,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    explorerTxPath: "/tx/",
    explorerAddressPath: "/address/",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    chainId: "devnet",
    chainType: "solana",
    name: "Solana Devnet",
    shortName: "Solana",
    factoryAddress: "FpCX6E1LxRph23NJgF9R8haRJscGPbbdhP2vd5Sn6jwA",
    paymentTokenAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    paymentTokenSymbol: "USDC",
    paymentTokenDecimals: 6,
    rpcUrl: "https://api.devnet.solana.com",
    explorerUrl: "https://explorer.solana.com",
    explorerTxPath: "/tx/",
    explorerAddressPath: "/address/",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

class ChainConfigService {
  private collectionName: string;

  constructor(_region: string, _tableName: string) {
    this.collectionName = Collections.CHAIN_CONFIGS;
  }

  /**
   * Get a chain configuration by chainId
   */
  async getChainConfig(chainId: string): Promise<ChainConfigEntry | null> {
    try {
      const doc = await getFirestore()
        .collection(this.collectionName)
        .doc(chainId)
        .get();

      if (!doc.exists) {
        return null;
      }
      return doc.data() as ChainConfigEntry;
    } catch (error) {
      console.error(`❌ Failed to get chain config for ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Get all chain configurations
   */
  async getAllChains(): Promise<ChainConfigEntry[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.collectionName)
        .get();

      return snapshot.docs.map(doc => doc.data() as ChainConfigEntry);
    } catch (error) {
      console.error(`❌ Failed to get all chains:`, error);
      return [];
    }
  }

  /**
   * Get all enabled chain configurations
   */
  async getAllEnabledChains(): Promise<ChainConfigEntry[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.collectionName)
        .where('enabled', '==', true)
        .get();

      return snapshot.docs.map(doc => doc.data() as ChainConfigEntry);
    } catch (error) {
      console.error(`❌ Failed to get enabled chains:`, error);
      return [];
    }
  }

  /**
   * Get chain configuration by chain type
   */
  async getChainsByType(chainType: ChainType): Promise<ChainConfigEntry[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.collectionName)
        .where('chainType', '==', chainType)
        .get();

      return snapshot.docs.map(doc => doc.data() as ChainConfigEntry);
    } catch (error) {
      console.error(`❌ Failed to get chains by type ${chainType}:`, error);
      return [];
    }
  }

  /**
   * Create or update a chain configuration
   */
  async putChainConfig(config: ChainConfigEntry): Promise<void> {
    try {
      const now = new Date().toISOString();
      const item: ChainConfigEntry = {
        ...config,
        updatedAt: now,
        createdAt: config.createdAt || now,
      };

      await getFirestore()
        .collection(this.collectionName)
        .doc(config.chainId)
        .set(item);

      console.log(`✅ Chain config saved for ${config.chainId} (${config.name})`);
    } catch (error) {
      console.error(`❌ Failed to save chain config for ${config.chainId}:`, error);
      throw error;
    }
  }

  /**
   * Update the factory address for a chain
   */
  async updateFactoryAddress(chainId: string, factoryAddress: string): Promise<void> {
    try {
      await getFirestore()
        .collection(this.collectionName)
        .doc(chainId)
        .update({
          factoryAddress,
          updatedAt: new Date().toISOString(),
        });

      console.log(`✅ Factory address updated for chain ${chainId}: ${factoryAddress}`);
    } catch (error) {
      console.error(`❌ Failed to update factory address for ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Enable or disable a chain
   */
  async setChainEnabled(chainId: string, enabled: boolean): Promise<void> {
    try {
      await getFirestore()
        .collection(this.collectionName)
        .doc(chainId)
        .update({
          enabled,
          updatedAt: new Date().toISOString(),
        });

      console.log(`✅ Chain ${chainId} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error(`❌ Failed to ${enabled ? 'enable' : 'disable'} chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a chain configuration
   */
  async deleteChainConfig(chainId: string): Promise<void> {
    try {
      await getFirestore()
        .collection(this.collectionName)
        .doc(chainId)
        .delete();

      console.log(`✅ Chain config deleted for ${chainId}`);
    } catch (error) {
      console.error(`❌ Failed to delete chain config for ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Seed default chain configurations
   */
  async seedDefaultConfigs(): Promise<void> {
    console.log("🌱 Seeding default chain configurations...");

    for (const config of DEFAULT_CHAIN_CONFIGS) {
      const existing = await this.getChainConfig(config.chainId);
      if (!existing) {
        await this.putChainConfig(config);
        console.log(`   ✅ Created config for ${config.name}`);
      } else {
        console.log(`   ⏭️  Config already exists for ${config.name}`);
      }
    }

    console.log("🌱 Seeding complete");
  }

  /**
   * Get explorer URL for a transaction
   */
  getTransactionUrl(chainConfig: ChainConfigEntry, txHash: string): string {
    if (chainConfig.chainType === "solana" && chainConfig.chainId === "devnet") {
      return `${chainConfig.explorerUrl}${chainConfig.explorerTxPath}${txHash}?cluster=devnet`;
    }
    return `${chainConfig.explorerUrl}${chainConfig.explorerTxPath}${txHash}`;
  }

  /**
   * Get explorer URL for an address
   */
  getAddressUrl(chainConfig: ChainConfigEntry, address: string): string {
    if (chainConfig.chainType === "solana" && chainConfig.chainId === "devnet") {
      return `${chainConfig.explorerUrl}${chainConfig.explorerAddressPath}${address}?cluster=devnet`;
    }
    return `${chainConfig.explorerUrl}${chainConfig.explorerAddressPath}${address}`;
  }

  /**
   * Check if a chainId is valid and enabled
   */
  async isChainValid(chainId: string): Promise<boolean> {
    const config = await this.getChainConfig(chainId);
    return config !== null && config.enabled;
  }

  /**
   * Get chain config with validation
   */
  async getChainConfigOrThrow(chainId: string): Promise<ChainConfigEntry> {
    const config = await this.getChainConfig(chainId);

    if (!config) {
      throw new Error(`Chain ${chainId} not found`);
    }

    if (!config.enabled) {
      throw new Error(`Chain ${chainId} is currently disabled`);
    }

    return config;
  }
}

export { ChainConfigService };
