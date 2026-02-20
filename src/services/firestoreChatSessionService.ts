/**
 * Firestore Chat Session Service (replaces DynamoDB Chat Session Service)
 * Handles chat sessions, messages, and conversation history
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

// TypeScript interfaces for Chat
export interface ChatSession {
  id: string;
  agentId: string;
  userAddress: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: string;
  localImageRefs?: LocalImageRef[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface LocalImageRef {
  refId: string;
  mimeType?: string;
  size?: number;
  placeholder: string;
}

export interface SaveMessageResult {
  message: ChatMessage;
  imagesToStore?: Array<{
    refId: string;
    data: string;
    mimeType?: string;
  }>;
}

// Constants
const MAX_CONTENT_SIZE_BYTES = 300 * 1024; // 300KB
const MIN_IMAGE_SIZE_FOR_LOCAL_STORAGE = 50 * 1024; // 50KB

function containsBase64Image(content: string): boolean {
  return (
    content.includes('data:image/') ||
    content.includes('"image":') ||
    content.includes('"imageData":') ||
    content.includes('"base64":') ||
    content.includes('"b64_json":') ||
    /[A-Za-z0-9+/=]{10000,}/.test(content)
  );
}

function extractImageInfo(data: string): {
  mimeType?: string;
  sizeBytes: number;
  isDataUrl: boolean;
} {
  const isDataUrl = data.startsWith('data:image/');
  let mimeType: string | undefined;

  if (isDataUrl) {
    const match = data.match(/data:image\/([a-zA-Z]+);base64/);
    if (match) {
      mimeType = `image/${match[1]}`;
    }
  }

  const base64Part = isDataUrl ? data.split(',')[1] || data : data;
  const sizeBytes = Math.floor(base64Part.length * 0.75);

  return { mimeType, sizeBytes, isDataUrl };
}

function generateImageRefId(): string {
  return `img_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}

interface SanitizeResult {
  content: string;
  localImageRefs: LocalImageRef[];
  imagesToStore: Array<{
    refId: string;
    data: string;
    mimeType?: string;
  }>;
}

function sanitizeContentForStorage(content: string): SanitizeResult {
  const contentBytes = Buffer.byteLength(content, 'utf-8');
  const localImageRefs: LocalImageRef[] = [];
  const imagesToStore: Array<{ refId: string; data: string; mimeType?: string }> = [];

  if (contentBytes <= MAX_CONTENT_SIZE_BYTES && !containsBase64Image(content)) {
    return { content, localImageRefs, imagesToStore };
  }

  try {
    const parsed = JSON.parse(content);
    const { sanitized, refs, images } = sanitizeObjectWithRefs(parsed);
    const sanitizedJson = JSON.stringify(sanitized, null, 2);

    if (Buffer.byteLength(sanitizedJson, 'utf-8') <= MAX_CONTENT_SIZE_BYTES) {
      console.log(`✅ Extracted ${refs.length} image(s) for local storage`);
      return {
        content: sanitizedJson,
        localImageRefs: refs,
        imagesToStore: images
      };
    }
  } catch {
    // Content is not valid JSON
  }

  if (containsBase64Image(content)) {
    const dataUrlMatch = content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) {
      const imageData = dataUrlMatch[0];
      const info = extractImageInfo(imageData);

      if (info.sizeBytes > MIN_IMAGE_SIZE_FOR_LOCAL_STORAGE) {
        const refId = generateImageRefId();
        const placeholder = `[Image: ${info.mimeType || 'image'}, ${formatBytes(info.sizeBytes)}]`;

        localImageRefs.push({
          refId,
          mimeType: info.mimeType,
          size: info.sizeBytes,
          placeholder
        });

        imagesToStore.push({
          refId,
          data: imageData,
          mimeType: info.mimeType
        });

        const sanitizedContent = content.replace(
          dataUrlMatch[0],
          `[[LOCAL_IMAGE:${refId}]]`
        );

        console.log(`✅ Extracted 1 image for local storage (${formatBytes(info.sizeBytes)})`);
        return { content: sanitizedContent, localImageRefs, imagesToStore };
      }
    }

    console.warn(`⚠️ Could not extract image for local storage, using placeholder`);
    return {
      content: '[Image content was generated but could not be stored. The image was displayed to the user.]',
      localImageRefs: [],
      imagesToStore: []
    };
  }

  if (contentBytes > MAX_CONTENT_SIZE_BYTES) {
    const maxChars = Math.floor(MAX_CONTENT_SIZE_BYTES * 0.9);
    console.warn(`⚠️ Truncating large text content (${formatBytes(contentBytes)})`);
    return {
      content: content.substring(0, maxChars) + '\n\n[Content truncated due to size limits]',
      localImageRefs: [],
      imagesToStore: []
    };
  }

  return { content, localImageRefs, imagesToStore };
}

function sanitizeObjectWithRefs(obj: any): {
  sanitized: any;
  refs: LocalImageRef[];
  images: Array<{ refId: string; data: string; mimeType?: string }>;
} {
  const refs: LocalImageRef[] = [];
  const images: Array<{ refId: string; data: string; mimeType?: string }> = [];

  function processValue(value: any, key?: string): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      const isLikelyImageKey = key && ['image', 'imagedata', 'base64', 'data', 'b64_json', 'url', 'result'].includes(key.toLowerCase());
      const looksLikeBase64 = value.length > 10000 && (
        value.startsWith('data:image/') ||
        /^[A-Za-z0-9+/=]{10000,}$/.test(value)
      );

      if (looksLikeBase64 || (isLikelyImageKey && value.length > MIN_IMAGE_SIZE_FOR_LOCAL_STORAGE)) {
        const info = extractImageInfo(value);

        if (info.sizeBytes > MIN_IMAGE_SIZE_FOR_LOCAL_STORAGE) {
          const refId = generateImageRefId();
          const placeholder = `[Image: ${info.mimeType || 'image'}, ${formatBytes(info.sizeBytes)}]`;

          refs.push({
            refId,
            mimeType: info.mimeType,
            size: info.sizeBytes,
            placeholder
          });

          images.push({
            refId,
            data: value,
            mimeType: info.mimeType
          });

          return `[[LOCAL_IMAGE:${refId}]]`;
        }
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item, idx) => processValue(item, String(idx)));
    }

    if (typeof value === 'object') {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = processValue(v, k);
      }
      return result;
    }

    return value;
  }

  const sanitized = processValue(obj);
  return { sanitized, refs, images };
}

export class ChatSessionService {
  private sessionsCollection: string;
  private messagesCollection: string;
  private maxMessagesPerSession: number = 100;

  constructor(
    _region: string,
    _sessionsTableName: string,
    _messagesTableName: string
  ) {
    this.sessionsCollection = Collections.CHAT_SESSIONS;
    this.messagesCollection = Collections.CHAT_MESSAGES;
  }

  /**
   * Get or create a chat session for user + agent
   */
  async getOrCreateSession(
    agentId: string,
    userAddress: string
  ): Promise<ChatSession> {
    const userAddressLower = userAddress.toLowerCase();

    try {
      const existingSession = await this.findSessionByAgentAndUser(
        agentId,
        userAddressLower
      );
      if (existingSession) {
        console.log(
          `✅ Found existing session: ${existingSession.id} (agent: ${agentId}, user: ${userAddressLower})`
        );
        return existingSession;
      }

      const now = new Date().toISOString();
      const session: ChatSession = {
        id: uuidv4(),
        agentId,
        userAddress: userAddressLower,
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
      };

      await getFirestore()
        .collection(this.sessionsCollection)
        .doc(session.id)
        .set(session);

      console.log(
        `✅ Created new session: ${session.id} (agent: ${agentId}, user: ${userAddressLower})`
      );
      return session;
    } catch (error) {
      console.error(
        `❌ Failed to get or create session for agent ${agentId}, user ${userAddressLower}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Force create a new session (for "New Chat" button)
   */
  async createNewSession(
    agentId: string,
    userAddress: string
  ): Promise<ChatSession> {
    const userAddressLower = userAddress.toLowerCase();

    try {
      const now = new Date().toISOString();
      const session: ChatSession = {
        id: uuidv4(),
        agentId,
        userAddress: userAddressLower,
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
      };

      await getFirestore()
        .collection(this.sessionsCollection)
        .doc(session.id)
        .set(session);

      console.log(
        `✅ Force created new session: ${session.id} (agent: ${agentId}, user: ${userAddressLower})`
      );
      return session;
    } catch (error) {
      console.error(
        `❌ Failed to create new session for agent ${agentId}, user ${userAddressLower}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Find session by agent and user
   */
  private async findSessionByAgentAndUser(
    agentId: string,
    userAddress: string
  ): Promise<ChatSession | null> {
    try {
      const snapshot = await getFirestore()
        .collection(this.sessionsCollection)
        .where('agentId', '==', agentId)
        .where('userAddress', '==', userAddress)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }
      return snapshot.docs[0].data() as ChatSession;
    } catch (error) {
      console.error(
        `Error finding session for agent ${agentId}, user ${userAddress}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    try {
      const doc = await getFirestore()
        .collection(this.sessionsCollection)
        .doc(sessionId)
        .get();

      if (!doc.exists) {
        return null;
      }
      return doc.data() as ChatSession;
    } catch (error) {
      console.error(`❌ Failed to get session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userAddress: string): Promise<ChatSession[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.sessionsCollection)
        .where('userAddress', '==', userAddress.toLowerCase())
        .get();

      return snapshot.docs.map(doc => doc.data() as ChatSession);
    } catch (error) {
      console.error(
        `❌ Failed to get sessions for user ${userAddress}:`,
        error
      );
      throw error;
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
  ): Promise<SaveMessageResult> {
    const now = new Date().toISOString();

    const { content: sanitizedContent, localImageRefs, imagesToStore } = sanitizeContentForStorage(content);

    const message: ChatMessage = {
      id: uuidv4(),
      sessionId,
      role,
      content: sanitizedContent,
      timestamp: now,
    };

    if (localImageRefs.length > 0) {
      message.localImageRefs = localImageRefs;
    }

    if (toolCalls) message.toolCalls = toolCalls;
    if (toolCallId) message.toolCallId = toolCallId;

    try {
      await getFirestore()
        .collection(this.messagesCollection)
        .doc(message.id)
        .set(message);

      // Update session
      const sessionRef = getFirestore().collection(this.sessionsCollection).doc(sessionId);
      await sessionRef.update({
        messageCount: FieldValue.increment(1),
        lastMessageAt: now,
      });

      const imageInfo = imagesToStore.length > 0
        ? ` [${imagesToStore.length} image(s) extracted for local storage]`
        : '';
      console.log(
        `✅ Message saved to session ${sessionId}: ${role} (${sanitizedContent.substring(0, 50)}...)${imageInfo}`
      );

      return {
        message,
        imagesToStore: imagesToStore.length > 0 ? imagesToStore : undefined
      };
    } catch (error) {
      console.error(
        `❌ Failed to save message to session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get recent messages for a session
   */
  async getRecentMessages(
    sessionId: string,
    limit: number = 100
  ): Promise<ChatMessage[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.messagesCollection)
        .where('sessionId', '==', sessionId)
        .orderBy('timestamp', 'asc')
        .limit(limit)
        .get();

      const messages = snapshot.docs.map(doc => doc.data() as ChatMessage);
      console.log(
        `✅ Retrieved ${messages.length} messages for session ${sessionId}`
      );
      return messages;
    } catch (error) {
      console.error(
        `❌ Failed to get messages for session ${sessionId}:`,
        error
      );
      throw error;
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
      const snapshot = await getFirestore()
        .collection(this.messagesCollection)
        .where('sessionId', '==', sessionId)
        .orderBy('timestamp', 'asc')
        .get();

      const messages = snapshot.docs;
      const toDelete = messages.slice(0, Math.max(0, messages.length - keepLast));

      if (toDelete.length > 0) {
        const batch = getFirestore().batch();
        toDelete.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(
          `✅ Pruned ${toDelete.length} old messages from session ${sessionId}`
        );
      }
    } catch (error) {
      console.error(
        `❌ Failed to prune messages for session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get conversation history as LLM messages format
   */
  async getConversationHistory(
    sessionId: string,
    limit: number = 100
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    try {
      const messages = await this.getRecentMessages(sessionId, limit);

      return messages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        }));
    } catch (error) {
      console.error(
        `❌ Failed to get conversation history for session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get the last user message
   */
  async getLastUserMessage(sessionId: string): Promise<ChatMessage | null> {
    try {
      const snapshot = await getFirestore()
        .collection(this.messagesCollection)
        .where('sessionId', '==', sessionId)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      const messages = snapshot.docs.map(doc => doc.data() as ChatMessage);
      return messages.find(msg => msg.role === 'user') || null;
    } catch (error) {
      console.error(
        `❌ Failed to get last user message for session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete entire session and all its messages
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      // Get all messages
      const snapshot = await getFirestore()
        .collection(this.messagesCollection)
        .where('sessionId', '==', sessionId)
        .get();

      // Delete all messages in batch
      if (!snapshot.empty) {
        const batch = getFirestore().batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }

      // Delete session
      await getFirestore()
        .collection(this.sessionsCollection)
        .doc(sessionId)
        .delete();

      console.log(
        `✅ Deleted session ${sessionId} and ${snapshot.docs.length} messages`
      );
    } catch (error) {
      console.error(`❌ Failed to delete session ${sessionId}:`, error);
      throw error;
    }
  }
}
