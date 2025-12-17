import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import cors from 'cors'
import { facilitator as thirdwebFacilitatorFn, settlePayment } from 'thirdweb/x402'
import { createThirdwebClient } from 'thirdweb'
import { baseSepolia } from 'thirdweb/chains'
import fetch from 'node-fetch'
import { DynamoDBService, IAOTokenDBEntry, ApiEntry } from './services/dynamoDBService.js'
import { UserRequestService } from './services/userRequestService.js'
import { generateBuilderJWT } from './utils/jwtAuth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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


/**
 * Extract user address from payment data (X-PAYMENT header)
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
  subscriptionFee: string   // Fee amount in smallest unit of payment token
  subscriptionCount?: string // Total usage count (aggregated across all APIs)
  paymentToken: string      // Payment token address (e.g., USDC)
  apis: ApiEntry[]          // Array of registered APIs
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
        subscriptionFee: dbEntry.subscriptionFee,
        subscriptionCount: dbEntry.subscriptionCount,
        paymentToken: dbEntry.paymentToken,
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
        subscriptionFee: dbEntry.subscriptionFee,
        subscriptionCount: dbEntry.subscriptionCount,
        paymentToken: dbEntry.paymentToken,
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
  subscriptionFee: string,
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
    const subscriptionFeeWei = BigInt(subscriptionFee)
    const subscriptionFeeUSD = Number(subscriptionFeeWei) / 1e6
    const priceString = `$${subscriptionFeeUSD.toFixed(2)}`
    
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
 * This endpoint accepts token creation data and stores it in DynamoDB.
 * The frontend should call this after successfully creating a token on-chain.
 * A builder can register multiple APIs at once, all linked to the same token.
 * 
 * Request body:
 * {
 *   tokenAddress: string (0x...),
 *   slug: string (server slug, e.g., "magpie"),
 *   name: string,
 *   symbol: string,
 *   apis: [{ slug: string, name: string, apiUrl: string, description: string }],
 *   builder: string (0x...),
 *   paymentToken: string (0x...),
 *   subscriptionFee: string (BigInt as string),
 * }
 */
app.post('/api/register', async (req, res) => {
  try {
    const {
      tokenAddress,
      slug,       // Server slug (e.g., "magpie")
      name,
      symbol,
      apis,       // Array of APIs with slugs
      builder,
      paymentToken,
      subscriptionFee,
    } = req.body

    // Validate required fields
    if (!tokenAddress || !slug || !name || !symbol || !builder || !paymentToken || !subscriptionFee) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "tokenAddress, slug, name, symbol, builder, paymentToken, and subscriptionFee are required"
      })
    }

    // Validate server slug format
    const serverSlug = slug.toLowerCase()
    if (!isValidSlug(serverSlug)) {
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
    const existingBySlug = await dynamoDBService.getItemBySlug(serverSlug)
    if (existingBySlug) {
      return res.status(409).json({
        error: "Server slug already taken",
        message: `The slug "${serverSlug}" is already registered. Please choose a different slug.`
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

    // Build apis array with validation
    const apiEntries: ApiEntry[] = []
    const apiSlugs = new Set<string>()
    const now = new Date().toISOString()

    for (let i = 0; i < apis.length; i++) {
      const api = apis[i]
      
      // Validate required API fields
      if (!api.slug || !api.name || !api.apiUrl || !api.description) {
        return res.status(400).json({
          error: "Invalid API entry",
          message: `API at index ${i} is missing required fields (slug, name, apiUrl, description)`
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

      apiEntries.push({
        index: i,
        slug: apiSlug,
        name: api.name,
        apiUrl: api.apiUrl,
        description: api.description,
        createdAt: now,
      })
    }

    // Create token entry
    const tokenEntry: IAOTokenDBEntry = {
      id: tokenAddress.toLowerCase(),
      slug: serverSlug,
      name,
      symbol,
      apis: apiEntries,
      builder: builder.toLowerCase(),
      paymentToken: paymentToken.toLowerCase(),
      subscriptionFee: subscriptionFee.toString(),
      subscriptionCount: "0",
      refundCount: "0",
      fulfilledCount: "0",
      createdAt: now,
      updatedAt: now,
    }

    // Store in DynamoDB
    await dynamoDBService.putItem(tokenEntry)

    console.log(`✅ Registered new server: ${serverSlug} (${name}/${symbol}) with ${apiEntries.length} API(s)`)

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
        subscriptionFee: tokenEntry.subscriptionFee,
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
      builder,
    } = req.body

    // Validate required fields
    if (!serverSlug || !slug || !name || !apiUrl || !description || !builder) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "serverSlug, slug, name, apiUrl, description, and builder are required"
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

    // Add new API
    const newApi = await dynamoDBService.addApiToToken(
      existingToken.id,
      apiSlug,
      name,
      apiUrl,
      description
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
        subscriptionFee: tokenEntry.subscriptionFee,
        subscriptionCount: tokenEntry.subscriptionCount || "0",
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
      subscriptionFee: token.subscriptionFee,
      subscriptionCount: token.subscriptionCount,
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
  try {
    // Query DynamoDB for server by slug
    const tokenEntry = await getIAOTokenEntryBySlug(serverSlug)

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

    // Get payment data from header (validate presence, but don't settle yet)
    const paymentData = req.headers['x-payment'] as string | undefined
    
    // Convert subscription fee from wei to USD string (assuming 6 decimals for USDC)
    const subscriptionFeeWei = BigInt(tokenEntry.subscriptionFee)
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
          amount: tokenEntry.subscriptionFee,
          serverSlug,
          apiSlug,
          timestamp: new Date().toISOString()
        })
        
        return res.status(402).json({
          error: "Payment required",
          message: "This endpoint requires payment. Please provide X-PAYMENT header.",
          accepts: [{
            scheme: "exact",
            network: `eip155:${baseSepolia.id}`,
            payTo: facilitatorAddress,  // User pays to FACILITATOR
            asset: tokenEntry.paymentToken,
            maxAmountRequired: tokenEntry.subscriptionFee,
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
        tokenEntry.subscriptionFee,
        tokenEntry.paymentToken
      )
      
      if (!verifyResult.valid) {
        console.error("❌ Payment authorization invalid:", verifyResult.error)
        return res.status(402).json({
          error: "Invalid payment authorization",
          message: verifyResult.error || "Payment authorization is invalid",
          accepts: [{
            scheme: "exact",
            network: `eip155:${baseSepolia.id}`,
            payTo: tokenEntry.id,
            asset: tokenEntry.paymentToken,
            maxAmountRequired: tokenEntry.subscriptionFee,
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
        if (!['host', 'x-payment', 'x-payment-proof', 'x-payment-token', 'x-payment-amount'].includes(lowerKey)) {
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
        
        if (fetchError.name === 'AbortError' || fetchError.code === 'ETIMEDOUT') {
          console.error("❌ Builder endpoint timeout - NOT charging user")
          return res.status(504).json({
            error: "Builder endpoint timeout",
            message: "The builder endpoint did not respond within 60 seconds. You have NOT been charged.",
            serverSlug,
            apiSlug,
            apiName: api.name,
            charged: false
          })
        }
        
        console.error("❌ Builder endpoint fetch error - NOT charging user:", fetchError)
        return res.status(502).json({
          error: "Builder endpoint error",
          message: "Failed to fetch from builder endpoint. You have NOT been charged.",
          serverSlug,
          apiSlug,
          apiName: api.name,
          charged: false
        })
      }
    } catch (forwardError: any) {
      console.error("❌ Error forwarding to builder - NOT charging user:", forwardError)
      return res.status(502).json({
        error: "Builder endpoint error",
        message: "Failed to reach builder endpoint. You have NOT been charged.",
        serverSlug,
        apiSlug,
        apiName: api.name,
        charged: false
      })
    }

    // STEP 2: If builder failed, return error WITHOUT charging
    if (!builderSuccess) {
      console.log(`❌ Builder returned error status ${builderResponse.status} - NOT charging user`)
      return res.status(builderResponse.status).json({
        error: "Builder endpoint returned error",
        message: "The API returned an error. You have NOT been charged.",
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
          amount: tokenEntry.subscriptionFee,
          paymentToken: tokenEntry.paymentToken,
          serverSlug,
          apiSlug,
        })
        
        const paymentResult = await executePaymentTransfer(
          paymentData,
          tokenEntry.paymentToken,
          req,
          tokenEntry.id,
          tokenEntry.subscriptionFee,
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
            paymentError: paymentResult.error,
            data: parsedData,
            serverSlug,
            apiSlug,
            charged: false
          })
        }

        console.log("✅ Payment executed successfully:", paymentResult.txHash)

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
                  globalRequestNumber
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
          data: parsedData,
          serverSlug,
          apiSlug,
          charged: false
        })
      }
    }

    // STEP 5: Return successful response with data
    console.log("✅ Returning successful response with payment confirmed")
    
    res.status(builderResponse.status).setHeader('Content-Type', 'application/json; charset=utf-8').json({
      data: parsedData,
    payment: {
      status: "paid",
        tokenAddress: tokenEntry.id,
        subscriptionFee: tokenEntry.subscriptionFee,
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
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "An unexpected error occurred",
      charged: false
    })
  }
}

// Handle GET requests for /api/:serverSlug/:apiSlug (slug-based routing)
app.get('/api/:serverSlug/:apiSlug', async (req, res) => {
  const serverSlug = req.params.serverSlug.toLowerCase()
  const apiSlug = req.params.apiSlug.toLowerCase()
  
  return handleApiProxyRequest(req, res, serverSlug, apiSlug)
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

