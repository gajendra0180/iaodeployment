import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import cors from 'cors'
import { facilitator as thirdwebFacilitatorFn, settlePayment } from 'thirdweb/x402'
import { createThirdwebClient } from 'thirdweb'
import { baseSepolia } from 'thirdweb/chains'
import { getContract, readContract } from 'thirdweb'
import fetch from 'node-fetch'
import fs from 'fs'
import { DynamoDBService, IAOTokenDBEntry, ApiEntry } from './services/dynamoDBService.js'
import { UserRequestService } from './services/userRequestService.js'
import { MetricsService } from './services/metricsService.js'
import { AgentService, CreateAgentParams } from './services/agentService.js'
import { ChatSessionService } from './services/chatSessionService.js'
import { LLMService } from './services/llmService.js'
import { AgentToolService } from './services/agentToolService.js'
import { AgentPaymentService } from './services/agentPaymentService.js'
import { generateBuilderJWT } from './utils/jwtAuth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load IAOToken ABI
let IAOTokenABI: any[] = []
try {
  const abiPath = path.join(process.cwd(), 'abis/IAOToken.json')
  IAOTokenABI = JSON.parse(fs.readFileSync(abiPath, 'utf-8'))
  console.log('✅ IAOToken ABI loaded')
} catch (error) {
  console.error('❌ Failed to load IAOToken ABI:', error)
}

// Load IAOTokenFactory ABI
let IAOTokenFactoryABI: any[] = []
try {
  const factoryAbiPath = path.join(process.cwd(), 'abis/IAOTokenFactory.json')
  IAOTokenFactoryABI = JSON.parse(fs.readFileSync(factoryAbiPath, 'utf-8'))
  console.log('✅ IAOTokenFactory ABI loaded')
} catch (error) {
  console.error('❌ Failed to load IAOTokenFactory ABI:', error)
}

// IAO Token Factory address (from constants or env)
const IAO_FACTORY_ADDRESS = "0xF110bA6BBc7cD595842B6b56ab870faC811e41B5";

// Load environment variables
config()

const app = express()

// Add CORS middleware
app.use(cors())
app.use(express.json())

// Serve static files from public directory (built frontend)
// Only serve static files if public directory exists (frontend has been built)
const publicPath = path.join(__dirname, '..', 'public')
import { existsSync } from 'fs'
import { Console } from 'console'

if (existsSync(publicPath)) {
  app.use(express.static(publicPath))
  
  // Serve frontend for all non-API routes (SPA routing)
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/')) {
      return next()
    }
    // Serve index.html for frontend routes
    const indexPath = path.join(publicPath, 'index.html')
    if (existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      next()
    }
  })
} else {
  console.warn('⚠️  Frontend not built yet. Run "cd frontend && npm install && npm run build" to build the frontend.')
}

const BASE_RPC_URL = "https://sepolia.base.org"

// JWT Authentication for Builder API
const BUILDER_SECRET_PHRASE = process.env.BUILDER_SECRET_PHRASE || ""
if (!BUILDER_SECRET_PHRASE) {
  console.warn("⚠️  BUILDER_SECRET_PHRASE not set - Builder API authentication will be disabled")
  console.log("   Set BUILDER_SECRET_PHRASE environment variable to enable JWT authentication")
  console.log("   This should be a shared secret phrase between you and the builder")
}

// DynamoDB Service initialization
const DYNAMODB_REGION = "us-west-1"
const DYNAMODB_TABLE_NAME = "apix-iao-tokens"
const USER_REQUEST_TABLE_NAME = "apix-iao-user-requests"
const REQUEST_QUEUE_TABLE_NAME = "apix-iao-request-queue"
let dynamoDBService: DynamoDBService | null = null
let userRequestService: UserRequestService | null = null

try {
  dynamoDBService = new DynamoDBService(DYNAMODB_REGION, DYNAMODB_TABLE_NAME)
  const endpoint = process.env.DYNAMODB_ENDPOINT || "AWS (default)"
  console.log(`✅ DynamoDB service initialized (Region: ${DYNAMODB_REGION}, Table: ${DYNAMODB_TABLE_NAME}, Endpoint: ${endpoint})`)
  } catch (error) {
  console.error("⚠️  Failed to initialize DynamoDB service:", error)
  console.log("   Set DYNAMODB_REGION and DYNAMODB_TABLE_NAME environment variables if needed")
  console.log("   For local DynamoDB, set DYNAMODB_ENDPOINT=http://localhost:8000")
}

try {
  userRequestService = new UserRequestService(DYNAMODB_REGION, USER_REQUEST_TABLE_NAME, REQUEST_QUEUE_TABLE_NAME)
  console.log(`✅ UserRequest service initialized (UserRequest Table: ${USER_REQUEST_TABLE_NAME}, RequestQueue Table: ${REQUEST_QUEUE_TABLE_NAME})`)
  } catch (error) {
  console.error("⚠️  Failed to initialize UserRequest service:", error)
  console.log("   Set USER_REQUEST_TABLE_NAME and REQUEST_QUEUE_TABLE_NAME environment variables if needed")
}

// Metrics Service initialization
const METRICS_TABLE_NAME = "apix-iao-metrics"
let metricsService: MetricsService | null = null
try {
  metricsService = new MetricsService(DYNAMODB_REGION, METRICS_TABLE_NAME)
  console.log(`✅ Metrics service initialized (Table: ${METRICS_TABLE_NAME})`)
} catch (error) {
  console.error("⚠️  Failed to initialize Metrics service:", error)
  console.log("   Set METRICS_TABLE_NAME environment variable if needed")
}

// Agent Service initialization
const AGENTS_TABLE_NAME = "apix-iao-agents"
const CHAT_SESSIONS_TABLE_NAME = "apix-iao-chat-sessions"
const CHAT_MESSAGES_TABLE_NAME = "apix-iao-chat-messages"
const AGENT_PAYMENTS_TABLE_NAME = "apix-iao-agent-payments"
const METRICS_TABLE_NAME_FOR_AGENTS = "apix-iao-metrics" // For reference

let agentService: AgentService | null = null
let chatSessionService: ChatSessionService | null = null

try {
  agentService = new AgentService(DYNAMODB_REGION, AGENTS_TABLE_NAME)
  console.log(`✅ Agent service initialized (Table: ${AGENTS_TABLE_NAME})`)
} catch (error) {
  console.error("⚠️  Failed to initialize Agent service:", error)
  console.log("   Run CREATE_AGENT_TABLES.sh to create DynamoDB tables")
}

try {
  chatSessionService = new ChatSessionService(
    DYNAMODB_REGION,
    CHAT_SESSIONS_TABLE_NAME,
    CHAT_MESSAGES_TABLE_NAME
  )
  console.log(`✅ Chat session service initialized (Tables: ${CHAT_SESSIONS_TABLE_NAME}, ${CHAT_MESSAGES_TABLE_NAME})`)
} catch (error) {
  console.error("⚠️  Failed to initialize Chat session service:", error)
  console.log("   Run CREATE_AGENT_TABLES.sh to create DynamoDB tables")
}

// LLM Service initialization
let llmService: LLMService | null = null
try {
  llmService = new LLMService()
  const availableProviders = llmService.getAvailableProviders()
  if (availableProviders.length > 0) {
    console.log(`✅ LLM service initialized (Available providers: ${availableProviders.join(', ')})`)
  } else {
    console.warn("⚠️  No LLM providers configured. Set LLM API keys to enable agent chat:")
    console.log("   - ANTHROPIC_API_KEY for Claude (recommended)")
    console.log("   - OPENAI_API_KEY for GPT")
    console.log("   - GOOGLE_AI_API_KEY for Gemini")
  }
} catch (error) {
  console.error("⚠️  Failed to initialize LLM service:", error)
}

// Agent Tool Service initialization
let agentToolService: AgentToolService | null = null
try {
  // Determine backend URL (for self-referencing API calls)
  // Priority: BACKEND_URL env var > Vercel URL > localhost
  const backendUrl =
    process.env.BACKEND_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    `http://localhost:${process.env.PORT || 3000}`

  agentToolService = new AgentToolService(backendUrl)
  console.log(`✅ Agent tool service initialized with URL: ${backendUrl}`)
} catch (error) {
  console.error("⚠️  Failed to initialize Agent tool service:", error)
}

// Agent Payment Service initialization
let agentPaymentService: AgentPaymentService | null = null
try {
  agentPaymentService = new AgentPaymentService(
    DYNAMODB_REGION,
    AGENT_PAYMENTS_TABLE_NAME,
    process.env.THIRDWEB_SERVER_WALLET_ADDRESS
  )
  console.log(`✅ Agent payment service initialized (Table: ${AGENT_PAYMENTS_TABLE_NAME})`)
} catch (error) {
  console.error("⚠️  Failed to initialize Agent payment service:", error)
  console.log("   Run CREATE_AGENT_TABLES.sh to create DynamoDB tables")
}


/**
 * Extract user address from payment data (PAYMENT-SIGNATURE header - x402 V2)
 * The payment data is base64-encoded JSON containing the authorization
 */
function extractUserAddressFromPayment(paymentData: string): string | null {
  try {
    // Decode base64
    const decoded = Buffer.from(paymentData, 'base64').toString('utf-8')
    const paymentProof = JSON.parse(decoded)
    
    // Extract from address from authorization
    if (paymentProof?.payload?.authorization?.from) {
      return paymentProof.payload.authorization.from.toLowerCase()
    }
    
    return null
  } catch (error) {
    console.error("Error extracting user address from payment data:", error)
    return null
  }
}

// IAO Token Types (internal representation for proxy logic)
interface IAOTokenEntry {
  id: string                // Token address (used as identifier)
  slug: string              // Unique server slug (e.g., "magpie")
  builder: string           // Builder address
  name: string              // Token/server name
  symbol: string            // Token symbol
  subscriptionCount?: string // Total usage count (aggregated across all APIs)
  paymentToken: string      // Payment token address (e.g., USDC)
  tags?: string[]           // Array of category tags
  apis: ApiEntry[]          // Array of registered APIs (each with own fee)
}

/**
 * Get IAO token entry by token address (id) from DynamoDB
 */
async function getIAOTokenEntry(tokenAddress: string): Promise<IAOTokenEntry | null> {
  const addressLower = tokenAddress.toLowerCase()

  if (!dynamoDBService) {
    console.error("DynamoDB service not configured")
    return null
  }

  try {
    const dbEntry = await dynamoDBService.getItem(addressLower)
    if (dbEntry) {
      // Convert DynamoDB entry to IAOTokenEntry format
      const tokenEntry: IAOTokenEntry = {
        id: dbEntry.id,
        slug: dbEntry.slug,
        builder: dbEntry.builder,
        name: dbEntry.name,
        symbol: dbEntry.symbol,
        subscriptionCount: dbEntry.subscriptionCount,
        paymentToken: dbEntry.paymentToken,
        tags: dbEntry.tags,
        apis: dbEntry.apis || [],
      }
      console.log(`✅ Found IAO token in DynamoDB: ${addressLower} (slug: ${dbEntry.slug}, ${dbEntry.apis?.length || 0} APIs)`)
      return tokenEntry
    }
    console.log(`❌ No IAO token entry found for ${addressLower}`)
    return null
  } catch (error) {
    console.error(`Error querying DynamoDB for ${addressLower}:`, error)
    return null
  }
}

/**
 * Get IAO token entry by server slug from DynamoDB
 */
async function getIAOTokenEntryBySlug(serverSlug: string): Promise<IAOTokenEntry | null> {
  if (!dynamoDBService) {
    console.error("DynamoDB service not configured")
    return null
  }

  try {
    const dbEntry = await dynamoDBService.getItemBySlug(serverSlug)
    if (dbEntry) {
      const tokenEntry: IAOTokenEntry = {
        id: dbEntry.id,
        slug: dbEntry.slug,
        builder: dbEntry.builder,
        name: dbEntry.name,
        symbol: dbEntry.symbol,
        subscriptionCount: dbEntry.subscriptionCount,
        paymentToken: dbEntry.paymentToken,
        tags: dbEntry.tags,
        apis: dbEntry.apis || [],
      }
      console.log(`✅ Found IAO token by slug: ${serverSlug} (${dbEntry.apis?.length || 0} APIs)`)
      return tokenEntry
    }
    console.log(`❌ No IAO token entry found for slug: ${serverSlug}`)
    return null
  } catch (error) {
    console.error(`Error querying DynamoDB for slug ${serverSlug}:`, error)
    return null
  }
}

/**
 * Get a specific API from a token by slug
 */
function getApiFromTokenBySlug(token: IAOTokenEntry, apiSlug: string): ApiEntry | null {
  if (!token.apis || token.apis.length === 0) {
    return null
  }
  return token.apis.find(api => api.slug === apiSlug.toLowerCase()) || null
}

/**
 * Get a specific API from a token by index
 */
function getApiFromToken(token: IAOTokenEntry, apiIndex: number): ApiEntry | null {
  if (!token.apis || token.apis.length === 0) {
    return null
  }
  return token.apis.find(api => api.index === apiIndex) || null
}

/**
 * Sanitize API entry for public response (hide builder endpoint URL)
 */
function sanitizeApiForPublic(api: ApiEntry): Omit<ApiEntry, 'apiUrl'> {
  const { apiUrl, ...publicApi } = api
  return publicApi
}

/**
 * Sanitize array of API entries for public response
 */
function sanitizeApisForPublic(apis: ApiEntry[]): Omit<ApiEntry, 'apiUrl'>[] {
  return apis.map(sanitizeApiForPublic)
}


// Thirdweb facilitator setup for /api/* routes
// Create thirdweb client and facilitator instance
// NOTE: serverWalletAddress is required for facilitator initialization but payments 
// will be routed to individual token addresses (payTo parameter in settlePayment)
// See: https://portal.thirdweb.com/x402/facilitator
let thirdwebClient: any = null
let thirdwebFacilitator: any = null

if (process.env.THIRDWEB_SECRET_KEY && process.env.THIRDWEB_SERVER_WALLET_ADDRESS) {
  try {
    thirdwebClient = createThirdwebClient({
      secretKey: process.env.THIRDWEB_SECRET_KEY,
    })

    thirdwebFacilitator = thirdwebFacilitatorFn({
      client: thirdwebClient,
      serverWalletAddress: process.env.THIRDWEB_SERVER_WALLET_ADDRESS,
      // Optional: waitUntil can be "simulated", "submitted", or "confirmed" (default)
      waitUntil: "confirmed",
    })

    console.log("✅ Thirdweb facilitator initialized for /api/* endpoints")
    console.log(`   Note: Payments will be routed to individual token addresses`)
  } catch (error) {
    console.error("⚠️  Failed to initialize Thirdweb facilitator:", error)
    console.log("   Set THIRDWEB_SECRET_KEY and THIRDWEB_SERVER_WALLET_ADDRESS to enable Thirdweb facilitator")
  }
} else {
  console.log("⚠️  Thirdweb credentials not found - /api/* routes will not process payments")
  console.log("   Set THIRDWEB_SECRET_KEY and THIRDWEB_SERVER_WALLET_ADDRESS to enable Thirdweb facilitator")
  console.log("   Get your secret key from: https://portal.thirdweb.com")
  console.log("   Get your server wallet address from your project dashboard")
}

/**
 * Validate slug format: lowercase alphanumeric with hyphens, 3-30 chars
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)
}

/**
 * Valid category tags for API servers
 */
const VALID_CATEGORY_TAGS = [
  'crypto',
  'blockchain',
  'ai',
  'ml',
  'trading',
  'data',
  'analytics',
  'infrastructure',
  'social',
  'media',
  'finance',
  'gaming',
] as const

type CategoryTag = typeof VALID_CATEGORY_TAGS[number]

/**
 * Validate category tags
 */
function validateTags(tags: any): string[] | null {
  if (!tags) return []
  if (!Array.isArray(tags)) return null
  
  const normalizedTags: string[] = []
  for (const tag of tags) {
    if (typeof tag !== 'string') return null
    const normalizedTag = tag.toLowerCase().trim()
    if (!normalizedTag) continue
    
    // Check if tag is valid
    if (!VALID_CATEGORY_TAGS.includes(normalizedTag as CategoryTag)) {
      return null // Invalid tag found
    }
    
    // Avoid duplicates
    if (!normalizedTags.includes(normalizedTag)) {
      normalizedTags.push(normalizedTag)
    }
  }
  
  return normalizedTags.length > 0 ? normalizedTags : []
}

/**
 * Verify EIP-3009 payment authorization signature
 * This validates the signature WITHOUT executing the transfer
 */
async function verifyPaymentAuthorization(paymentData: string, expectedPayTo: string, expectedAmount: string, paymentToken: string): Promise<{ valid: boolean; userAddress?: string; error?: string }> {
  try {
    // Decode payment data
    const decoded = Buffer.from(paymentData, 'base64').toString('utf-8')
    const paymentProof = JSON.parse(decoded)
    
    const authorization = paymentProof?.payload?.authorization
    const signature = paymentProof?.payload?.signature
    
    if (!authorization || !signature) {
      return { valid: false, error: 'Missing authorization or signature' }
    }
    
    // Verify recipient matches
    if (authorization.to.toLowerCase() !== expectedPayTo.toLowerCase()) {
      return { valid: false, error: `Payment recipient mismatch: expected ${expectedPayTo}, got ${authorization.to}` }
    }
    
    // Verify amount matches
    if (authorization.value !== expectedAmount) {
      return { valid: false, error: `Payment amount mismatch: expected ${expectedAmount}, got ${authorization.value}` }
    }
    
    // Verify timing validity (validAfter <= now <= validBefore)
    const now = Math.floor(Date.now() / 1000)
    const validAfter = parseInt(authorization.validAfter)
    const validBefore = parseInt(authorization.validBefore)
    
    if (now < validAfter) {
      return { valid: false, error: 'Payment authorization not yet valid' }
    }
    
    if (now > validBefore) {
      return { valid: false, error: 'Payment authorization expired' }
    }
    
    // TODO: Optionally verify EIP-712 signature on-chain or off-chain
    // For now, we trust the signature since thirdweb will execute it
    
    return { 
      valid: true, 
      userAddress: authorization.from.toLowerCase() 
    }
  } catch (error: any) {
    return { valid: false, error: error.message || 'Failed to verify payment authorization' }
  }
}

/**
 * Execute EIP-3009 payment transfer using thirdweb facilitator
 * This should only be called AFTER builder successfully returns data
 */
async function executePaymentTransfer(
  paymentData: string, 
  paymentToken: string,
  req: any,
  tokenAddress: string,
  fee: string, // API-specific fee
  serverSlug: string,
  apiSlug: string,
  apiName: string
): Promise<{ success: boolean; txHash?: string; error?: string; paymentReceipt?: any }> {
  try {
    if (!thirdwebFacilitator || !thirdwebClient) {
      return { success: false, error: 'Thirdweb facilitator not initialized' }
    }
    
    // Normalize HTTP method
    let normalizedMethod = req.method.toUpperCase()
    if (normalizedMethod === 'HEAD') {
      normalizedMethod = 'GET'
    }
    const supportedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    if (!supportedMethods.includes(normalizedMethod)) {
      normalizedMethod = 'GET'
    }
    
    // Calculate price string
    const feeWei = BigInt(fee)
    const feeUSD = Number(feeWei) / 1e6
    const priceString = `$${feeUSD.toFixed(2)}`
    
    console.log('💳 Calling settlePayment AFTER builder success:', {
      resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      method: normalizedMethod,
      payTo: tokenAddress,
      price: priceString,
      hasPaymentData: !!paymentData,
      timestamp: new Date().toISOString()
    })
    
    // Use thirdweb's settlePayment to execute the transfer
    const paymentResult = await settlePayment({
      resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      method: normalizedMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      paymentData,
      payTo: tokenAddress,  // Payment goes to token address (ORIGINAL)
      network: baseSepolia,
      price: priceString,
      facilitator: thirdwebFacilitator,
      routeConfig: {
        description: `IAO Proxy - ${serverSlug}/${apiSlug} - ${apiName}`,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      },
    })
    
    console.log('📊 settlePayment result:', {
      status: paymentResult.status,
      hasPaymentReceipt: paymentResult.status === 200 && !!paymentResult.paymentReceipt,
      timestamp: new Date().toISOString()
    })
    
    if (paymentResult.status === 200) {
      console.log('✅ Payment settled successfully!')
      return { 
        success: true, 
        txHash: paymentResult.paymentReceipt?.transaction,
        paymentReceipt: paymentResult.paymentReceipt
      }
    } else {
      const errorBody = (paymentResult as any).responseBody
      console.error('❌ Payment settlement failed:', {
        status: paymentResult.status,
        errorBody: JSON.stringify(errorBody, null, 2),
        timestamp: new Date().toISOString()
      })
      return { 
        success: false, 
        error: errorBody?.errorMessage || 'Payment settlement returned non-200 status',
        txHash: undefined
      }
    }
  } catch (error: any) {
    console.error("Error in executePaymentTransfer:", error)
    return { success: false, error: error.message || 'Failed to execute payment transfer' }
  }
}

/**
 * POST /api/register - Register a new IAO token with one or more API endpoints
 * 
 * This endpoint can be called in two modes:
 * 1. VALIDATION MODE (tokenAddress missing): Validates data BEFORE transaction signing
 * 2. REGISTRATION MODE (tokenAddress present): Stores token in DynamoDB AFTER transaction
 * 
 * Request body (validation mode):
 * {
 *   slug: string (server slug, e.g., "magpie"),
 *   apis: [{ slug: string, apiUrl: string, fee: string }],
 *   builder: string (0x...),
 * }
 * 
 * Request body (registration mode):
 * {
 *   tokenAddress: string (0x...),
 *   slug: string (server slug, e.g., "magpie"),
 *   name: string,
 *   symbol: string,
 *   apis: [{ slug: string, name: string, apiUrl: string, description: string, fee: string }],
 *   builder: string (0x...),
 *   paymentToken: string (0x...),
 * }
 */
app.post('/api/register', async (req, res) => {
  try {
    const {
      tokenAddress,  // Optional - if missing, just validate
      serverSlug,     // Server slug (e.g., "magpie") - comes as "serverSlug" from frontend
      slug = serverSlug, // Backwards compatibility: accept both "slug" and "serverSlug"
      name,
      symbol,
      apis,       // Array of APIs with individual fees
      builder,
      paymentToken,
      tags,       // Array of category tags (optional)
    } = req.body

    // VALIDATION MODE: If tokenAddress is missing, just validate and return
    if (!tokenAddress) {
      // Validate required fields for validation mode
      if (!slug || !apis || !builder) {
        return res.status(400).json({
          error: "Missing required fields",
          message: "slug (or serverSlug), apis, and builder are required for validation"
        })
      }

      // Validate server slug format
      const finalServerSlug = slug.toLowerCase()
      if (!isValidSlug(finalServerSlug)) {
        return res.status(400).json({
          error: "Invalid server slug",
          message: "Server slug must be 3-30 characters, lowercase alphanumeric with hyphens"
        })
      }

      // Validate at least one API is provided
      if (!Array.isArray(apis) || apis.length === 0) {
        return res.status(400).json({
          error: "Missing API endpoints",
          message: "'apis' array with at least one API is required"
        })
      }

      // Validate address format
      const addressRegex = /^0x[a-fA-F0-9]{40}$/i
      if (!addressRegex.test(builder)) {
        return res.status(400).json({
          error: "Invalid address format",
          message: "builder must be a valid Ethereum address"
        })
      }

      // Check if DynamoDB is configured
      if (!dynamoDBService) {
        return res.status(503).json({
          error: "DynamoDB not configured",
          message: "DynamoDB service is not available"
        })
      }

      // Check if server slug already exists
      const existingBySlug = await dynamoDBService.getItemBySlug(finalServerSlug)
      if (existingBySlug) {
        return res.status(409).json({
          error: "Server slug already taken",
          message: `The slug "${finalServerSlug}" is already registered. Please choose a different slug.`
        })
      }

      // Check if builder already has a server registered
      const existingTokens = await dynamoDBService.scanItemsByBuilder(builder)
      if (existingTokens.length > 0) {
        const existingToken = existingTokens[0]
        return res.status(409).json({
          error: "You already have an active server",
          message: `This address already has a registered server. Use /api/add-api to add more APIs.`,
          existingServerSlug: existingToken.slug,
          existingServerName: existingToken.name,
        })
      }

      // Validate API fields and check for duplicates
      const apiUrls: string[] = []
      const apiSlugs = new Set<string>()

      for (let i = 0; i < apis.length; i++) {
        const api = apis[i]
        
        // Validate required API fields
        if (!api.slug || !api.apiUrl || !api.fee) {
          return res.status(400).json({
            error: "Invalid API entry",
            message: `API at index ${i} is missing required fields (slug, apiUrl, fee)`
          })
        }

        // Validate fee is a positive number
        try {
          const fee = BigInt(api.fee)
          if (fee <= 0n) {
            return res.status(400).json({
              error: "Invalid API fee",
              message: `API at index ${i} must have a positive fee`
            })
          }
        } catch {
          return res.status(400).json({
            error: "Invalid fee format",
            message: `API at index ${i} has invalid fee format`
          })
        }

        // Validate API slug format
        const apiSlug = api.slug.toLowerCase()
        if (!isValidSlug(apiSlug)) {
          return res.status(400).json({
            error: "Invalid API slug",
            message: `API at index ${i} has invalid slug. Must be 3-30 characters, lowercase alphanumeric with hyphens.`
          })
        }

        // Check for duplicate API slugs within this registration
        if (apiSlugs.has(apiSlug)) {
          return res.status(400).json({
            error: "Duplicate API slug",
            message: `API slug "${apiSlug}" is used more than once. Each API must have a unique slug.`
          })
        }
        apiSlugs.add(apiSlug)

        // Validate URL format
        try {
          new URL(api.apiUrl)
          apiUrls.push(api.apiUrl)
        } catch {
          return res.status(400).json({
            error: "Invalid API URL",
            message: `API at index ${i} has invalid URL: ${api.apiUrl}`
          })
        }

        // Validate API endpoint returns 200 status code
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
          
          const response = await fetch(api.apiUrl, {
            method: 'GET',
            headers: {
              'User-Agent': 'IAO-Proxy/1.0',
              'Accept': 'application/json, */*',
            },
            signal: controller.signal,
          })
          
          clearTimeout(timeoutId)
          
          if (response.status !== 200) {
            return res.status(400).json({
              error: "API endpoint validation failed",
              message: `API at index ${i} (${api.apiUrl}) returned status code ${response.status} instead of 200. Please ensure your API endpoint is accessible and returns a 200 status code.`
            })
          }
        } catch (fetchError: any) {
          if (fetchError.name === 'AbortError') {
            return res.status(400).json({
              error: "API endpoint timeout",
              message: `API at index ${i} (${api.apiUrl}) did not respond within 10 seconds. Please ensure your API endpoint is accessible.`
            })
          }
          
          return res.status(400).json({
            error: "API endpoint validation failed",
            message: `API at index ${i} (${api.apiUrl}) is not accessible: ${fetchError.message || 'Connection failed'}. Please ensure your API endpoint is publicly accessible and returns a 200 status code.`
          })
        }
      }

      // Check if any API URLs are already registered globally
      const duplicateApis = await dynamoDBService.checkApiUrlsDuplicate(apiUrls)
      if (duplicateApis.length > 0) {
        return res.status(409).json({
          error: "Duplicate API URL(s)",
          message: `The following API endpoint(s) are already registered: ${duplicateApis.map(d => d.url).join(', ')}`,
          duplicates: duplicateApis.map(d => ({
            url: d.url,
            registeredOn: d.serverSlug
          }))
        })
      }

      // Validate tags if provided
      if (tags !== undefined) {
        const validatedTags = validateTags(tags)
        if (validatedTags === null) {
          return res.status(400).json({
            error: "Invalid tags",
            message: `Tags must be an array of valid category strings. Valid categories: ${VALID_CATEGORY_TAGS.join(', ')}`
          })
        }
      }

      // All validation checks passed
      return res.status(200).json({
        success: true,
        message: "All validation checks passed. You can proceed with token creation.",
        serverSlug: finalServerSlug,
        apiCount: apis.length
      })
    }

    // REGISTRATION MODE: tokenAddress is present, proceed with full registration
    // Validate required fields for registration mode
    if (!slug || !name || !symbol || !builder || !paymentToken) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "slug (or serverSlug), name, symbol, builder, and paymentToken are required"
      })
    }

    // Validate tags if provided
    let validatedTags: string[] = []
    if (tags !== undefined) {
      const tagsResult = validateTags(tags)
      if (tagsResult === null) {
        return res.status(400).json({
          error: "Invalid tags",
          message: `Tags must be an array of valid category strings. Valid categories: ${VALID_CATEGORY_TAGS.join(', ')}`
        })
      }
      validatedTags = tagsResult
    }

    // Validate server slug format
    const finalServerSlug = slug.toLowerCase()
    if (!isValidSlug(finalServerSlug)) {
      return res.status(400).json({
        error: "Invalid server slug",
        message: "Server slug must be 3-30 characters, lowercase alphanumeric with hyphens, starting and ending with alphanumeric"
      })
    }

    // Validate at least one API is provided
    if (!apis || !Array.isArray(apis) || apis.length === 0) {
      return res.status(400).json({
        error: "Missing API endpoints",
        message: "'apis' array with at least one API is required"
      })
    }

    // Validate address format
    const addressRegex = /^0x[a-fA-F0-9]{40}$/i
    if (!addressRegex.test(tokenAddress) || !addressRegex.test(builder) || !addressRegex.test(paymentToken)) {
      return res.status(400).json({
        error: "Invalid address format",
        message: "tokenAddress, builder, and paymentToken must be valid Ethereum addresses"
      })
    }

    // Check if DynamoDB is configured
    if (!dynamoDBService) {
      return res.status(503).json({
        error: "DynamoDB not configured",
        message: "DynamoDB service is not available. Please configure DYNAMODB_REGION and DYNAMODB_TABLE_NAME"
      })
    }

    // Check if server slug already exists
    const existingBySlug = await dynamoDBService.getItemBySlug(finalServerSlug)
    if (existingBySlug) {
      return res.status(409).json({
        error: "Server slug already taken",
        message: `The slug "${finalServerSlug}" is already registered. Please choose a different slug.`
      })
    }

    // Check if builder already has a server registered (1 builder = 1 server restriction)
    const existingTokens = await dynamoDBService.scanItemsByBuilder(builder)
    if (existingTokens.length > 0) {
      const existingToken = existingTokens[0]
      return res.status(409).json({
        error: "You already have an active server",
        message: `This address already has a registered server. Use /api/add-api to add more APIs to your existing server.`,
        existingServerSlug: existingToken.slug,
        existingServerName: existingToken.name,
      })
    }

    // Check if token address already exists
    const existingToken = await dynamoDBService.getItem(tokenAddress.toLowerCase())
    if (existingToken) {
      return res.status(409).json({
        error: "Token already registered",
        message: `Token ${tokenAddress} is already registered.`,
        token: {
          slug: existingToken.slug,
          name: existingToken.name,
        }
      })
    }

    // Check if any API URLs are already registered globally
    const apiUrls = apis.map((api: any) => api.apiUrl).filter((url: string) => url)
    const duplicateApis = await dynamoDBService.checkApiUrlsDuplicate(apiUrls)
    if (duplicateApis.length > 0) {
      return res.status(409).json({
        error: "Duplicate API URL(s)",
        message: `The following API endpoint(s) are already registered: ${duplicateApis.map(d => d.url).join(', ')}`,
        duplicates: duplicateApis.map(d => ({
          url: d.url,
          registeredOn: d.serverSlug
        }))
      })
    }

    // Build apis array with validation
    const apiEntries: ApiEntry[] = []
    const apiSlugs = new Set<string>()
    const now = new Date().toISOString()

    for (let i = 0; i < apis.length; i++) {
      const api = apis[i]
      
      // Validate required API fields
      if (!api.slug || !api.name || !api.apiUrl || !api.description || !api.fee) {
        return res.status(400).json({
          error: "Invalid API entry",
          message: `API at index ${i} is missing required fields (slug, name, apiUrl, description, fee)`
        })
      }

      // Validate fee is a positive number
      const fee = BigInt(api.fee)
      if (fee <= 0n) {
        return res.status(400).json({
          error: "Invalid API fee",
          message: `API at index ${i} must have a positive fee`
        })
      }

      // Validate API slug format
      const apiSlug = api.slug.toLowerCase()
      if (!isValidSlug(apiSlug)) {
        return res.status(400).json({
          error: "Invalid API slug",
          message: `API at index ${i} has invalid slug. Must be 3-30 characters, lowercase alphanumeric with hyphens.`
        })
      }

      // Check for duplicate API slugs within this registration
      if (apiSlugs.has(apiSlug)) {
        return res.status(400).json({
          error: "Duplicate API slug",
          message: `API slug "${apiSlug}" is used more than once. Each API must have a unique slug.`
        })
      }
      apiSlugs.add(apiSlug)

      // Validate URL format
      try {
        new URL(api.apiUrl)
      } catch {
        return res.status(400).json({
          error: "Invalid API URL",
          message: `API at index ${i} has invalid URL: ${api.apiUrl}`
        })
      }

      // Validate API endpoint returns 200 status code (only in registration mode)
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
        
        const response = await fetch(api.apiUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'IAO-Proxy/1.0',
            'Accept': 'application/json, */*',
          },
          signal: controller.signal,
        })
        
        clearTimeout(timeoutId)
        
        if (response.status !== 200) {
          return res.status(400).json({
            error: "API endpoint validation failed",
            message: `API at index ${i} (${api.apiUrl}) returned status code ${response.status} instead of 200. Please ensure your API endpoint is accessible and returns a 200 status code.`
          })
        }
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') {
          return res.status(400).json({
            error: "API endpoint timeout",
            message: `API at index ${i} (${api.apiUrl}) did not respond within 10 seconds. Please ensure your API endpoint is accessible.`
          })
        }
        
        return res.status(400).json({
          error: "API endpoint validation failed",
          message: `API at index ${i} (${api.apiUrl}) is not accessible: ${fetchError.message || 'Connection failed'}. Please ensure your API endpoint is publicly accessible and returns a 200 status code.`
        })
      }

      apiEntries.push({
        index: i,
        slug: apiSlug,
        name: api.name,
        apiUrl: api.apiUrl,
        description: api.description,
        fee: api.fee,
        createdAt: now,
      })
    }

    // Create token entry
    const tokenEntry: IAOTokenDBEntry = {
      id: tokenAddress.toLowerCase(),
      slug: finalServerSlug,
      name,
      symbol,
      apis: apiEntries,
      builder: builder.toLowerCase(),
      paymentToken: paymentToken.toLowerCase(),
      subscriptionCount: "0",
      refundCount: "0",
      fulfilledCount: "0",
      tags: validatedTags.length > 0 ? validatedTags : undefined,
      createdAt: now,
      updatedAt: now,
    }

    // Store in DynamoDB
    await dynamoDBService.putItem(tokenEntry)

    console.log(`✅ Registered new server: ${finalServerSlug} (${name}/${symbol}) with ${apiEntries.length} API(s)`)

    return res.status(201).json({
      success: true,
      message: `Server registered successfully with ${apiEntries.length} API(s)`,
      token: {
        id: tokenEntry.id,
        slug: tokenEntry.slug,
        name: tokenEntry.name,
        symbol: tokenEntry.symbol,
        apis: sanitizeApisForPublic(apiEntries), // Hide apiUrl from response
        builder: tokenEntry.builder,
        paymentToken: tokenEntry.paymentToken,
      }
    })
  } catch (error: any) {
    console.error("Error registering token:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to register token"
    })
  }
})

/**
 * POST /api/add-api - Add a new API to an existing server
 * 
 * This endpoint allows builders to add more APIs to their existing server.
 * The new API will be assigned the next available index.
 * 
 * Request body:
 * {
 *   serverSlug: string (e.g., "magpie"),
 *   slug: string (API slug, e.g., "pool-snapshot"),
 *   name: string,
 *   apiUrl: string,
 *   description: string,
 *   builder: string (0x...) // For verification
 * }
 */
app.post('/api/add-api', async (req, res) => {
  try {
    const {
      serverSlug,
      slug,
      name,
      apiUrl,
      description,
      fee,
      builder,
    } = req.body

    // Validate required fields
    if (!serverSlug || !slug || !name || !apiUrl || !description || !fee || !builder) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "serverSlug, slug, name, apiUrl, description, fee, and builder are required"
      })
    }

    // Validate fee is a positive number
    try {
      const feeAmount = BigInt(fee)
      if (feeAmount <= 0n) {
        return res.status(400).json({
          error: "Invalid fee",
          message: "Fee must be a positive number"
        })
      }
    } catch {
      return res.status(400).json({
        error: "Invalid fee format",
        message: "Fee must be a valid number string"
      })
    }

    // Validate API slug format
    const apiSlug = slug.toLowerCase()
    if (!isValidSlug(apiSlug)) {
      return res.status(400).json({
        error: "Invalid API slug",
        message: "API slug must be 3-30 characters, lowercase alphanumeric with hyphens"
      })
    }

    // Validate address format
    const addressRegex = /^0x[a-fA-F0-9]{40}$/i
    if (!addressRegex.test(builder)) {
      return res.status(400).json({
        error: "Invalid address format",
        message: "builder must be a valid Ethereum address"
      })
    }

    // Validate URL format
    try {
      new URL(apiUrl)
    } catch {
      return res.status(400).json({
        error: "Invalid API URL",
        message: "apiUrl must be a valid URL"
      })
    }

    // Validate API endpoint returns 200 status code
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'IAO-Proxy/1.0',
          'Accept': 'application/json, */*',
        },
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      if (response.status !== 200) {
        return res.status(400).json({
          error: "API endpoint validation failed",
          message: `API endpoint (${apiUrl}) returned status code ${response.status} instead of 200. Please ensure your API endpoint is accessible and returns a 200 status code.`
        })
      }
    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        return res.status(400).json({
          error: "API endpoint timeout",
          message: `API endpoint (${apiUrl}) did not respond within 10 seconds. Please ensure your API endpoint is accessible.`
        })
      }
      
      return res.status(400).json({
        error: "API endpoint validation failed",
        message: `API endpoint (${apiUrl}) is not accessible: ${fetchError.message || 'Connection failed'}. Please ensure your API endpoint is publicly accessible and returns a 200 status code.`
      })
    }

    // Check if DynamoDB is configured
    if (!dynamoDBService) {
      return res.status(503).json({
        error: "DynamoDB not configured",
        message: "DynamoDB service is not available"
      })
    }

    // Get existing token by slug
    const existingToken = await dynamoDBService.getItemBySlug(serverSlug.toLowerCase())
    if (!existingToken) {
      return res.status(404).json({
        error: "Server not found",
        message: `Server "${serverSlug}" is not registered. Use /api/register first.`
      })
    }

    // Verify builder ownership
    if (existingToken.builder.toLowerCase() !== builder.toLowerCase()) {
      return res.status(403).json({
        error: "Unauthorized",
        message: "Only the server owner can add APIs"
      })
    }

    // Check if API slug already exists in this server
    if (existingToken.apis?.some(api => api.slug === apiSlug)) {
      return res.status(409).json({
        error: "API slug already exists",
        message: `API slug "${apiSlug}" already exists in server "${serverSlug}". Choose a different slug.`
      })
    }

    // Check if API URL already exists globally
    const existingApiUrl = await dynamoDBService.apiUrlExists(apiUrl)
    if (existingApiUrl.exists) {
      return res.status(409).json({
        error: "Duplicate API URL",
        message: `This API endpoint is already registered on server "${existingApiUrl.serverSlug}".`
      })
    }

    // Add new API
    const newApi = await dynamoDBService.addApiToToken(
      existingToken.id,
      apiSlug,
      name,
      apiUrl,
      description,
      fee
    )

    if (!newApi) {
      return res.status(500).json({
        error: "Failed to add API",
        message: "An error occurred while adding the API"
      })
    }

    console.log(`✅ Added API to server ${serverSlug}: ${name} (slug: ${apiSlug})`)

    return res.status(201).json({
      success: true,
      message: "API added successfully",
      api: sanitizeApiForPublic(newApi), // Hide apiUrl from response
      serverSlug: serverSlug.toLowerCase(),
    })
  } catch (error: any) {
    console.error("Error adding API:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to add API"
    })
  }
})

/**
 * GET /api/server/:slug - Get server metadata by slug (no payment required)
 * 
 * Returns server/token information from DynamoDB without processing payment.
 * Includes all registered APIs under this server (apiUrl hidden for security).
 * 
 * @param slug - Server slug (e.g., "magpie")
 */
app.get('/api/server/:slug', async (req, res) => {
  const serverSlug = req.params.slug.toLowerCase()

  try {
    const tokenEntry = await getIAOTokenEntryBySlug(serverSlug)

    if (!tokenEntry) {
      return res.status(404).json({
        error: "Server not found",
        message: `No server registered with slug "${serverSlug}"`
      })
    }

    return res.status(200).json({
      success: true,
      server: {
        id: tokenEntry.id,
        slug: tokenEntry.slug,
        name: tokenEntry.name,
        symbol: tokenEntry.symbol,
        builder: tokenEntry.builder,
        paymentToken: tokenEntry.paymentToken,
        subscriptionCount: tokenEntry.subscriptionCount || "0",
        tags: tokenEntry.tags || [],
        apis: tokenEntry.apis ? sanitizeApisForPublic(tokenEntry.apis) : [],
        apiCount: tokenEntry.apis?.length || 0,
      }
    })
  } catch (error: any) {
    console.error("Error fetching server:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to fetch server"
    })
  }
})

/**
 * GET /api/servers - Get all registered servers
 * Returns all servers from DynamoDB
 */
app.get('/api/servers', async (req, res) => {
  try {
    if (!dynamoDBService) {
      return res.status(503).json({
        error: "DynamoDB not configured",
        message: "DynamoDB service is not available"
      })
    }

    const tokens = await dynamoDBService.scanAllItems()
    // Sanitize tokens to hide builder endpoints
    const sanitizedServers = tokens.map(token => ({
      id: token.id,
      slug: token.slug,
      name: token.name,
      symbol: token.symbol,
      builder: token.builder,
      paymentToken: token.paymentToken,
      subscriptionCount: token.subscriptionCount,
      tags: token.tags || [],
      apis: token.apis ? sanitizeApisForPublic(token.apis) : [],
      apiCount: token.apis?.length || 0,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    }))
    return res.status(200).json({
      success: true,
      count: sanitizedServers.length,
      servers: sanitizedServers
    })
  } catch (error: any) {
    console.error("Error fetching all servers:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to fetch servers"
    })
  }
})

/**
 * GET /api/transactions - Get recent transactions across all servers
 * Returns recent API call transactions sorted by time
 */
app.get('/api/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    
    if (!userRequestService) {
      return res.status(503).json({
        error: "Service not available",
        message: "Transaction service is not configured"
      });
    }

    if (!dynamoDBService) {
      return res.status(503).json({
        error: "Service not available",
        message: "Server data service is not configured"
      });
    }

    // Get recent transactions
    const recentTransactions = await userRequestService.getRecentTransactions(limit);

    // Enrich transaction data with server information
    const enrichedTransactions = await Promise.all(
      recentTransactions.map(async (tx) => {
        try {
          const serverData = await dynamoDBService!.getItem(tx.iaoToken);
          return {
            id: tx.id,
            iaoToken: tx.iaoToken,
            from: tx.from,
            globalRequestNumber: tx.globalRequestNumber,
            fee: tx.fee,
            createdAt: tx.createdAt,
            server: serverData ? {
              slug: serverData.slug,
              name: serverData.name,
              symbol: serverData.symbol,
            } : null,
          };
        } catch (error) {
          console.error(`Error enriching transaction ${tx.id}:`, error);
          return {
            id: tx.id,
            iaoToken: tx.iaoToken,
            from: tx.from,
            globalRequestNumber: tx.globalRequestNumber,
            fee: tx.fee,
            createdAt: tx.createdAt,
            server: null,
          };
        }
      })
    );

    return res.status(200).json({
      success: true,
      count: enrichedTransactions.length,
      transactions: enrichedTransactions,
    });
  } catch (error: any) {
    console.error("Error fetching transactions:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to fetch transactions"
    });
  }
})

/**
 * GET /api/metrics/:serverSlug - Get metrics for a server
 * Returns aggregated metrics including API calls, revenue, latency, and contract metrics
 */
app.get('/api/metrics/:serverSlug', async (req, res) => {
  const serverSlug = req.params.serverSlug.toLowerCase()

  try {
    const tokenEntry = await getIAOTokenEntryBySlug(serverSlug)
    if (!tokenEntry) {
      return res.status(404).json({
        error: "Server not found",
        message: `No server registered with slug "${serverSlug}"`
      })
    }

    // Get server metrics from DynamoDB
    let serverMetrics = null
    if (metricsService) {
      serverMetrics = await metricsService.getServerMetrics(tokenEntry.id)
    }

    // Get contract metrics (bonding progress, token distribution)
    let contractMetrics = null
    let paymentTokenPrice: bigint | null = null
    let paymentTokenDecimals: number | null = null
    
    try {
      if (!thirdwebClient) {
        console.warn(`⚠️  Thirdweb client not initialized - cannot fetch contract metrics for ${tokenEntry.id}`)
        throw new Error("Thirdweb client not initialized")
      }
      
      if (IAOTokenABI.length === 0) {
        console.warn(`⚠️  IAOToken ABI not loaded - cannot fetch contract metrics for ${tokenEntry.id}`)
        throw new Error("IAOToken ABI not loaded")
      }
      
      console.log(`📊 Fetching contract metrics for token: ${tokenEntry.id}`)
      
      const tokenContract = getContract({
        client: thirdwebClient,
        chain: baseSepolia,
        address: tokenEntry.id,
        abi: IAOTokenABI,
      })

        // Also fetch payment token info from factory for token amount calculation
        if (IAOTokenFactoryABI.length > 0 && IAO_FACTORY_ADDRESS && IAO_FACTORY_ADDRESS.length === 42) {
          try {
            const factoryContract = getContract({
              client: thirdwebClient,
              chain: baseSepolia,
              address: IAO_FACTORY_ADDRESS,
              abi: IAOTokenFactoryABI,
            })
            
            const paymentTokenInfo = await readContract({
              contract: factoryContract,
              method: "paymentTokenInfo",
              params: [tokenEntry.paymentToken],
            })
            
            // paymentTokenInfo returns: [price, paymentToken, paymentTokenDecimals, graduationThreshold, sqrtPriceX96Token0, sqrtPriceX96Token1]
            if (paymentTokenInfo && Array.isArray(paymentTokenInfo) && paymentTokenInfo.length >= 3) {
              paymentTokenPrice = BigInt(paymentTokenInfo[0].toString())
              paymentTokenDecimals = Number(paymentTokenInfo[2].toString())
            }
          } catch (factoryError) {
            console.warn("⚠️  Failed to fetch payment token info from factory:", factoryError)
          }
        }

        const [graduationThreshold, totalTokensDistributed, totalFeesCollected, liquidityDeployed] = await Promise.all([
          readContract({ contract: tokenContract, method: "graduationThreshold", params: [] }),
          readContract({ contract: tokenContract, method: "totalTokensDistributed", params: [] }),
          readContract({ contract: tokenContract, method: "totalFeesCollected", params: [] }),
          readContract({ contract: tokenContract, method: "liquidityDeployed", params: [] }),
        ])

        console.log(`📊 Contract values for ${tokenEntry.id}:`, {
          graduationThreshold: graduationThreshold.toString(),
          totalTokensDistributed: totalTokensDistributed.toString(),
          totalFeesCollected: totalFeesCollected.toString(),
          liquidityDeployed: liquidityDeployed.toString(),
        })

        const graduationThresholdBigInt = BigInt(graduationThreshold.toString())
        const totalTokensDistributedBigInt = BigInt(totalTokensDistributed.toString())
        const totalFeesCollectedBigInt = BigInt(totalFeesCollected.toString())

        // Fix: Calculate bonding progress percentage with proper precision
        // Use floating point division instead of BigInt division to preserve precision for small percentages
        let bondingProgress = 0
        if (graduationThresholdBigInt > 0n) {
          // Convert BigInt to Number for floating point division (within safe integer range)
          // This allows us to preserve precision for very small percentages
          const totalDistributedNum = Number(totalTokensDistributedBigInt)
          const thresholdNum = Number(graduationThresholdBigInt)
          
          // Calculate percentage: (totalTokensDistributed / graduationThreshold) * 100
          // For very large numbers, this may have some precision loss, but provides correct percentage
          bondingProgress = (totalDistributedNum / thresholdNum) * 100
          
          // Ensure valid number (handle NaN/Infinity)
          if (!isFinite(bondingProgress)) {
            bondingProgress = 0
          }
        }

        const isGraduated = liquidityDeployed === true

        // Generate Uniswap link if graduated (Base Sepolia)
        let uniswapLink: string | undefined
        if (isGraduated) {
          // Uniswap V4 pools are identified by PoolId, not a traditional address
          // For Base Sepolia, link to token page which should show pool info
          // TODO: Once Uniswap V4 frontend supports direct pool links, update this
          // Pool parameters: fee=10000 (1%), tickSpacing=200, hook=lpGuardHook
          // For now, link to token page which should display pool information
          uniswapLink = `https://app.uniswap.org/explore/tokens/base-sepolia/${tokenEntry.id}`
          
          // Alternative: Link to swap page with token pair pre-selected
          // uniswapLink = `https://app.uniswap.org/swap?chain=base-sepolia&inputCurrency=${tokenEntry.paymentToken}&outputCurrency=${tokenEntry.id}`
        }

        contractMetrics = {
          tokenAddress: tokenEntry.id,
          graduationThreshold: graduationThresholdBigInt.toString(),
          totalTokensDistributed: totalTokensDistributedBigInt.toString(),
          totalFeesCollected: totalFeesCollectedBigInt.toString(),
          bondingProgress: Math.min(bondingProgress, 100), // Cap at 100%
          isGraduated,
          uniswapLink,
          paymentTokenPrice: paymentTokenPrice?.toString() || null,
          paymentTokenDecimals: paymentTokenDecimals,
        }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      console.error(`❌ Failed to fetch contract metrics for ${tokenEntry.id}:`, errorMessage)
      if (errorStack) {
        console.error("Error stack:", errorStack)
      }
      
      // Return fallback on error with detailed error info
      contractMetrics = {
        tokenAddress: tokenEntry.id,
        graduationThreshold: "0",
        totalTokensDistributed: "0",
        totalFeesCollected: "0",
        bondingProgress: 0,
        isGraduated: false,
        paymentTokenPrice: null,
        paymentTokenDecimals: null,
        error: errorMessage,
      }
    }

    // Calculate token amount per API call for each API
    const apisWithTokenAmounts = tokenEntry.apis?.map(api => {
      let tokensPerCall: string | null = null
      
      if (paymentTokenPrice && paymentTokenDecimals !== null) {
        try {
          const feeBigInt = BigInt(api.fee)
          // Calculate: (fee * paymentTokenPrice) / (10^paymentTokenDecimals)
          const tokenAmount = (feeBigInt * paymentTokenPrice) / BigInt(10 ** paymentTokenDecimals)
          tokensPerCall = tokenAmount.toString()
        } catch (calcError) {
          console.warn(`Failed to calculate token amount for API ${api.slug}:`, calcError)
        }
      }
      
      return {
        ...api,
        tokensPerCall,
      }
    }) || []

    return res.status(200).json({
      success: true,
      serverSlug,
      metrics: {
        server: serverMetrics,
        contract: contractMetrics,
      },
      apisWithTokenAmounts,
    })
  } catch (error: any) {
    console.error("Error fetching metrics:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to fetch metrics"
    })
  }
})

/**
 * GET /api/metrics/:serverSlug/:apiSlug - Get metrics for a specific API
 */
app.get('/api/metrics/:serverSlug/:apiSlug', async (req, res) => {
  const serverSlug = req.params.serverSlug.toLowerCase()
  const apiSlug = req.params.apiSlug.toLowerCase()

  try {
    const tokenEntry = await getIAOTokenEntryBySlug(serverSlug)
    if (!tokenEntry) {
      return res.status(404).json({
        error: "Server not found",
        message: `No server registered with slug "${serverSlug}"`
      })
    }

    const api = getApiFromTokenBySlug(tokenEntry, apiSlug)
    if (!api) {
      return res.status(404).json({
        error: "API not found",
        message: `No API found with slug "${apiSlug}" in server "${serverSlug}"`
      })
    }

    // Get API metrics (using last 100 calls)
    let apiMetrics = null
    let successRate = 0
    if (metricsService) {
      const rawMetrics = await metricsService.getApiMetrics(tokenEntry.id, apiSlug)
      if (rawMetrics) {
        // Calculate metrics from last 100 calls if available
        let recentMetrics;
        if (rawMetrics.recentCalls && rawMetrics.recentCalls.length > 0) {
          recentMetrics = metricsService.calculateRecentMetrics(rawMetrics.recentCalls)
          successRate = recentMetrics.successRate
        } else {
          // Fallback to aggregated counts
          const success = BigInt(rawMetrics.successCount)
          const failure = BigInt(rawMetrics.failureCount)
          const totalAttempts = success + failure
          successRate = totalAttempts > 0n
            ? (Number(success) / Number(totalAttempts)) * 100
            : 0
        }
        
        // Add calculated success rate and recent metrics info
        apiMetrics = {
          ...rawMetrics,
          successRate,
          // Include info about whether metrics are from recent calls
          metricsFromLast100Calls: rawMetrics.recentCalls && rawMetrics.recentCalls.length > 0,
          recentCallCount: rawMetrics.recentCalls?.length || 0,
        }
      }
    }

    return res.status(200).json({
      success: true,
      serverSlug,
      apiSlug,
      metrics: {
        api: apiMetrics,
      },
    })
  } catch (error: any) {
    console.error("Error fetching API metrics:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to fetch API metrics"
    })
  }
})

/**
 * IAO Proxy Endpoint: /api/:serverSlug/:apiSlug
 * 
 * Flow with Thirdweb facilitator:
 * 1. Query DynamoDB for server by slug
 * 2. Get specific API by slug
 * 3. Use thirdweb's settlePayment() to verify and process payment
 * 4. If payment verified, forward request to builder endpoint
 * 5. Return builder response to user
 * 
 * @param serverSlug - Server slug (e.g., "magpie")
 * @param apiSlug - API slug (e.g., "eigenpie-pool")
 */

// Handle HEAD requests - facilitator uses these for validation
app.head('/api/:serverSlug/:apiSlug', async (req, res) => {
  res.status(200).end()
})

/**
 * Handler for GET /api/:serverSlug/:apiSlug
 * 
 * NEW FLOW: Charge fee ONLY AFTER builder successfully returns a response
 * 1. Validate payment data is present (but don't settle yet)
 * 2. Forward request to builder endpoint
 * 3. If builder returns success (2xx), THEN settle payment
 * 4. If builder fails, return error WITHOUT charging
 */
async function handleApiProxyRequest(req: any, res: any, serverSlug: string, apiSlug: string) {
  let tokenEntry: IAOTokenEntry | null = null
  let requestStartTime = Date.now()
  
  try {
    // Query DynamoDB for server by slug
    tokenEntry = await getIAOTokenEntryBySlug(serverSlug)

    if (!tokenEntry) {
      return res.status(404).json({
        error: "Server not found",
        message: `No server registered with slug "${serverSlug}"`
      })
    }

    // Get the specific API by slug
    const api = getApiFromTokenBySlug(tokenEntry, apiSlug)
    if (!api) {
      return res.status(404).json({
        error: "API not found",
        message: `No API found with slug "${apiSlug}" in server "${serverSlug}"`,
        availableApis: tokenEntry.apis?.map(a => ({ slug: a.slug, name: a.name })) || []
      })
    }

    console.log(`📡 Proxy request for server ${serverSlug}, API ${apiSlug}: ${api.name}`)

    // Get payment data from header (x402 V2: PAYMENT-SIGNATURE, fallback to X-PAYMENT for V1 compatibility)
    const paymentData = (req.headers['payment-signature'] || req.headers['x-payment']) as string | undefined
    
    // Convert subscription fee from wei to USD string (assuming 6 decimals for USDC)
    const subscriptionFeeWei = BigInt(api.fee)
    const subscriptionFeeUSD = Number(subscriptionFeeWei) / 1e6
    const priceString = `$${subscriptionFeeUSD.toFixed(2)}`

    // Check if payment is required
    if (thirdwebClient) {
      if (!paymentData) {
        // No payment data provided - return 402 with payment requirements
        // IMPORTANT: User pays to FACILITATOR, facilitator forwards to token
        const facilitatorAddress = process.env.THIRDWEB_SERVER_WALLET_ADDRESS
        
        console.log('💰 Returning 402 Payment Required:', {
          payTo: facilitatorAddress,
          finalRecipient: tokenEntry.id,
          asset: tokenEntry.paymentToken,
          amount: api.fee,
          serverSlug,
          apiSlug,
          timestamp: new Date().toISOString()
        })
        
        return res.status(402).json({
          error: "Payment required",
          message: "This endpoint requires payment. Please provide PAYMENT-SIGNATURE header (x402 V2).",
          x402Version: 2,
          accepts: [{
            scheme: "exact",
            network: `eip155:${baseSepolia.id}`, // CAIP-2 format (V2)
            payTo: facilitatorAddress,  // User pays to FACILITATOR
            asset: tokenEntry.paymentToken,
            maxAmountRequired: api.fee,
          }],
          // Include final recipient for reference
          finalRecipient: tokenEntry.id,
          serverSlug: serverSlug,
          apiSlug: apiSlug,
        })
      }
      
      // Verify payment authorization BEFORE calling builder
      // User should have signed payment to facilitator address
      const facilitatorAddress = process.env.THIRDWEB_SERVER_WALLET_ADDRESS!
      
      console.log("📝 Verifying payment authorization...")
      const verifyResult = await verifyPaymentAuthorization(
        paymentData,
        facilitatorAddress,
        api.fee, // Use API-specific fee
        tokenEntry.paymentToken
      )
      
      if (!verifyResult.valid) {
        console.error("❌ Payment authorization invalid:", verifyResult.error)
        return res.status(402).json({
          error: "Invalid payment authorization",
          message: verifyResult.error || "Payment authorization is invalid",
          x402Version: 2,
          accepts: [{
            scheme: "exact",
            network: `eip155:${baseSepolia.id}`, // CAIP-2 format (V2)
            payTo: tokenEntry.id,
            asset: tokenEntry.paymentToken,
            maxAmountRequired: api.fee,
          }],
        })
      }
      
      console.log("✅ Payment authorization valid - will execute AFTER successful builder response")
    } else {
      console.warn("⚠️  Thirdweb client not configured - skipping payment verification")
    }

    // STEP 1: Forward request to builder endpoint FIRST (before settling payment)
    let builderResponse: any
    let parsedData: any
    let builderSuccess = false
    requestStartTime = Date.now() // Update latency tracking for builder call
    
    try {
      // Build builder endpoint URL with query parameters
      const builderUrl = new URL(api.apiUrl)
       
      // Copy all query parameters from proxy request to builder endpoint
      Object.keys(req.query).forEach((key: string) => {
        builderUrl.searchParams.set(key, req.query[key] as string)
      })

      console.log(`Forwarding request to builder endpoint (BEFORE payment): ${builderUrl.toString()}`)

      // Forward request to builder endpoint
      const forwardHeaders: Record<string, string> = {}
      Object.entries(req.headers).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase()
        // Filter out payment headers (V1 and V2)
        if (!['host', 'x-payment', 'payment-signature', 'x-payment-proof', 'x-payment-token', 'x-payment-amount'].includes(lowerKey)) {
          forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : (value as string || '')
        }
      })

      // Add JWT authentication header if secret phrase is configured
      if (BUILDER_SECRET_PHRASE) {
        try {
          const jwtToken = generateBuilderJWT(
            tokenEntry.id,
            api.apiUrl,
            BUILDER_SECRET_PHRASE,
            '5m'
          )
          forwardHeaders['X-IAO-Auth'] = jwtToken
          console.log("✅ Added JWT authentication header for builder endpoint")
        } catch (jwtError: any) {
          console.error("⚠️  Failed to generate JWT token:", jwtError)
        }
      }
      
      // Create AbortController for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000)
      
      try {
        builderResponse = await fetch(builderUrl.toString(), {
          method: req.method,
          headers: {
            ...forwardHeaders,
            'User-Agent': 'IAO-Proxy/1.0',
            'Accept': 'application/json, */*',
            'Accept-Encoding': 'identity'
          },
          body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
          signal: controller.signal
        })
        clearTimeout(timeoutId)

        // Parse response
        const contentType = builderResponse.headers.get('content-type') || ''
        const contentEncoding = builderResponse.headers.get('content-encoding') || ''
        
        console.log("Builder response:", {
          status: builderResponse.status,
          contentType,
          contentEncoding
        })
        
        // Handle zstd compression
        if (contentEncoding && contentEncoding.toLowerCase().includes('zstd')) {
          console.warn("⚠️  Response indicates zstd compression - attempting to parse anyway")
          try {
            const responseText = await builderResponse.text()
            if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
              try {
                parsedData = JSON.parse(responseText)
                console.log("✅ Parsed zstd-flagged response as JSON")
        } catch {
                parsedData = {
                  error: "Unsupported compression",
                  message: "The API response is compressed with zstd, which is not supported."
                }
              }
            } else {
              parsedData = {
                error: "Unsupported compression",
                message: "The API response is compressed with zstd, which is not supported."
              }
            }
          } catch {
            parsedData = {
              error: "Unsupported compression",
              message: "The API response is compressed with zstd, which is not supported."
            }
          }
        } else {
          try {
            if (contentType.includes('application/json')) {
              parsedData = await builderResponse.json()
              console.log("✅ Parsed as JSON successfully")
            } else {
              const responseText = await builderResponse.text()
              try {
                parsedData = JSON.parse(responseText)
              } catch {
                parsedData = responseText
              }
            }
          } catch (parseError: any) {
            parsedData = { 
              error: "Failed to parse response", 
              message: parseError.message || "Unable to decode response"
            }
          }
        }

        // Check if builder response was successful (2xx status)
        builderSuccess = builderResponse.status >= 200 && builderResponse.status < 300
        console.log(`Builder response status: ${builderResponse.status}, success: ${builderSuccess}`)

      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        
        const latencyMs = Date.now() - requestStartTime
        
        if (fetchError.name === 'AbortError' || fetchError.code === 'ETIMEDOUT') {
          console.error("❌ Builder endpoint timeout - NOT charging user")
          
          // Record failure metrics for timeout
          if (metricsService) {
            metricsService.recordApiCall(
              tokenEntry.id,
              apiSlug,
              "0", // No fee charged on failure
              false, // failure
              latencyMs
            ).catch(err => {
              console.error("⚠️  Failed to record metrics:", err)
            })
          }
          
          return res.status(504).json({
            error: "Builder endpoint timeout",
            message: "The builder endpoint did not respond within 60 seconds. You have NOT been charged.",
            x402Version: 2,
            serverSlug,
            apiSlug,
            apiName: api.name,
            charged: false
          })
        }
        
        console.error("❌ Builder endpoint fetch error - NOT charging user:", fetchError)
        
        // Record failure metrics for fetch error
        if (metricsService) {
          metricsService.recordApiCall(
            tokenEntry.id,
            apiSlug,
            "0", // No fee charged on failure
            false, // failure
            latencyMs
          ).catch(err => {
            console.error("⚠️  Failed to record metrics:", err)
          })
        }
        
        return res.status(502).json({
          error: "Builder endpoint error",
          message: "Failed to fetch from builder endpoint. You have NOT been charged.",
          x402Version: 2,
          serverSlug,
          apiSlug,
          apiName: api.name,
          charged: false
        })
      }
    } catch (forwardError: any) {
      console.error("❌ Error forwarding to builder - NOT charging user:", forwardError)
      
      const latencyMs = Date.now() - requestStartTime
      
      // Record failure metrics for forward error
      if (metricsService) {
        metricsService.recordApiCall(
          tokenEntry.id,
          apiSlug,
          "0", // No fee charged on failure
          false, // failure
          latencyMs
        ).catch(err => {
          console.error("⚠️  Failed to record metrics:", err)
        })
      }
      
      return res.status(502).json({
        error: "Builder endpoint error",
        message: "Failed to reach builder endpoint. You have NOT been charged.",
        x402Version: 2,
        serverSlug,
        apiSlug,
        apiName: api.name,
        charged: false
      })
    }

    // STEP 2: If builder failed, return error WITHOUT charging
    if (!builderSuccess) {
      console.log(`❌ Builder returned error status ${builderResponse.status} - NOT charging user`)
      
      // Record failure metrics (no revenue, but track failure)
      if (metricsService) {
        const latencyMs = Date.now() - requestStartTime
        metricsService.recordApiCall(
          tokenEntry.id,
          apiSlug,
          "0", // No fee charged on failure
          false, // failure
          latencyMs
        ).catch(err => {
          console.error("⚠️  Failed to record metrics:", err)
        })
      }
      
      return res.status(builderResponse.status).json({
        error: "Builder endpoint returned error",
        message: "The API returned an error. You have NOT been charged.",
        x402Version: 2,
        builderStatus: builderResponse.status,
        data: parsedData,
        serverSlug,
        apiSlug,
        apiName: api.name,
        charged: false
      })
    }

    // STEP 3: Builder succeeded - NOW execute the payment
    console.log("✅ Builder returned success - NOW executing payment to token address")
    
    if (thirdwebClient && paymentData) {
      try {
        console.log("Executing payment transfer:", {
          payTo: tokenEntry.id,
          amount: api.fee, // Use API-specific fee
          paymentToken: tokenEntry.paymentToken,
          serverSlug,
          apiSlug,
        })
        
        const paymentResult = await executePaymentTransfer(
          paymentData,
          tokenEntry.paymentToken,
          req,
          tokenEntry.id,
          api.fee, // Use API-specific fee
          serverSlug,
          apiSlug,
          api.name
        )
        
        if (!paymentResult.success) {
          console.error("❌ Payment execution failed AFTER successful builder response")
          console.error("Payment error:", paymentResult.error)
    return res.status(500).json({
            error: "Payment execution failed",
            message: "Builder returned data successfully, but payment could not be executed.",
            x402Version: 2,
            paymentError: paymentResult.error,
            data: parsedData,
            serverSlug,
            apiSlug,
            charged: false
          })
        }

        console.log("✅ Payment executed successfully:", paymentResult.txHash)

        // Record metrics (latency, success, revenue)
        if (metricsService) {
          const latencyMs = Date.now() - requestStartTime
          metricsService.recordApiCall(
            tokenEntry.id,
            apiSlug,
            api.fee,
            true, // success
            latencyMs
          ).catch(err => {
            console.error("⚠️  Failed to record metrics:", err)
          })
        }

        // STEP 4: Update subscription count and request queue
        if (userRequestService && paymentData) {
          try {
            const userAddress = extractUserAddressFromPayment(paymentData)
            
            if (userAddress && dynamoDBService) {
              const tokenDBEntry = await dynamoDBService.getItem(tokenEntry.id)
              if (tokenDBEntry) {
                const currentSubscriptionCount = BigInt(tokenDBEntry.subscriptionCount || "0")
                const globalRequestNumber = (currentSubscriptionCount + BigInt(1)).toString()

                await userRequestService.createRequestQueueEntry(
                  tokenEntry.id,
                  userAddress,
                  globalRequestNumber,
                  api.fee // Pass API-specific fee
                )

                const newSubscriptionCount = (currentSubscriptionCount + BigInt(1)).toString()
                const updatedTokenEntry: IAOTokenDBEntry = {
                  ...tokenDBEntry,
                  subscriptionCount: newSubscriptionCount,
                  updatedAt: new Date().toISOString(),
                }
                await dynamoDBService.putItem(updatedTokenEntry)
                console.log(`✅ Updated subscriptionCount: ${newSubscriptionCount}`)
              }
            }
          } catch (queueError: any) {
            console.error("⚠️  Failed to update request queue:", queueError)
          }
        }
      } catch (paymentError: any) {
        console.error("❌ Payment settlement error:", paymentError)
        // Return data but indicate payment failed
        return res.status(500).json({
          error: "Payment processing error",
          message: "Builder returned data successfully, but payment processing failed.",
          x402Version: 2,
          data: parsedData,
          serverSlug,
          apiSlug,
          charged: false
        })
      }
    }

    // STEP 5: Return successful response with data
    console.log("✅ Returning successful response with payment confirmed")
    
    // Set x402 V2 response header
    res.setHeader('PAYMENT-RESPONSE', 'paid')
    
    res.status(builderResponse.status).setHeader('Content-Type', 'application/json; charset=utf-8').json({
      data: parsedData,
      x402Version: 2,
      payment: {
        status: "paid",
        tokenAddress: tokenEntry.id,
        paymentToken: tokenEntry.paymentToken,
        charged: true
      },
      proxy: {
        serverSlug: serverSlug,
        apiSlug: apiSlug,
        apiName: api.name,
        timestamp: new Date().toISOString()
      }
    })

    console.log("Payment settled for API - automation should mint rewards", {
      tokenAddress: tokenEntry.id,
      tokenSymbol: tokenEntry.symbol,
      serverSlug,
      apiSlug,
      apiName: api.name
    })

  } catch (error: any) {
    console.error("Error in IAO proxy endpoint:", error)
    
    // Record failure metrics if we have token entry info (error happened during builder call or after)
    if (tokenEntry && metricsService) {
      const latencyMs = Date.now() - requestStartTime
      metricsService.recordApiCall(
        tokenEntry.id,
        apiSlug,
        "0", // No fee charged on error
        false, // failure
        latencyMs
      ).catch(err => {
        console.error("⚠️  Failed to record metrics:", err)
      })
    }
    
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "An unexpected error occurred",
      charged: false
    })
  }
}

/**
 * AGENT ENDPOINTS
 * NOTE: Must be defined before catch-all /api/:serverSlug/:apiSlug route
 */

// POST /api/agents - Create a new agent
app.post('/api/agents', async (req, res) => {
  try {
    if (!agentService) {
      return res.status(503).json({ error: "Agent service not initialized" })
    }

    const { name, description, creator, llmProvider, availableTools, starterPrompts, isPublic } = req.body

    // Validation
    if (!name || !description || !creator || !llmProvider || !availableTools || !starterPrompts) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["name", "description", "creator", "llmProvider", "availableTools", "starterPrompts"]
      })
    }

    if (!['claude', 'gpt', 'gemini'].includes(llmProvider)) {
      return res.status(400).json({
        error: "Invalid llmProvider. Must be one of: claude, gpt, gemini"
      })
    }

    if (!Array.isArray(availableTools) || availableTools.length === 0) {
      return res.status(400).json({
        error: "availableTools must be a non-empty array"
      })
    }

    if (!Array.isArray(starterPrompts) || starterPrompts.length === 0) {
      return res.status(400).json({
        error: "starterPrompts must be a non-empty array"
      })
    }

    const params: CreateAgentParams = {
      name,
      description,
      creator,
      llmProvider,
      availableTools,
      starterPrompts,
      isPublic: isPublic !== false
    }

    const agent = await agentService.createAgent(params)

    return res.status(201).json({
      success: true,
      message: "Agent created successfully",
      data: agent
    })
  } catch (error: any) {
    console.error("Error creating agent:", error)
    return res.status(500).json({
      error: "Failed to create agent",
      message: error.message
    })
  }
})

// GET /api/agents - List all public agents
app.get('/api/agents', async (req, res) => {
  try {
    if (!agentService) {
      return res.status(503).json({ error: "Agent service not initialized" })
    }

    const agents = await agentService.getPublicAgents()

    return res.json({
      success: true,
      count: agents.length,
      data: agents
    })
  } catch (error: any) {
    console.error("Error listing agents:", error)
    return res.status(500).json({
      error: "Failed to list agents",
      message: error.message
    })
  }
})

// GET /api/agents/:id - Get agent details
app.get('/api/agents/:id', async (req, res) => {
  try {
    if (!agentService) {
      return res.status(503).json({ error: "Agent service not initialized" })
    }

    const agent = await agentService.getAgent(req.params.id)

    if (!agent) {
      return res.status(404).json({
        error: "Agent not found"
      })
    }

    return res.json({
      success: true,
      data: agent
    })
  } catch (error: any) {
    console.error("Error getting agent:", error)
    return res.status(500).json({
      error: "Failed to get agent",
      message: error.message
    })
  }
})

// GET /api/agents/my - Get user's agents (by creator wallet)
app.get('/api/agents/my', async (req, res) => {
  try {
    if (!agentService) {
      return res.status(503).json({ error: "Agent service not initialized" })
    }

    const creator = req.query.creator as string

    if (!creator) {
      return res.status(400).json({
        error: "creator query parameter required"
      })
    }

    const agents = await agentService.getAgentsByCreator(creator)

    return res.json({
      success: true,
      creator,
      count: agents.length,
      data: agents
    })
  } catch (error: any) {
    console.error("Error getting user agents:", error)
    return res.status(500).json({
      error: "Failed to get user agents",
      message: error.message
    })
  }
})

// PUT /api/agents/:id - Update agent (creator only)
app.put('/api/agents/:id', async (req, res) => {
  try {
    if (!agentService) {
      return res.status(503).json({ error: "Agent service not initialized" })
    }

    const { id } = req.params
    const creator = req.query.creator as string

    if (!creator) {
      return res.status(400).json({
        error: "creator query parameter required"
      })
    }

    // Verify ownership
    const agent = await agentService.getAgent(id)
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" })
    }
    if (agent.creator !== creator.toLowerCase()) {
      return res.status(403).json({
        error: "Unauthorized: Only agent creator can update"
      })
    }

    const updates = req.body
    const updatedAgent = await agentService.updateAgent(id, updates)

    return res.json({
      success: true,
      message: "Agent updated successfully",
      data: updatedAgent
    })
  } catch (error: any) {
    console.error("Error updating agent:", error)
    return res.status(500).json({
      error: "Failed to update agent",
      message: error.message
    })
  }
})

// DELETE /api/agents/:id - Delete agent (creator only)
app.delete('/api/agents/:id', async (req, res) => {
  try {
    if (!agentService) {
      return res.status(503).json({ error: "Agent service not initialized" })
    }

    const { id } = req.params
    const creator = req.query.creator as string

    if (!creator) {
      return res.status(400).json({
        error: "creator query parameter required"
      })
    }

    await agentService.deleteAgent(id, creator)

    return res.json({
      success: true,
      message: "Agent deleted successfully"
    })
  } catch (error: any) {
    console.error("Error deleting agent:", error)
    return res.status(500).json({
      error: "Failed to delete agent",
      message: error.message
    })
  }
})

// GET /api/agents/:id/metrics - Get agent metrics
app.get('/api/agents/:id/metrics', async (req, res) => {
  try {
    if (!agentService) {
      return res.status(503).json({ error: "Agent service not initialized" })
    }

    const metrics = await agentService.getAgentMetrics(req.params.id)

    if (!metrics) {
      return res.status(404).json({
        error: "Agent not found"
      })
    }

    return res.json({
      success: true,
      data: metrics
    })
  } catch (error: any) {
    console.error("Error getting agent metrics:", error)
    return res.status(500).json({
      error: "Failed to get agent metrics",
      message: error.message
    })
  }
})

// Handle GET requests for /api/:serverSlug/:apiSlug (slug-based routing)
// NOTE: Must be defined AFTER all specific /api/* routes
app.get('/api/:serverSlug/:apiSlug', async (req, res) => {
  const serverSlug = req.params.serverSlug.toLowerCase()
  const apiSlug = req.params.apiSlug.toLowerCase()

  return handleApiProxyRequest(req, res, serverSlug, apiSlug)
})

/**
 * CHAT ENDPOINTS
 */

// POST /api/chat/sessions - Get or create a chat session
app.post('/api/chat/sessions', async (req, res) => {
  try {
    if (!chatSessionService) {
      return res.status(503).json({ error: "Chat service not initialized" })
    }

    const { agentId, userAddress } = req.body

    if (!agentId || !userAddress) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["agentId", "userAddress"]
      })
    }

    const session = await chatSessionService.getOrCreateSession(agentId, userAddress)

    return res.status(201).json({
      success: true,
      data: session
    })
  } catch (error: any) {
    console.error("Error creating chat session:", error)
    return res.status(500).json({
      error: "Failed to create chat session",
      message: error.message
    })
  }
})

// GET /api/chat/sessions/:id/messages - Get message history
app.get('/api/chat/sessions/:id/messages', async (req, res) => {
  try {
    if (!chatSessionService) {
      return res.status(503).json({ error: "Chat service not initialized" })
    }

    const limit = parseInt(req.query.limit as string) || 100
    const messages = await chatSessionService.getRecentMessages(req.params.id, limit)

    return res.json({
      success: true,
      count: messages.length,
      data: messages
    })
  } catch (error: any) {
    console.error("Error getting messages:", error)
    return res.status(500).json({
      error: "Failed to get messages",
      message: error.message
    })
  }
})

// POST /api/chat/message - Send a chat message
app.post('/api/chat/message', async (req, res) => {
  try {
    if (!chatSessionService) {
      return res.status(503).json({ error: "Chat service not initialized" })
    }

    const { sessionId, content } = req.body

    if (!sessionId || !content) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["sessionId", "content"]
      })
    }

    // Save user message
    const userMessage = await chatSessionService.saveMessage(
      sessionId,
      'user',
      content
    )

    return res.status(201).json({
      success: true,
      message: "Message received. Streaming response...",
      data: userMessage
    })
  } catch (error: any) {
    console.error("Error saving message:", error)
    return res.status(500).json({
      error: "Failed to save message",
      message: error.message
    })
  }
})

// GET /api/chat/stream/:sessionId - SSE endpoint for streaming responses with agentic loop
app.get('/api/chat/stream/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params

    // Validate services
    if (!chatSessionService || !agentService || !llmService || !agentToolService || !agentPaymentService) {
      return res.status(503).json({ error: "Required services not initialized" })
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendEvent = (type: string, data: any) => {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`)
    }

    // Step 1: Get the session
    const session = await chatSessionService.getSession(sessionId)
    if (!session) {
      sendEvent('error', { message: 'Session not found' })
      res.end()
      return
    }

    // Step 2: Get the agent
    const agent = await agentService.getAgent(session.agentId)
    if (!agent) {
      sendEvent('error', { message: 'Agent not found' })
      res.end()
      return
    }

    // Step 3: Get recent messages (conversation history)
    // Keep last 100 messages for better context (previously was 20)
    const messages = await chatSessionService.getRecentMessages(sessionId, 100)

    console.log(`📨 Loaded ${messages.length} messages from session`)

    // Convert to LLM format (filter out system messages, keep only user/assistant)
    let llmMessages = messages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }))

    // For Haiku (8k context), limit to last 15 messages to avoid token overflow
    // System prompt + tools + many messages can exceed context window
    if (agent.llmProvider === 'claude' && llmMessages.length > 15) {
      console.warn(`⚠️  Truncating ${llmMessages.length} messages to 15 for Haiku token limit`)
      llmMessages = llmMessages.slice(-15)
    }

    console.log(`📊 Sending ${llmMessages.length} messages to LLM for context`)

    // Check if last message contains API result from payment
    const lastMessage = messages[messages.length - 1]
    const isPaymentResult = lastMessage?.content?.includes('Payment successful!')

    // Step 4: Get tools for this agent
    let tools = []
    try {
      tools = await agentToolService.getToolsForAgent(agent)
    } catch (error) {
      console.warn("Failed to load tools:", error)
      sendEvent('warning', { message: 'Failed to load agent tools' })
    }

    // CRITICAL: Validate agent has at least one tool available
    // Agents without tools cannot operate (tool-gating constraint)
    if (tools.length === 0) {
      console.warn(`❌ Agent ${agent.id} has no tools configured - cannot operate`)
      sendEvent('error', {
        message: 'This agent has no tools configured. Please contact the agent creator to add API access.'
      })
      res.end()
      return
    }

    console.log(`✅ Agent ${agent.id} (${agent.name}) loaded with ${tools.length} tool(s)`)
    console.log(`🔒 Tool-gating enabled: Agent can ONLY call these tools: ${tools.map(t => t.name).join(', ')}`)

    // Step 5: System prompt for the agent
    // STRICT TOOL-GATING: Agent ONLY answers questions about available APIs
    let systemPrompt = `You are ${agent.name}. Your ONLY purpose is to help users access these specific decentralized APIs:

${tools.length > 0 ? tools.map(t => `• ${t.name}: ${t.description}`).join('\n') : 'NO TOOLS AVAILABLE'}

CRITICAL RULES:
1. You ONLY answer questions that can be solved by the APIs listed above
2. You MUST decline any questions NOT related to these APIs
3. When recommending an API, call it as a tool (Claude will show a payment button)
4. Do NOT provide general knowledge or answers outside these APIs
5. If a user asks about anything else, respond: "I can only help with: [list your APIs]. What would you like to do?"

TOOL-GATING CONSTRAINT:
- You have EXACTLY ${tools.length} API(s) available
- You cannot answer general questions like "how to lose weight", "tell me about history", etc.
- You MUST stay in your domain
- If no API matches the user's request, decline clearly

Example conversation:
User: "How to lose weight?"
You: "I can only help with the APIs on this server: ${tools.length > 0 ? tools.map(t => t.name).join(', ') : 'none'}. What would you like to do?"

User: "Can I get a random user profile?"
You: "Yes! I can get you a random user profile. Let me fetch that for you."
[System shows payment button]

After payment, analyze the returned data and provide insights.`

    // Add context if this is a response to payment result
    if (isPaymentResult) {
      systemPrompt += `\n\nThe user just paid for and received API data. Analyze the result and provide a helpful summary or insights.`
    }

    // Step 6: Stream LLM response with tool execution
    let assistantMessage = ''
    const toolCalls: Array<{ name: string; input: Record<string, any> }> = []
    let hasError = false

    try {
      console.log(`🚀 Starting LLM stream with ${llmMessages.length} messages`)
      console.log(`📝 System prompt length: ${systemPrompt.length} chars, ${Math.ceil(systemPrompt.length / 4)} tokens (estimated)`)
      console.log(`🔧 Tools count: ${tools.length}`)

      // Stream the LLM response
      for await (const chunk of llmService.streamChat(agent.llmProvider as 'claude' | 'gpt' | 'gemini', llmMessages, tools, systemPrompt)) {
        if (chunk.type === 'token') {
          // Stream text token to client
          assistantMessage += chunk.content
          sendEvent('token', { content: chunk.content })
        } else if (chunk.type === 'tool_call') {
          // Tool call requested by LLM - don't execute, send payment option instead
          const toolCall = chunk.tool
          toolCalls.push({
            name: toolCall.name,
            input: toolCall.input
          })

          // CRITICAL: Validate agent has access to this tool (tool-gating constraint)
          const hasAccess = agentToolService.hasToolAccess(agent, toolCall.name)
          if (!hasAccess) {
            console.warn(`⚠️  UNAUTHORIZED TOOL ACCESS: Agent ${agent.id} attempted to call ${toolCall.name}`)
            sendEvent('error', {
              message: `Access denied. This agent is not authorized to use the ${toolCall.name} tool.`
            })
            continue // Skip and continue
          }

          // Find which availableTools entry this tool_call corresponds to
          // Can't just parse tool name because slugs may contain hyphens converted to underscores
          let serverSlug = ''
          let apiSlug = ''

          for (const toolString of agent.availableTools) {
            const [s, a] = toolString.split('/')
            const generatedToolName = `call_${s}_${a}`.replace(/-/g, '_').toLowerCase()
            if (generatedToolName === toolCall.name.toLowerCase()) {
              serverSlug = s
              apiSlug = a
              break
            }
          }

          if (!serverSlug || !apiSlug) {
            console.error(`Could not find server/API for tool: ${toolCall.name}`)
            sendEvent('error', {
              message: `Could not find API information for ${toolCall.name}`
            })
            continue
          }

          try {
            // Get API info for payment option
            const apiInfo = await agentToolService.getApiInfo(serverSlug, apiSlug)

            // Send payment option event to frontend
            sendEvent('payment_option', {
              toolName: toolCall.name,
              toolDisplayName: apiInfo.name,
              serverSlug,
              apiSlug,
              fee: apiInfo.fee,
              displayFee: AgentPaymentService.formatFeeForDisplay(apiInfo.fee),
              tokenAddress: apiInfo.tokenAddress,
              description: apiInfo.description
            })

            console.log(`💳 Payment option sent for ${toolCall.name}: ${apiInfo.name} (${AgentPaymentService.formatFeeForDisplay(apiInfo.fee)})`)

          } catch (error: any) {
            console.error(`Failed to get API info for ${toolCall.name}:`, error)
            sendEvent('error', {
              message: `Failed to load payment option: ${error.message}`
            })
          }
        } else if (chunk.type === 'done') {
          // LLM streaming complete
          sendEvent('done', { success: true })
        }
      }

      console.log(`✅ LLM streaming completed. Assistant message length: ${assistantMessage.length}`)
    } catch (streamError: any) {
      console.error("❌ LLM streaming error:", streamError)
      hasError = true
      sendEvent('error', { message: streamError.message })
    }

    // Step 7: Save the assistant message to the session
    if (!hasError && assistantMessage) {
      try {
        await chatSessionService.saveMessage(sessionId, 'assistant', assistantMessage)

        // Increment agent metrics
        await agentService.incrementMetric(agent.id, 'totalMessages')
        if (toolCalls.length > 0) {
          await agentService.incrementMetric(agent.id, 'totalToolCalls')
        }
      } catch (saveError) {
        console.error("Failed to save assistant message:", saveError)
      }
    }

    // Step 8: Prune old messages (keep only last 100)
    try {
      await chatSessionService.pruneOldMessages(sessionId, 100)
    } catch (pruneError) {
      console.warn("Failed to prune old messages:", pruneError)
    }

    res.end()
  } catch (error: any) {
    console.error("Error in SSE stream:", error)
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
    res.end()
  }
})

// Start server if running directly (not in Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    console.log(`🚀 Express server running on port ${PORT}`)
    console.log(`📱 Base URL: http://localhost:${PORT}`)
    console.log(`🔗 Network: Base Mainnet`)
    console.log(`💰 Facilitator: Thirdweb`)
    console.log(`\n📍 Available endpoints:`)
    console.log(`   POST /api/register              - Register new server with APIs`)
    console.log(`   POST /api/add-api               - Add API to existing server`)
    console.log(`   GET /api/servers                - Get all registered servers`)
    console.log(`   GET /api/server/:slug           - Get server metadata by slug`)
    console.log(`   GET /api/:serverSlug/:apiSlug   - Proxy to specific API (e.g., /api/magpie/pool-snapshot)`)
    console.log(`\n⚙️  Configuration:`)
    console.log(`   - Set THIRDWEB_SECRET_KEY and THIRDWEB_SERVER_WALLET_ADDRESS for payment processing`)
    console.log(`   - Set DYNAMODB_REGION and DYNAMODB_TABLE_NAME for IAO token storage`)
    console.log(`   - Set BUILDER_SECRET_PHRASE for JWT authentication with builder endpoints`)
  })
}

export default app

