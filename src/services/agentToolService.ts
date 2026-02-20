/**
 * Agent Tool Service
 * Handles:
 * - Converting IAO APIs to LLM tool definitions
 * - Executing tool calls (calling IAO APIs)
 * - Managing API responses
 */

import fetch from 'node-fetch'
import { decompress as decompressZstd } from 'fzstd'
import { Agent } from './firestoreAgentService.js'
import { ToolDefinition, ToolCall } from './llmService.js'

export interface ApiEntry {
  index: number
  slug: string
  name: string
  description?: string
  apiUrl?: string
  fee: string
  method?: 'GET' | 'POST'  // HTTP method (defaults to GET)
  createdAt: string
}

export interface IaoServer {
  id: string
  slug: string
  name: string
  symbol: string
  builder: string
  paymentToken: string
  apis: ApiEntry[]
}

export interface ToolExecutionResult {
  toolCallId: string
  toolName: string
  success: boolean
  result?: any
  error?: string
  async?: boolean  // True if result came from async polling
  estimatedTime?: number  // Estimated seconds for async operations
}

// Interface for async job responses from APIs that return 202
export interface AsyncJobResponse {
  status?: 'processing' | 'pending' | 'completed' | 'failed' | 'error'
  statusUrl?: string
  status_url?: string  // Alternative naming convention
  jobId?: string
  job_id?: string      // Alternative naming convention
  estimatedTime?: number
  estimated_time?: number  // Alternative naming convention
  result?: any
  error?: string
  message?: string
}

// Configuration for async polling
const ASYNC_POLLING_CONFIG = {
  pollIntervalMs: 5000,        // 5 seconds between polls
  maxDurationMs: 5 * 60 * 1000, // 5 minutes max
  maxAttempts: 60,              // Max poll attempts
}

/**
 * Simple delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Poll a status URL until the async job completes or times out
 */
async function pollForResult(
  statusUrl: string,
  baseUrl: string,
  maxDurationMs: number = ASYNC_POLLING_CONFIG.maxDurationMs
): Promise<{ success: boolean; result?: any; error?: string }> {
  const startTime = Date.now()
  let attempts = 0

  // Resolve relative URL to absolute
  const fullStatusUrl = statusUrl.startsWith('http')
    ? statusUrl
    : new URL(statusUrl, baseUrl).toString()

  console.log(`⏳ Starting async polling for: ${fullStatusUrl}`)

  while (Date.now() - startTime < maxDurationMs && attempts < ASYNC_POLLING_CONFIG.maxAttempts) {
    attempts++

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000) // 30 second timeout per poll

      const response = await fetch(fullStatusUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (response.status === 200) {
        // Job might be completed
        const data = await response.json() as AsyncJobResponse

        // Check if still processing (some APIs return 200 with status field)
        if (data.status === 'processing' || data.status === 'pending') {
          console.log(`⏳ Poll attempt ${attempts}: Still processing...`)
          await delay(ASYNC_POLLING_CONFIG.pollIntervalMs)
          continue
        }

        // Check for failure status
        if (data.status === 'failed' || data.status === 'error') {
          return { success: false, error: data.error || data.message || 'Job failed' }
        }

        // Success - return result
        console.log(`✅ Async job completed after ${attempts} polls`)
        return { success: true, result: data.result || data }
      }

      if (response.status === 202) {
        // Still processing, continue polling
        console.log(`⏳ Poll attempt ${attempts}: Status 202, continuing...`)
        await delay(ASYNC_POLLING_CONFIG.pollIntervalMs)
        continue
      }

      // Non-2xx status = error
      const errorText = await response.text()
      return { success: false, error: `Status check returned ${response.status}: ${errorText}` }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`⚠️ Poll attempt ${attempts} timed out, retrying...`)
      } else {
        console.error(`⚠️ Polling error (attempt ${attempts}):`, error.message)
      }
      // On network error or timeout, wait and retry
      await delay(ASYNC_POLLING_CONFIG.pollIntervalMs)
    }
  }

  // Timeout
  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
  return { success: false, error: `Async operation timed out after ${elapsedSeconds} seconds (${attempts} attempts)` }
}

export class AgentToolService {
  private baseUrl: string
  private backendUrl: string

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl
    this.backendUrl = baseUrl
  }

  /**
   * Fetch all available IAO servers and APIs
   */
  async fetchAvailableServers(): Promise<IaoServer[]> {
    try {
      const response = await fetch(`${this.backendUrl}/api/servers`)

      if (!response.ok) {
        throw new Error(`Failed to fetch servers: ${response.status}`)
      }

      const data = (await response.json()) as any
      // Handle different response formats: data.servers (current), data.data (alternative), or raw array
      return (data.servers || data.data || data) as IaoServer[]
    } catch (error) {
      console.error('Error fetching available servers:', error)
      return []
    }
  }

  /**
   * Get tools available for a specific agent
   */
  async getToolsForAgent(agent: Agent): Promise<ToolDefinition[]> {
    try {
      // Fetch all available servers
      const servers = await this.fetchAvailableServers()

      // Filter APIs based on agent's availableTools list
      const tools: ToolDefinition[] = []

      for (const availableToolString of agent.availableTools) {
        const [serverSlug, apiSlug] = availableToolString.split('/')

        // Find the server and API
        const server = servers.find(s => s.slug.toLowerCase() === serverSlug.toLowerCase())
        if (!server) {
          console.warn(`Server not found: ${serverSlug}`)
          continue
        }

        const api = server.apis.find(a => a.slug.toLowerCase() === apiSlug.toLowerCase())
        if (!api) {
          console.warn(`API not found: ${serverSlug}/${apiSlug}`)
          continue
        }

        // Create tool definition
        const toolName = `call_${serverSlug}_${apiSlug}`.replace(/-/g, '_').toLowerCase()
        const httpMethod = api.method || 'GET'
        const isPostApi = httpMethod === 'POST'

        // Build comprehensive description including usage examples and HTTP method
        let description = `[${httpMethod}] ${api.name || api.slug} - ${api.description || 'No description available'}`

        // Build input schema based on HTTP method
        let inputSchema: {
          type: 'object'
          properties: Record<string, any>
          required: string[]
        }

        if (isPostApi) {
          // POST API - needs a JSON body
          inputSchema = {
            type: 'object' as const,
            properties: {
              body: {
                type: 'object',
                description: 'JSON request body for this POST API. Ask the user what data they want to send if not specified.'
              }
            },
            required: ['body'] as string[]
          }
          description += '\n⚠️ This is a POST API - you MUST ask the user for the request body/payload before calling.'
        } else {
          // GET API - uses query parameters
          const usageMatch = api.description?.match(/usage example[s]?:?\s*(.+)/i)
          let queryDescription = 'Query parameters for the API call (e.g., "base=USD" or "latitude=52.52&longitude=13.41")'

          if (usageMatch) {
            const examples = usageMatch[1]
            queryDescription = `Query parameters for the API call. Examples from docs: ${examples.slice(0, 200)}`
          }

          inputSchema = {
            type: 'object' as const,
            properties: {
              query: {
                type: 'string',
                description: queryDescription
              }
            },
            required: [] as string[]
          }
        }

        const tool: ToolDefinition = {
          name: toolName,
          description: `${description}\nFee: ${api.fee} wei`,
          input_schema: inputSchema
        }

        tools.push(tool)
      }

      console.log(`✅ Loaded ${tools.length} tools for agent ${agent.id}`)
      return tools
    } catch (error) {
      console.error('Error getting tools for agent:', error)
      return []
    }
  }

  /**
   * Get API information for payment option display
   * Returns API metadata needed for payment buttons
   */
  async getApiInfo(serverSlug: string, apiSlug: string): Promise<{
    name: string;
    description: string;
    fee: string;
    tokenAddress: string;
    method: 'GET' | 'POST';
  }> {
    try {
      const servers = await this.fetchAvailableServers()
      const server = servers.find(s => s.slug.toLowerCase() === serverSlug.toLowerCase())

      if (!server) {
        throw new Error(`Server ${serverSlug} not found`)
      }

      const api = server.apis.find(a => a.slug.toLowerCase() === apiSlug.toLowerCase())

      if (!api) {
        throw new Error(`API ${apiSlug} not found in ${serverSlug}`)
      }

      return {
        name: api.name || api.slug,
        description: api.description || 'No description available',
        fee: api.fee,
        method: api.method || 'GET',
        tokenAddress: server.id
      }
    } catch (error) {
      console.error('Error getting API info:', error)
      throw error
    }
  }

  /**
   * Execute a tool call (call the IAO API)
   * Returns the API response
   */
  async executeTool(
    toolCall: ToolCall,
    agent: Agent
  ): Promise<ToolExecutionResult> {
    try {
      // Parse tool name to get serverSlug and apiSlug
      // Tool name format: call_serverSlug_apiSlug
      const toolNameParts = toolCall.name.replace('call_', '').split('_')

      if (toolNameParts.length < 2) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          error: `Invalid tool name format: ${toolCall.name}`
        }
      }

      // Reconstruct slug from parts (accounts for slugs with underscores)
      // For now, assume simple pattern: call_{serverSlug}_{apiSlug}
      const serverSlug = toolNameParts[0]
      const apiSlug = toolNameParts.slice(1).join('_')

      console.log(`🔧 Executing tool: ${toolCall.name} (parsed: ${serverSlug}/${apiSlug})`)

      // Fetch API metadata to get the stored HTTP method
      // NOTE: Tool names have hyphens replaced with underscores, so we need to match carefully
      const servers = await this.fetchAvailableServers()

      // Find server by matching the tool name pattern
      let matchedServer: IaoServer | undefined
      let matchedApi: ApiEntry | undefined

      for (const server of servers) {
        for (const api of server.apis) {
          // Generate the expected tool name for this server/api combo
          const expectedToolName = `call_${server.slug}_${api.slug}`.replace(/-/g, '_').toLowerCase()
          if (expectedToolName === toolCall.name.toLowerCase()) {
            matchedServer = server
            matchedApi = api
            console.log(`✅ Matched tool to: ${server.slug}/${api.slug}`)
            break
          }
        }
        if (matchedServer) break
      }

      const storedMethod = matchedApi?.method || 'GET'
      console.log(`📋 API method from DB: ${storedMethod}`)

      // Use matched slugs for the API URL (they have correct hyphens)
      const actualServerSlug = matchedServer?.slug || serverSlug
      const actualApiSlug = matchedApi?.slug || apiSlug

      // Build the API URL
      const apiUrl = `${this.backendUrl}/api/${actualServerSlug}/${actualApiSlug}`

      // Use the API's stored method, not inferred from input
      let httpMethod = storedMethod
      let queryParam = ''
      let requestBody: string | undefined = undefined

      if (httpMethod === 'POST') {
        // POST request - use body from input
        if (toolCall.input?.body) {
          requestBody = typeof toolCall.input.body === 'string'
            ? toolCall.input.body
            : JSON.stringify(toolCall.input.body)
        } else if (toolCall.input && Object.keys(toolCall.input).length > 0) {
          // Use entire input as body if no explicit body field
          requestBody = JSON.stringify(toolCall.input)
        } else {
          // POST with empty body
          requestBody = '{}'
        }
        console.log(`🌐 Calling API (POST): ${apiUrl}`)
        console.log(`📤 Request body: ${requestBody}`)
      } else {
        // GET request - use query parameters
        if (toolCall.input?.query) {
          const query = toolCall.input.query.trim()
          queryParam = query.startsWith('?') ? query : `?${query}`
        }
        console.log(`🌐 Calling API (GET): ${apiUrl}${queryParam}`)
      }

      // Call the IAO API with timeout
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch(`${apiUrl}${queryParam}`, {
        method: httpMethod,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: requestBody,
        signal: controller.signal
      })

      clearTimeout(timeout)

      // Handle 202 Accepted - async job started
      if (response.status === 202) {
        console.log(`⏳ API returned 202 Accepted - starting async polling...`)

        let asyncResponse: AsyncJobResponse
        try {
          asyncResponse = await response.json() as AsyncJobResponse
        } catch {
          asyncResponse = {}
        }

        // Get status URL from response body or Location header
        const statusUrl = asyncResponse.statusUrl
          || asyncResponse.status_url
          || response.headers.get('Location')

        if (!statusUrl) {
          throw new Error('API returned 202 but no status URL provided. The API should include a statusUrl in the response body or a Location header.')
        }

        // Get estimated time if provided
        const estimatedTime = asyncResponse.estimatedTime || asyncResponse.estimated_time

        console.log(`⏳ Async job started, polling ${statusUrl}${estimatedTime ? ` (estimated: ${estimatedTime}s)` : ''}...`)

        // Poll for result
        const pollResult = await pollForResult(statusUrl, `${apiUrl}${queryParam}`)

        if (!pollResult.success) {
          throw new Error(pollResult.error || 'Async operation failed')
        }

        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: true,
          result: pollResult.result,
          async: true
        }
      }

      if (!response.ok) {
        const errorData = await response.text()
        throw new Error(`API returned ${response.status}: ${errorData}`)
      }

      // Check if response is zstd compressed
      const contentEncoding = response.headers.get('content-encoding') || ''
      const contentType = response.headers.get('content-type') || ''
      let result: any

      if (contentEncoding.toLowerCase().includes('zstd')) {
        console.log(`🗜️  API response is zstd compressed - decompressing...`)
        try {
          // Get compressed data as buffer
          const compressedData = await response.arrayBuffer()
          const compressedBuffer = Buffer.from(compressedData)

          // Decompress
          const decompressedBuffer = decompressZstd(compressedBuffer)
          const decompressedText = Buffer.from(decompressedBuffer).toString('utf-8')

          // Parse as JSON
          result = JSON.parse(decompressedText)
          console.log(`✅ Successfully decompressed and parsed zstd response`)
        } catch (decompressError: any) {
          throw new Error(`Failed to decompress zstd response: ${decompressError.message}`)
        }
      } else {
        // Normal JSON parsing for uncompressed or gzip/deflate responses (handled by node-fetch)
        result = await response.json()
      }

      // Extract the actual data from response (handle both wrapper and direct formats)
      const apiData = (result as any)?.data || result

      console.log(`✅ Tool executed successfully: ${toolCall.name}`)

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: true,
        result: apiData
      }
    } catch (error: any) {
      console.error(`❌ Tool execution failed: ${toolCall.name}`, error)

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        error: error.message || 'Unknown error'
      }
    }
  }

  /**
   * Execute multiple tool calls sequentially
   */
  async executeTools(
    toolCalls: ToolCall[],
    agent: Agent
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = []

    for (const toolCall of toolCalls) {
      const result = await this.executeTool(toolCall, agent)
      results.push(result)

      // Add a small delay between calls to avoid rate limiting
      if (toolCalls.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    return results
  }

  /**
   * Format tool execution results as a string for LLM consumption
   * This will be passed back to the LLM to continue the conversation
   */
  formatToolResults(results: ToolExecutionResult[]): string {
    let output = ''

    for (const result of results) {
      if (result.success) {
        output += `\n✅ ${result.toolName}:\n${JSON.stringify(result.result, null, 2)}`
      } else {
        output += `\n❌ ${result.toolName}: ${result.error}`
      }
    }

    return output.trim()
  }

  /**
   * Validate that agent has access to a tool
   */
  hasToolAccess(agent: Agent, toolName: string): boolean {
    // Tool name format: call_serverSlug_apiSlug
    // Must match the same normalization used in getToolsForAgent (line 98)
    const availableTools = agent.availableTools.map(t =>
      `call_${t.replace('/', '_').replace(/-/g, '_')}`.toLowerCase()
    )

    return availableTools.includes(toolName.toLowerCase())
  }

  /**
   * Get fee for an API call (in wei)
   */
  async getApiCallFee(serverSlug: string, apiSlug: string): Promise<string> {
    const apiInfo = await this.getApiInfo(serverSlug, apiSlug)
    return apiInfo?.fee || '0'
  }
}
