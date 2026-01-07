/**
 * Unified LLM Service for Claude, GPT, and Gemini
 * Handles streaming responses and tool calling
 */

import Anthropic from '@anthropic-ai/sdk'

// Type definitions for LLM interactions
export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
}

export interface LLMResponse {
  content: string
  toolCalls: ToolCall[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
}

export class LLMService {
  private claudeClient: InstanceType<typeof Anthropic> | null = null
  private gptApiKey: string | null = null
  private geminiApiKey: string | null = null

  constructor() {
    // Initialize Claude client
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY
    if (anthropicApiKey) {
      this.claudeClient = new Anthropic({
        apiKey: anthropicApiKey,
      })
      console.log('✅ Claude (Anthropic) API initialized')
    } else {
      console.warn('⚠️  ANTHROPIC_API_KEY not set. Claude support will be disabled.')
    }

    // Store other API keys
    this.gptApiKey = process.env.OPENAI_API_KEY || null
    if (this.gptApiKey) {
      console.log('✅ GPT (OpenAI) API key found')
    } else {
      console.warn('⚠️  OPENAI_API_KEY not set. GPT support will be disabled.')
    }

    this.geminiApiKey = process.env.GOOGLE_AI_API_KEY || null
    if (this.geminiApiKey) {
      console.log('✅ Gemini (Google) API key found')
    } else {
      console.warn('⚠️  GOOGLE_AI_API_KEY not set. Gemini support will be disabled.')
    }
  }

  /**
   * Stream chat response with tool calling support
   * Yields tokens as they arrive for real-time streaming
   */
  async *streamChat(
    provider: 'claude' | 'gpt' | 'gemini',
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): AsyncGenerator<
    { type: 'token'; content: string } | { type: 'tool_call'; tool: ToolCall } | { type: 'done' },
    void,
    unknown
  > {
    if (provider === 'claude') {
      yield* this.streamClaude(messages, tools, systemPrompt)
    } else if (provider === 'gpt') {
      yield* this.streamGPT(messages, tools, systemPrompt)
    } else if (provider === 'gemini') {
      yield* this.streamGemini(messages, tools, systemPrompt)
    } else {
      throw new Error(`Unsupported LLM provider: ${provider}`)
    }
  }

  /**
   * Claude streaming implementation
   */
  private async *streamClaude(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): AsyncGenerator<
    { type: 'token'; content: string } | { type: 'tool_call'; tool: ToolCall } | { type: 'done' },
    void,
    unknown
  > {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized. Set ANTHROPIC_API_KEY environment variable.')
    }

    try {
      // Convert tools to Claude format
      const claudeTools = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      }))

      // Create the stream
      const stream = await this.claudeClient.messages.stream({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2048,
        system: systemPrompt || 'You are a helpful AI assistant that helps users interact with decentralized APIs.',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        tools: claudeTools.length > 0 ? claudeTools : undefined,
      })

      let fullText = ''
      const toolUses: Array<{ id: string; name: string; input: Record<string, any> }> = []

      // Track current tool being built
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null

      // Handle stream events
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_start') {
          const startBlock = chunk as any
          if (startBlock.content_block?.type === 'tool_use') {
            // Start accumulating tool use
            currentToolUse = {
              id: startBlock.content_block.id,
              name: startBlock.content_block.name,
              inputJson: ''
            }
          }
        } else if (chunk.type === 'content_block_delta') {
          const delta = chunk.delta as any

          if (delta.type === 'text_delta') {
            // Yield token
            fullText += delta.text
            yield { type: 'token', content: delta.text }
          } else if (delta.type === 'input_json_delta' && currentToolUse) {
            // Accumulate tool input JSON
            currentToolUse.inputJson += delta.partial_json || ''
          }
        } else if (chunk.type === 'content_block_stop') {
          // Tool use complete - parse and yield it
          if (currentToolUse) {
            const input = currentToolUse.inputJson ? JSON.parse(currentToolUse.inputJson) : {}

            toolUses.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: input,
            })

            yield {
              type: 'tool_call',
              tool: {
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: input,
              },
            }

            currentToolUse = null
          }
        } else if (chunk.type === 'message_stop') {
          // Message complete
        }
      }

      yield { type: 'done' }
    } catch (error: any) {
      console.error('Error in Claude streaming:', error)
      throw error
    }
  }

  /**
   * GPT streaming implementation
   */
  private async *streamGPT(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): AsyncGenerator<
    { type: 'token'; content: string } | { type: 'tool_call'; tool: ToolCall } | { type: 'done' },
    void,
    unknown
  > {
    if (!this.gptApiKey) {
      throw new Error('GPT not configured. Set OPENAI_API_KEY environment variable.')
    }

    try {
      // Dynamic import for OpenAI library
      const { OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: this.gptApiKey })

      // Convert tools to OpenAI format
      const gptTools = tools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }))

      // Create the stream
      const messageList: any[] = [
        {
          role: 'system',
          content: systemPrompt || 'You are a helpful AI assistant that helps users interact with decentralized APIs.',
        },
        ...messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      ]

      const stream = await client.chat.completions.create({
        model: 'gpt-4-turbo',
        max_tokens: 2048,
        messages: messageList,
        tools: gptTools.length > 0 ? gptTools : undefined,
        stream: true,
      } as any)

      // Handle stream events
      for await (const chunk of stream as any) {
        if (chunk.choices && chunk.choices.length > 0) {
          const choice = chunk.choices[0]

          if (choice.delta?.content) {
            yield { type: 'token', content: choice.delta.content }
          }

          if (choice.delta?.tool_calls) {
            for (const toolCall of choice.delta.tool_calls) {
              yield {
                type: 'tool_call',
                tool: {
                  id: toolCall.id || `tool-${Date.now()}`,
                  name: toolCall.function?.name || 'unknown',
                  input: toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {},
                },
              }
            }
          }
        }
      }

      yield { type: 'done' }
    } catch (error: any) {
      console.error('Error in GPT streaming:', error)
      throw error
    }
  }

  /**
   * Gemini streaming implementation
   */
  private async *streamGemini(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): AsyncGenerator<
    { type: 'token'; content: string } | { type: 'tool_call'; tool: ToolCall } | { type: 'done' },
    void,
    unknown
  > {
    if (!this.geminiApiKey) {
      throw new Error('Gemini not configured. Set GOOGLE_AI_API_KEY environment variable.')
    }

    try {
      // Dynamic import for Google AI library
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(this.geminiApiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

      // Convert messages format for Gemini
      const geminiMessages = messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }))

      // Note: Gemini free tier doesn't support function calling in streaming
      // For now, use basic streaming without tool support on free tier
      const stream = await model.generateContentStream({
        contents: geminiMessages,
        systemInstruction: systemPrompt || 'You are a helpful AI assistant that helps users interact with decentralized APIs.',
      })

      // Handle stream events
      for await (const chunk of stream.stream) {
        const text = chunk.text?.()
        if (text) {
          yield { type: 'token', content: text }
        }
      }

      yield { type: 'done' }
    } catch (error: any) {
      console.error('Error in Gemini streaming:', error)
      throw error
    }
  }

  /**
   * Non-streaming chat (simpler interface for testing)
   */
  async chat(
    provider: 'claude' | 'gpt' | 'gemini',
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const response: LLMResponse = {
      content: '',
      toolCalls: [],
      stop_reason: 'end_turn',
    }

    // Collect all streamed content
    for await (const chunk of this.streamChat(provider, messages, tools, systemPrompt)) {
      if (chunk.type === 'token') {
        response.content += chunk.content
      } else if (chunk.type === 'tool_call') {
        response.toolCalls.push(chunk.tool)
      } else if (chunk.type === 'done') {
        response.stop_reason = response.toolCalls.length > 0 ? 'tool_use' : 'end_turn'
      }
    }

    return response
  }

  /**
   * Format IAO APIs as LLM tools
   * Converts API definitions to tool definitions
   */
  static formatApisAsTools(apis: Array<{
    serverSlug: string
    apiSlug: string
    name: string
    description: string
    fee?: string
  }>): ToolDefinition[] {
    return apis.map(api => ({
      name: `call_${api.serverSlug}_${api.apiSlug}`.replace(/-/g, '_'),
      description: `${api.description || api.name}. Server: ${api.serverSlug}, API: ${api.apiSlug}${api.fee ? `, Fee: ${api.fee}` : ''}`,
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional query parameters or additional context for the API call',
          },
        },
        required: [],
      },
    }))
  }

  /**
   * Check if an LLM provider is available
   */
  isProviderAvailable(provider: 'claude' | 'gpt' | 'gemini'): boolean {
    if (provider === 'claude') {
      return this.claudeClient !== null
    } else if (provider === 'gpt') {
      return this.gptApiKey !== null
    } else if (provider === 'gemini') {
      return this.geminiApiKey !== null
    }
    return false
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): Array<'claude' | 'gpt' | 'gemini'> {
    const available: Array<'claude' | 'gpt' | 'gemini'> = []
    if (this.claudeClient) available.push('claude')
    if (this.gptApiKey) available.push('gpt')
    if (this.geminiApiKey) available.push('gemini')
    return available
  }
}
