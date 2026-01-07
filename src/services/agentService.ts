import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid'

// TypeScript interfaces for Agent
export interface Agent {
  id: string
  name: string
  description: string
  creator: string // Wallet address
  llmProvider: 'claude' | 'gpt' | 'gemini'
  availableTools: string[] // Array of "{serverSlug}/{apiSlug}"
  starterPrompts: string[]
  isPublic: boolean
  totalMessages: number // Total messages count
  totalUsers: number // Unique users count
  totalToolCalls: number // API calls made
  createdAt: string // ISO timestamp
  updatedAt: string
}

export interface CreateAgentParams {
  name: string
  description: string
  creator: string
  llmProvider: 'claude' | 'gpt' | 'gemini'
  availableTools: string[]
  starterPrompts: string[]
  isPublic?: boolean
}

export class AgentService {
  private docClient: DynamoDBDocumentClient
  private tableName: string

  constructor(region: string, tableName: string) {
    const config: any = { region }

    // Use local DynamoDB endpoint if configured (for development/testing)
    // if (process.env.DYNAMODB_ENDPOINT) {
    //   config.endpoint = process.env.DYNAMODB_ENDPOINT
    // }

    const client = new DynamoDBClient(config)
    this.docClient = DynamoDBDocumentClient.from(client)
    this.tableName = tableName
  }

  /**
   * Create a new agent
   */
  async createAgent(params: CreateAgentParams): Promise<Agent> {
    const now = new Date().toISOString()
    const agent: Agent = {
      id: uuidv4(),
      name: params.name,
      description: params.description,
      creator: params.creator.toLowerCase(),
      llmProvider: params.llmProvider,
      availableTools: params.availableTools,
      starterPrompts: params.starterPrompts,
      isPublic: params.isPublic !== false, // Default to public
      totalMessages: 0,
      totalUsers: 0,
      totalToolCalls: 0,
      createdAt: now,
      updatedAt: now,
    }

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: agent,
        })
      )
      console.log(`✅ Agent created: ${agent.id} (${agent.name})`)
      return agent
    } catch (error) {
      console.error(`❌ Failed to create agent:`, error)
      throw error
    }
  }

  /**
   * Get agent by ID
   */
  async getAgent(id: string): Promise<Agent | null> {
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { id },
        })
      )
      return result.Item as Agent || null
    } catch (error) {
      console.error(`❌ Failed to get agent ${id}:`, error)
      throw error
    }
  }

  /**
   * List all agents with optional filters
   */
  async listAgents(filters?: {
    creator?: string
    isPublic?: boolean
  }): Promise<Agent[]> {
    try {
      if (filters?.creator) {
        // Query by creator using GSI
        const result = await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'creator-index',
            KeyConditionExpression: 'creator = :creator',
            ExpressionAttributeValues: {
              ':creator': filters.creator.toLowerCase(),
            },
          })
        )
        return (result.Items as Agent[]) || []
      }

      // Scan all agents
      const result = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
        })
      )

      let agents = (result.Items as Agent[]) || []

      // Filter by public status if specified
      if (filters?.isPublic !== undefined) {
        agents = agents.filter(agent => agent.isPublic === filters.isPublic)
      }

      return agents
    } catch (error) {
      console.error(`❌ Failed to list agents:`, error)
      throw error
    }
  }

  /**
   * Get agents by creator wallet
   */
  async getAgentsByCreator(creator: string): Promise<Agent[]> {
    return this.listAgents({ creator })
  }

  /**
   * Get all public agents
   */
  async getPublicAgents(): Promise<Agent[]> {
    return this.listAgents({ isPublic: true })
  }

  /**
   * Update agent
   */
  async updateAgent(id: string, updates: Partial<Agent>): Promise<Agent> {
    const now = new Date().toISOString()

    // Build update expression and attribute values
    const updateExpressions: string[] = []
    const expressionAttributeValues: Record<string, any> = {}

    const fieldsToUpdate = [
      'name',
      'description',
      'availableTools',
      'starterPrompts',
      'isPublic',
      'totalMessages',
      'totalUsers',
      'totalToolCalls',
    ]

    for (const field of fieldsToUpdate) {
      if (field in updates) {
        updateExpressions.push(`${field} = :${field}`)
        expressionAttributeValues[`:${field}`] = (updates as any)[field]
      }
    }

    // Always update updatedAt
    updateExpressions.push('updatedAt = :updatedAt')
    expressionAttributeValues[':updatedAt'] = now

    try {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        })
      )
      console.log(`✅ Agent updated: ${id}`)
      return result.Attributes as Agent
    } catch (error) {
      console.error(`❌ Failed to update agent ${id}:`, error)
      throw error
    }
  }

  /**
   * Delete agent (only creator can delete)
   */
  async deleteAgent(id: string, creator: string): Promise<void> {
    try {
      // First verify ownership
      const agent = await this.getAgent(id)
      if (!agent) {
        throw new Error(`Agent ${id} not found`)
      }
      if (agent.creator !== creator.toLowerCase()) {
        throw new Error(`Unauthorized: Only agent creator can delete`)
      }

      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { id },
        })
      )
      console.log(`✅ Agent deleted: ${id}`)
    } catch (error) {
      console.error(`❌ Failed to delete agent ${id}:`, error)
      throw error
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
    const now = new Date().toISOString()

    try {
      // Use ExpressionAttributeNames to properly reference attribute names in DynamoDB
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression: `SET #metric = if_not_exists(#metric, :zero) + :amount, updatedAt = :now`,
          ExpressionAttributeNames: {
            '#metric': metric,  // Map placeholder to actual attribute name
          },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':amount': amount,
            ':now': now,
          },
          ReturnValues: 'ALL_NEW',
        })
      )
      return result.Attributes as Agent
    } catch (error: any) {
      // Log but don't throw - metrics increment is not critical
      console.warn(`⚠️  Failed to increment metric for agent ${id}: ${error.message}`)
      // Return a minimal agent object so the response can still be sent
      return { id } as Agent
    }
  }

  /**
   * Increment total messages count
   */
  async incrementMessageCount(id: string): Promise<Agent> {
    return this.incrementMetric(id, 'totalMessages', 1)
  }

  /**
   * Increment total unique users count
   */
  async incrementUserCount(id: string): Promise<Agent> {
    return this.incrementMetric(id, 'totalUsers', 1)
  }

  /**
   * Increment total tool calls count
   */
  async incrementToolCallCount(id: string, amount: number = 1): Promise<Agent> {
    return this.incrementMetric(id, 'totalToolCalls', amount)
  }

  /**
   * Get agent metrics
   */
  async getAgentMetrics(id: string): Promise<{
    totalMessages: number
    totalUsers: number
    totalToolCalls: number
  } | null> {
    try {
      const agent = await this.getAgent(id)
      if (!agent) return null

      return {
        totalMessages: agent.totalMessages || 0,
        totalUsers: agent.totalUsers || 0,
        totalToolCalls: agent.totalToolCalls || 0,
      }
    } catch (error) {
      console.error(`❌ Failed to get metrics for agent ${id}:`, error)
      throw error
    }
  }
}
