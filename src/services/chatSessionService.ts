import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid'

// TypeScript interfaces for Chat
export interface ChatSession {
  id: string
  agentId: string
  userAddress: string
  messageCount: number
  lastMessageAt: string // ISO timestamp
  createdAt: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  timestamp: string // ISO timestamp
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
}

export class ChatSessionService {
  private docClient: DynamoDBDocumentClient
  private sessionsTableName: string
  private messagesTableName: string
  private maxMessagesPerSession: number = 100

  constructor(
    region: string,
    sessionsTableName: string,
    messagesTableName: string
  ) {
    const config: any = { region }

    // Use local DynamoDB endpoint if configured (for development/testing)
    if (process.env.DYNAMODB_ENDPOINT) {
      config.endpoint = process.env.DYNAMODB_ENDPOINT
    }

    const client = new DynamoDBClient(config)
    this.docClient = DynamoDBDocumentClient.from(client)
    this.sessionsTableName = sessionsTableName
    this.messagesTableName = messagesTableName
  }

  /**
   * Get or create a chat session for user + agent
   */
  async getOrCreateSession(
    agentId: string,
    userAddress: string
  ): Promise<ChatSession> {
    const userAddressLower = userAddress.toLowerCase()

    try {
      // Try to find existing session
      const existingSession = await this.findSessionByAgentAndUser(
        agentId,
        userAddressLower
      )
      if (existingSession) {
        console.log(
          `✅ Found existing session: ${existingSession.id} (agent: ${agentId}, user: ${userAddressLower})`
        )
        return existingSession
      }

      // Create new session
      const now = new Date().toISOString()
      const session: ChatSession = {
        id: uuidv4(),
        agentId,
        userAddress: userAddressLower,
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
      }

      await this.docClient.send(
        new PutCommand({
          TableName: this.sessionsTableName,
          Item: session,
        })
      )

      console.log(
        `✅ Created new session: ${session.id} (agent: ${agentId}, user: ${userAddressLower})`
      )
      return session
    } catch (error) {
      console.error(
        `❌ Failed to get or create session for agent ${agentId}, user ${userAddressLower}:`,
        error
      )
      throw error
    }
  }

  /**
   * Force create a new session (for "New Chat" button)
   * Always creates a new session regardless of existing ones
   */
  async createNewSession(
    agentId: string,
    userAddress: string
  ): Promise<ChatSession> {
    const userAddressLower = userAddress.toLowerCase()

    try {
      const now = new Date().toISOString()
      const session: ChatSession = {
        id: uuidv4(),
        agentId,
        userAddress: userAddressLower,
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
      }

      await this.docClient.send(
        new PutCommand({
          TableName: this.sessionsTableName,
          Item: session,
        })
      )

      console.log(
        `✅ Force created new session: ${session.id} (agent: ${agentId}, user: ${userAddressLower})`
      )
      return session
    } catch (error) {
      console.error(
        `❌ Failed to create new session for agent ${agentId}, user ${userAddressLower}:`,
        error
      )
      throw error
    }
  }

  /**
   * Find session by agent and user (using GSI)
   */
  private async findSessionByAgentAndUser(
    agentId: string,
    userAddress: string
  ): Promise<ChatSession | null> {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.sessionsTableName,
          IndexName: 'agentId-userAddress-index',
          KeyConditionExpression: 'agentId = :agentId AND userAddress = :userAddress',
          ExpressionAttributeValues: {
            ':agentId': agentId,
            ':userAddress': userAddress,
          },
          Limit: 1,
        })
      )

      return (result.Items?.[0] as ChatSession) || null
    } catch (error) {
      console.error(
        `Error finding session for agent ${agentId}, user ${userAddress}:`,
        error
      )
      return null
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.sessionsTableName,
          Key: { id: sessionId },
        })
      )
      return (result.Item as ChatSession) || null
    } catch (error) {
      console.error(`❌ Failed to get session ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userAddress: string): Promise<ChatSession[]> {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.sessionsTableName,
          IndexName: 'userAddress-index',
          KeyConditionExpression: 'userAddress = :userAddress',
          ExpressionAttributeValues: {
            ':userAddress': userAddress.toLowerCase(),
          },
        })
      )
      return (result.Items as ChatSession[]) || []
    } catch (error) {
      console.error(
        `❌ Failed to get sessions for user ${userAddress}:`,
        error
      )
      throw error
    }
  }

  /**
   * Save a message to the session
   */
  async saveMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string,
    toolCalls?: ToolCall[],
    toolCallId?: string
  ): Promise<ChatMessage> {
    const now = new Date().toISOString()
    const message: ChatMessage = {
      id: uuidv4(),
      sessionId,
      role,
      content,
      timestamp: now,
    }

    if (toolCalls) message.toolCalls = toolCalls
    if (toolCallId) message.toolCallId = toolCallId

    try {
      // Save message
      await this.docClient.send(
        new PutCommand({
          TableName: this.messagesTableName,
          Item: message,
        })
      )

      // Update session: increment message count and update lastMessageAt
      const session = await this.getSession(sessionId)
      if (session) {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.sessionsTableName,
            Key: { id: sessionId },
            UpdateExpression:
              'SET messageCount = messageCount + :inc, lastMessageAt = :now',
            ExpressionAttributeValues: {
              ':inc': 1,
              ':now': now,
            },
          })
        )
      }

      console.log(
        `✅ Message saved to session ${sessionId}: ${role} (${content.substring(0, 50)}...)`
      )
      return message
    } catch (error) {
      console.error(
        `❌ Failed to save message to session ${sessionId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Get recent messages for a session (last N messages, default 100)
   */
  async getRecentMessages(
    sessionId: string,
    limit: number = 100
  ): Promise<ChatMessage[]> {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.messagesTableName,
          IndexName: 'sessionId-timestamp-index',
          KeyConditionExpression: 'sessionId = :sessionId',
          ExpressionAttributeValues: {
            ':sessionId': sessionId,
          },
          ScanIndexForward: true, // Oldest first
          Limit: limit,
        })
      )

      const messages = (result.Items as ChatMessage[]) || []
      console.log(
        `✅ Retrieved ${messages.length} messages for session ${sessionId}`
      )
      return messages
    } catch (error) {
      console.error(
        `❌ Failed to get messages for session ${sessionId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Prune old messages (keep only last N)
   */
  async pruneOldMessages(
    sessionId: string,
    keepLast: number = 100
  ): Promise<void> {
    try {
      // Get all messages for session
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.messagesTableName,
          IndexName: 'sessionId-timestamp-index',
          KeyConditionExpression: 'sessionId = :sessionId',
          ExpressionAttributeValues: {
            ':sessionId': sessionId,
          },
          ScanIndexForward: true, // Oldest first
        })
      )

      const messages = (result.Items as ChatMessage[]) || []
      const toDelete = messages.slice(0, Math.max(0, messages.length - keepLast))

      // Delete old messages
      for (const message of toDelete) {
        await this.docClient.send(
          new DeleteCommand({
            TableName: this.messagesTableName,
            Key: { id: message.id },
          })
        )
      }

      if (toDelete.length > 0) {
        console.log(
          `✅ Pruned ${toDelete.length} old messages from session ${sessionId}`
        )
      }
    } catch (error) {
      console.error(
        `❌ Failed to prune messages for session ${sessionId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Get conversation history as LLM messages format
   * Returns messages in chronological order (oldest first)
   */
  async getConversationHistory(
    sessionId: string,
    limit: number = 100
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    try {
      const messages = await this.getRecentMessages(sessionId, limit)

      // Filter to only user and assistant messages (exclude tool messages)
      return messages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        }))
    } catch (error) {
      console.error(
        `❌ Failed to get conversation history for session ${sessionId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Get the last user message (used to process)
   */
  async getLastUserMessage(sessionId: string): Promise<ChatMessage | null> {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.messagesTableName,
          IndexName: 'sessionId-timestamp-index',
          KeyConditionExpression: 'sessionId = :sessionId',
          ExpressionAttributeValues: {
            ':sessionId': sessionId,
          },
          ScanIndexForward: false, // Newest first
          Limit: 1,
        })
      )

      const messages = (result.Items as ChatMessage[]) || []
      const lastMessage = messages.find(msg => msg.role === 'user')

      return lastMessage || null
    } catch (error) {
      console.error(
        `❌ Failed to get last user message for session ${sessionId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Delete entire session and all its messages
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      // Get all messages for this session
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.messagesTableName,
          IndexName: 'sessionId-timestamp-index',
          KeyConditionExpression: 'sessionId = :sessionId',
          ExpressionAttributeValues: {
            ':sessionId': sessionId,
          },
        })
      )

      // Delete all messages
      const messages = (result.Items as ChatMessage[]) || []
      for (const message of messages) {
        await this.docClient.send(
          new DeleteCommand({
            TableName: this.messagesTableName,
            Key: { id: message.id },
          })
        )
      }

      // Delete session
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.sessionsTableName,
          Key: { id: sessionId },
        })
      )

      console.log(
        `✅ Deleted session ${sessionId} and ${messages.length} messages`
      )
    } catch (error) {
      console.error(`❌ Failed to delete session ${sessionId}:`, error)
      throw error
    }
  }
}
