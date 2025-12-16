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

    // Verify and process payment using thirdweb's settlePayment
    if (thirdwebFacilitator && thirdwebClient) {
      const paymentData = req.headers['x-payment'] as string | undefined
      
      // Convert subscription fee from wei to USD string (assuming 6 decimals for USDC)
      const subscriptionFeeWei = BigInt(tokenEntry.subscriptionFee)
      const subscriptionFeeUSD = Number(subscriptionFeeWei) / 1e6
      const priceString = `$${subscriptionFeeUSD.toFixed(2)}`

      try {
        // Normalize HTTP method - HEAD requests should be treated as GET for payment verification
        // settlePayment only accepts: GET, POST, PUT, DELETE, PATCH
        let normalizedMethod = req.method.toUpperCase()
        if (normalizedMethod === 'HEAD') {
          normalizedMethod = 'GET'
        }
        
        // Ensure method is one of the supported methods
        const supportedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
        if (!supportedMethods.includes(normalizedMethod)) {
          normalizedMethod = 'GET' // Default to GET for unsupported methods
        }
        
        console.log("Calling settlePayment with:", {
          resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
          originalMethod: req.method,
          normalizedMethod,
          hasPaymentData: !!paymentData,
          payTo: tokenEntry.id,
          network: baseSepolia.id,
          networkName: baseSepolia.name,
          price: priceString,
          serverSlug: serverSlug,
          apiSlug: apiSlug,
        });
        
        const paymentResult = await settlePayment({
          resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
          method: normalizedMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
          paymentData,
          payTo: tokenEntry.id,
          network: baseSepolia, // Keep chain object for on-chain operations
          price: priceString,
          facilitator: thirdwebFacilitator,
          routeConfig: {
            description: `IAO Proxy - ${tokenEntry.name} (${tokenEntry.symbol}) - API: ${api.name}`,
            mimeType: "application/json",
            maxTimeoutSeconds: 300,
          },
        })
        
        console.log("settlePayment result:", {
          status: paymentResult.status,
          paymentReceipt: paymentResult.status === 200 ? paymentResult.paymentReceipt : undefined,
        });

        // If payment not verified, return 402 response
        if (paymentResult.status !== 200) {
          return res.status(paymentResult.status).json(paymentResult.responseBody)
        }

        // Payment verified - create RequestQueue entry
        if (userRequestService && paymentData) {
          try {
            // Decode payment data to extract user address
            const userAddress = extractUserAddressFromPayment(paymentData)
            
            if (userAddress && dynamoDBService) {
              // Get current subscription count from DynamoDB (this will be the globalRequestNumber)
              const tokenDBEntry = await dynamoDBService.getItem(tokenEntry.id)
              if (tokenDBEntry) {
                const currentSubscriptionCount = BigInt(tokenDBEntry.subscriptionCount || "0")
                const globalRequestNumber = (currentSubscriptionCount + BigInt(1)).toString()

                // Create RequestQueue entry
                await userRequestService.createRequestQueueEntry(
                  tokenEntry.id,
                  userAddress,
                  globalRequestNumber
                )

                // Update token's subscriptionCount in DynamoDB (aggregated across all APIs)
                const newSubscriptionCount = (currentSubscriptionCount + BigInt(1)).toString()
                const updatedTokenEntry: IAOTokenDBEntry = {
                  ...tokenDBEntry,
                  subscriptionCount: newSubscriptionCount,
                  updatedAt: new Date().toISOString(),
                }
                await dynamoDBService.putItem(updatedTokenEntry)
                console.log(`✅ Updated token subscriptionCount: ${newSubscriptionCount}`)
                console.log(`✅ Created RequestQueue entry for user ${userAddress} (globalRequestNumber: ${globalRequestNumber})`)
              }
            }
          } catch (queueError: any) {
            // Log error but don't fail the request - payment was already verified
            console.error("⚠️  Failed to create RequestQueue entry:", queueError)
          }
        }
      } catch (paymentError: any) {
        console.error("Payment verification error:", paymentError)
        console.error("Payment error details:", {
          message: paymentError.message,
          stack: paymentError.stack,
          name: paymentError.name,
          cause: paymentError.cause,
        })
        
        // Check if error is related to HEAD request validation
        // This happens when facilitator makes internal HEAD request for validation
        const isHeadRequestError = paymentError.message?.includes('HEAD') || 
                                   paymentError.message?.includes('invalid_literal')
        
        // If no payment data provided, return 402
        if (!paymentData) {
          // For HEAD request errors on testnet, facilitator may not fully support Base Sepolia
          // Return 402 with payment requirements anyway
          if (isHeadRequestError) {
            console.warn("⚠️  Facilitator HEAD request validation failed - this may indicate Base Sepolia support issues")
          }
          
          return res.status(402).json({
            error: "Payment required",
            message: "This endpoint requires payment. Please provide X-PAYMENT header.",
            accepts: [{
              scheme: "exact",
              network: `eip155:${baseSepolia.id}`, // Facilitator expects EIP-155 format: eip155:chainId
              payTo: tokenEntry.id,
              asset: tokenEntry.paymentToken,
              maxAmountRequired: tokenEntry.subscriptionFee,
            }],
          })
        }
        
        // If payment data provided but verification failed
        // For HEAD request errors, this might be a facilitator issue with Base Sepolia
        if (isHeadRequestError) {
          console.error("⚠️  Payment verification failed due to facilitator HEAD request issue")
          console.error("   This may indicate that thirdweb facilitator doesn't fully support Base Sepolia testnet")
          console.error("   Consider using Base mainnet or checking facilitator documentation")
        }
        
        return res.status(402).json({
          error: "Payment verification failed",
          message: paymentError.message || "Invalid payment proof",
          details: paymentError.stack || paymentError.toString(),
        })
      }
    } else {
      // If thirdweb facilitator not configured, skip payment verification
      console.warn("⚠️  Thirdweb facilitator not configured - skipping payment verification for /api/:address")
    }

    // Payment verified (or skipped if facilitator not configured)
    // Forward request to builder endpoint (use the specific API's URL)
    try {
      // Build builder endpoint URL with query parameters
      const builderUrl = new URL(api.apiUrl) // Use the specific API's URL
       
      // Copy all query parameters from proxy request to builder endpoint
      Object.keys(req.query).forEach((key: string) => {
        builderUrl.searchParams.set(key, req.query[key] as string)
      })

      console.log(`Forwarding request to builder endpoint: ${builderUrl.toString()}`)

      // Forward request to builder endpoint
      // Convert headers to proper format (string arrays to comma-separated strings)
      const forwardHeaders: Record<string, string> = {}
      Object.entries(req.headers).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase()
        if (!['host', 'x-payment-proof', 'x-payment-token', 'x-payment-amount'].includes(lowerKey)) {
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
            '5m' // Token expires in 5 minutes
          )
          forwardHeaders['X-IAO-Auth'] = jwtToken
          console.log("✅ Added JWT authentication header for builder endpoint")
        } catch (jwtError: any) {
          console.error("⚠️  Failed to generate JWT token:", jwtError)
          // Continue without JWT if generation fails
        }
      }
      
      console.log("Fetching from builder endpoint:", builderUrl.toString());
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout (increased from 30s)
      
      try {
        // Add timeout and connection settings for better reliability
        // Request without zstd compression (Node.js fetch doesn't support zstd decompression)
        const builderResponse = await fetch(builderUrl.toString(), {
          method: req.method,
          headers: {
            ...forwardHeaders,
            'User-Agent': 'IAO-Proxy/1.0',
            'Accept': 'application/json, */*',
            'Accept-Encoding': 'identity' // Request no compression to avoid zstd issues - Node.js fetch doesn't support zstd
          },
          // Forward body if present (for POST/PUT requests)
          body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        // Get response data - handle JSON and text responses properly
        let parsedData: any
        const contentType = builderResponse.headers.get('content-type') || ''
        const contentEncoding = builderResponse.headers.get('content-encoding') || ''
        
        console.log("Builder response headers:", {
          contentType,
          contentEncoding,
          status: builderResponse.status
        })
        
        // Handle zstd compression - Node.js fetch doesn't automatically decompress zstd
        if (contentEncoding && contentEncoding.toLowerCase().includes('zstd')) {
          console.warn("⚠️  Response header indicates zstd compression - attempting to parse anyway")
          console.warn("⚠️  Note: Node.js fetch doesn't support zstd decompression, but sometimes the header is incorrect")
          
          // Try to parse the response anyway - sometimes the Content-Encoding header is wrong
          // or the server sends uncompressed data despite the header
          try {
            const responseText = await builderResponse.text()
            console.log("Response as text (first 200 chars):", responseText.substring(0, 200))
            
            // Check if it looks like valid JSON (starts with { or [)
            if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
              try {
                parsedData = JSON.parse(responseText)
                console.log("✅ Successfully parsed zstd-flagged response as JSON (header may have been incorrect)")
              } catch (parseError: any) {
                // If JSON parsing fails, it might actually be compressed
                console.error("❌ Failed to parse as JSON - response may actually be zstd compressed")
                parsedData = {
                  error: "Unsupported compression",
                  message: "The API response is compressed with zstd, which is not supported. Please configure the API server to use gzip, deflate, or no compression.",
                  contentType,
                  contentEncoding,
                  suggestion: "The API server should be configured to not use zstd compression, or to respect the Accept-Encoding header"
                }
              }
            } else {
              // Doesn't look like JSON - likely actually compressed
              console.error("❌ Response doesn't look like JSON - likely actually zstd compressed")
              parsedData = {
                error: "Unsupported compression",
                message: "The API response is compressed with zstd, which is not supported. Please configure the API server to use gzip, deflate, or no compression.",
                contentType,
                contentEncoding,
                suggestion: "The API server should be configured to not use zstd compression"
              }
            }
          } catch (textError: any) {
            console.error("❌ Error reading zstd-flagged response:", textError)
            parsedData = {
              error: "Unsupported compression",
              message: "The API response is compressed with zstd, which is not supported.",
              contentType,
              contentEncoding
            }
          }
        } else {
          try {
            if (contentType.includes('application/json')) {
              // If content-type is JSON, parse it directly (handles gzip/deflate/br decompression automatically)
              parsedData = await builderResponse.json()
              console.log("✅ Parsed as JSON successfully, type:", typeof parsedData, Array.isArray(parsedData) ? 'array' : 'object')
            } else {
              // Otherwise, get as text and try to parse
              const responseText = await builderResponse.text()
              console.log("Response as text (first 200 chars):", responseText.substring(0, 200))
              try {
                parsedData = JSON.parse(responseText)
                console.log("✅ Parsed text as JSON successfully")
              } catch (parseError: any) {
                // If not valid JSON, return as string
                console.warn("⚠️  Response is not valid JSON, returning as text")
                parsedData = responseText
              }
            }
          } catch (parseError: any) {
            console.error("❌ Error parsing builder response:", parseError.message || parseError)
            // Check if it's a zstd-related error
            if (parseError.message && parseError.message.includes('zstd')) {
              parsedData = {
                error: "Unsupported compression",
                message: "The API response appears to be zstd compressed, which is not supported.",
                contentType,
                contentEncoding
              }
            } else {
              parsedData = { 
                error: "Failed to parse response", 
                message: parseError.message || "Unable to decode response",
                contentType,
                contentEncoding
              }
            }
          }
        }

        // Return builder response (payment already verified by thirdweb's settlePayment)
        // Ensure proper JSON encoding (hide builder endpoint from response)
        res.status(builderResponse.status).setHeader('Content-Type', 'application/json; charset=utf-8').json({
        data: parsedData,
        payment: {
          status: "paid",
          tokenAddress: tokenEntry.id,
          subscriptionFee: tokenEntry.subscriptionFee,
          paymentToken: tokenEntry.paymentToken
        },
          proxy: {
            serverSlug: serverSlug,
            apiSlug: apiSlug,
            apiName: api.name,
            timestamp: new Date().toISOString()
          }
        })

        // Payment settlement logged - automation will read from subgraph and mint rewards
        // Thirdweb facilitator verified and processed payment, automation handles token minting
        console.log("Payment settled for API - automation should mint rewards", {
          tokenAddress: tokenEntry.id,
          tokenSymbol: tokenEntry.symbol,
          serverSlug: serverSlug,
          apiSlug: apiSlug,
          apiName: api.name
        })

      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        // Handle timeout specifically
        if (fetchError.name === 'AbortError' || fetchError.code === 'ETIMEDOUT') {
          console.error("Builder endpoint timeout:", builderUrl.toString());
          return res.status(504).json({
            error: "Builder endpoint timeout",
            message: "The builder endpoint did not respond within 60 seconds",
            serverSlug: serverSlug,
            apiSlug: apiSlug,
            apiName: api.name,
            suggestion: "The builder endpoint may be slow or unavailable. Please try again later or contact the API builder."
          });
        }
        
        // Handle other fetch errors
        console.error("Error fetching from builder endpoint:", fetchError);
        return res.status(502).json({
          error: "Builder endpoint error",
          message: "Failed to fetch from builder endpoint",
          serverSlug: serverSlug,
          apiSlug: apiSlug,
          apiName: api.name,
          errorType: fetchError.type || fetchError.code || "unknown"
        });
      }
    } catch (forwardError: any) {
      console.error("Error forwarding to builder endpoint:", forwardError)
      return res.status(502).json({
        error: "Builder endpoint error",
        message: "Failed to fetch from builder endpoint",
        serverSlug: serverSlug,
        apiSlug: apiSlug,
        apiName: api.name
      })
    }

  } catch (error: any) {
    console.error("Error in IAO proxy endpoint:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "An unexpected error occurred"
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

