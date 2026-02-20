/**
 * Firestore Agent Service (replaces DynamoDB Agent Service)
 * Handles agent CRUD operations, metrics, and management
 */

import { getFirestoreClient, Collections, FieldValue } from '../db/firestoreClient.js';
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

// TypeScript interfaces for Agent
export interface Agent {
  id: string;
  name: string;
  description: string;
  systemInstructions?: string;
  creator: string; // Wallet address
  llmProvider: 'claude' | 'gpt' | 'gemini';
  availableTools: string[]; // Array of "{serverSlug}/{apiSlug}"
  starterPrompts: string[];
  isPublic: boolean;
  totalMessages: number;
  totalUsers: number;
  totalToolCalls: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentParams {
  name: string;
  description: string;
  systemInstructions?: string;
  creator: string;
  llmProvider: 'claude' | 'gpt' | 'gemini';
  availableTools: string[];
  starterPrompts: string[];
  isPublic?: boolean;
}

export class AgentService {
  private collectionName: string;

  constructor(_region: string, _tableName: string) {
    // Region and tableName are ignored - using Firestore
    this.collectionName = Collections.AGENTS;
  }

  /**
   * Create a new agent
   */
  async createAgent(params: CreateAgentParams): Promise<Agent> {
    const now = new Date().toISOString();
    const agent: Agent = {
      id: uuidv4(),
      name: params.name,
      description: params.description,
      systemInstructions: params.systemInstructions || undefined,
      creator: params.creator.toLowerCase(),
      llmProvider: params.llmProvider,
      availableTools: params.availableTools,
      starterPrompts: params.starterPrompts,
      isPublic: params.isPublic !== false,
      totalMessages: 0,
      totalUsers: 0,
      totalToolCalls: 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await getFirestore()
        .collection(this.collectionName)
        .doc(agent.id)
        .set(agent);
      console.log(`✅ Agent created: ${agent.id} (${agent.name})`);
      return agent;
    } catch (error) {
      console.error(`❌ Failed to create agent:`, error);
      throw error;
    }
  }

  /**
   * Get agent by ID
   */
  async getAgent(id: string): Promise<Agent | null> {
    try {
      const doc = await getFirestore()
        .collection(this.collectionName)
        .doc(id)
        .get();

      if (!doc.exists) {
        return null;
      }
      return doc.data() as Agent;
    } catch (error) {
      console.error(`❌ Failed to get agent ${id}:`, error);
      throw error;
    }
  }

  /**
   * List all agents with optional filters
   */
  async listAgents(filters?: {
    creator?: string;
    isPublic?: boolean;
  }): Promise<Agent[]> {
    try {
      let query: FirebaseFirestore.Query = getFirestore().collection(this.collectionName);

      if (filters?.creator) {
        query = query.where('creator', '==', filters.creator.toLowerCase());
      }

      if (filters?.isPublic !== undefined) {
        query = query.where('isPublic', '==', filters.isPublic);
      }

      const snapshot = await query.get();
      return snapshot.docs.map(doc => doc.data() as Agent);
    } catch (error) {
      console.error(`❌ Failed to list agents:`, error);
      throw error;
    }
  }

  /**
   * Get agents by creator wallet
   */
  async getAgentsByCreator(creator: string): Promise<Agent[]> {
    return this.listAgents({ creator });
  }

  /**
   * Get all public agents
   */
  async getPublicAgents(): Promise<Agent[]> {
    return this.listAgents({ isPublic: true });
  }

  /**
   * Update agent
   */
  async updateAgent(id: string, updates: Partial<Agent>): Promise<Agent> {
    const now = new Date().toISOString();

    const updateData: Record<string, any> = {
      updatedAt: now,
    };

    const fieldsToUpdate = [
      'name',
      'description',
      'availableTools',
      'starterPrompts',
      'isPublic',
      'totalMessages',
      'totalUsers',
      'totalToolCalls',
    ];

    for (const field of fieldsToUpdate) {
      if (field in updates) {
        updateData[field] = (updates as any)[field];
      }
    }

    try {
      const docRef = getFirestore().collection(this.collectionName).doc(id);
      await docRef.update(updateData);

      const updatedDoc = await docRef.get();
      console.log(`✅ Agent updated: ${id}`);
      return updatedDoc.data() as Agent;
    } catch (error) {
      console.error(`❌ Failed to update agent ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete agent (only creator can delete)
   */
  async deleteAgent(id: string, creator: string): Promise<void> {
    try {
      const agent = await this.getAgent(id);
      if (!agent) {
        throw new Error(`Agent ${id} not found`);
      }
      if (agent.creator !== creator.toLowerCase()) {
        throw new Error(`Unauthorized: Only agent creator can delete`);
      }

      await getFirestore()
        .collection(this.collectionName)
        .doc(id)
        .delete();
      console.log(`✅ Agent deleted: ${id}`);
    } catch (error) {
      console.error(`❌ Failed to delete agent ${id}:`, error);
      throw error;
    }
  }

  /**
   * Increment a metric (messages, users, or toolCalls)
   */
  async incrementMetric(
    id: string,
    metric: 'totalMessages' | 'totalUsers' | 'totalToolCalls',
    amount: number = 1
  ): Promise<Agent> {
    const now = new Date().toISOString();

    try {
      const docRef = getFirestore().collection(this.collectionName).doc(id);

      await docRef.update({
        [metric]: FieldValue.increment(amount),
        updatedAt: now,
      });

      const updatedDoc = await docRef.get();
      return updatedDoc.data() as Agent;
    } catch (error: any) {
      console.warn(`⚠️  Failed to increment metric for agent ${id}: ${error.message}`);
      return { id } as Agent;
    }
  }

  /**
   * Increment total messages count
   */
  async incrementMessageCount(id: string): Promise<Agent> {
    return this.incrementMetric(id, 'totalMessages', 1);
  }

  /**
   * Increment total unique users count
   */
  async incrementUserCount(id: string): Promise<Agent> {
    return this.incrementMetric(id, 'totalUsers', 1);
  }

  /**
   * Increment total tool calls count
   */
  async incrementToolCallCount(id: string, amount: number = 1): Promise<Agent> {
    return this.incrementMetric(id, 'totalToolCalls', amount);
  }

  /**
   * Get agent metrics
   */
  async getAgentMetrics(id: string): Promise<{
    totalMessages: number;
    totalUsers: number;
    totalToolCalls: number;
  } | null> {
    try {
      const agent = await this.getAgent(id);
      if (!agent) return null;

      return {
        totalMessages: agent.totalMessages || 0,
        totalUsers: agent.totalUsers || 0,
        totalToolCalls: agent.totalToolCalls || 0,
      };
    } catch (error) {
      console.error(`❌ Failed to get metrics for agent ${id}:`, error);
      throw error;
    }
  }
}
