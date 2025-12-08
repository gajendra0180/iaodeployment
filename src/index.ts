import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import cors from 'cors'
import { facilitator as thirdwebFacilitatorFn, settlePayment } from 'thirdweb/x402'
import { createThirdwebClient } from 'thirdweb'
import { baseSepolia } from 'thirdweb/chains'
import fetch from 'node-fetch'
import { DynamoDBService, IAOTokenDBEntry } from './services/dynamoDBService.js'
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
const DYNAMODB_REGION = process.env.DYNAMODB_REGION || "us-east-1"
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "iao-tokens"
const USER_REQUEST_TABLE_NAME = process.env.USER_REQUEST_TABLE_NAME || "iao-user-requests"
const REQUEST_QUEUE_TABLE_NAME = process.env.REQUEST_QUEUE_TABLE_NAME || "iao-request-queue"
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

// IAO Token Types
interface IAOTokenEntry {
  id: string // Token address (used as identifier)
  apiUrl: string // Builder endpoint URL
  builder: string // Builder address
  name: string // Token name
  symbol: string // Token symbol
  subscriptionFee: string // Fee amount in smallest unit of payment token
  subscriptionTokenAmount: string // Amount of tokens to mint
  paymentToken: string // Payment token address (e.g., USDC)
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
        apiUrl: dbEntry.apiUrl,
        builder: dbEntry.builder,
        name: dbEntry.name,
        symbol: dbEntry.symbol,
        subscriptionFee: dbEntry.subscriptionFee,
        subscriptionTokenAmount: dbEntry.subscriptionTokenAmount,
        paymentToken: dbEntry.paymentToken,
      }
      console.log(`✅ Found IAO token in DynamoDB: ${addressLower}`)
      return tokenEntry
    }
    console.log(`❌ No IAO token entry found for ${addressLower}`)
    return null
  } catch (error) {
    console.error(`Error querying DynamoDB for ${addressLower}:`, error)
    return null
  }
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
 * POST /api/register - Register a new IAO token and API endpoint
 * 
 * This endpoint accepts token creation data and stores it in DynamoDB.
 * The frontend should call this after successfully creating a token on-chain.
 * 
 * Request body:
 * {
 *   tokenAddress: string (0x...),
 *   name: string,
 *   symbol: string,
 *   apiUrl: string,
 *   builder: string (0x...),
 *   paymentToken: string (0x...),
 *   subscriptionFee: string (BigInt as string),
 *   subscriptionTokenAmount: string (BigInt as string),
 *   maxSubscriptionCount?: string (BigInt as string, optional)
 * }
 */
app.post('/api/register', async (req, res) => {
  try {
    const {
      tokenAddress,
      name,
      symbol,
      apiUrl,
      builder,
      paymentToken,
      subscriptionFee,
      subscriptionTokenAmount,
      maxSubscriptionCount,
    } = req.body

    // Validate required fields
    if (!tokenAddress || !name || !symbol || !apiUrl || !builder || !paymentToken || !subscriptionFee || !subscriptionTokenAmount) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "tokenAddress, name, symbol, apiUrl, builder, paymentToken, subscriptionFee, and subscriptionTokenAmount are required"
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
        message: "DynamoDB service is not available. Please configure DYNAMODB_REGION and DYNAMODB_TABLE_NAME"
      })
    }

    // Check if token already exists
    const existingToken = await dynamoDBService.getItem(tokenAddress.toLowerCase())
    if (existingToken) {
      return res.status(409).json({
        error: "Token already registered",
        message: `Token ${tokenAddress} is already registered`,
        token: {
          id: existingToken.id,
          name: existingToken.name,
          symbol: existingToken.symbol,
          apiUrl: existingToken.apiUrl,
        }
      })
    }

    // Create token entry
    const now = new Date().toISOString()
    const tokenEntry: IAOTokenDBEntry = {
      id: tokenAddress.toLowerCase(),
      name,
      symbol,
      apiUrl,
      builder: builder.toLowerCase(),
      paymentToken: paymentToken.toLowerCase(),
      subscriptionFee: subscriptionFee.toString(),
      subscriptionTokenAmount: subscriptionTokenAmount.toString(),
      maxSubscriptionCount: maxSubscriptionCount?.toString() || "0",
      subscriptionCount: "0",
      refundCount: "0",
      fulfilledCount: "0",
      createdAt: now,
      updatedAt: now,
    }

    // Store in DynamoDB
    await dynamoDBService.putItem(tokenEntry)

    console.log(`✅ Registered new IAO token: ${tokenAddress} (${name}/${symbol})`)

    return res.status(201).json({
      success: true,
      message: "Token registered successfully",
      token: {
        id: tokenEntry.id,
        name: tokenEntry.name,
        symbol: tokenEntry.symbol,
        apiUrl: tokenEntry.apiUrl,
        builder: tokenEntry.builder,
        paymentToken: tokenEntry.paymentToken,
        subscriptionFee: tokenEntry.subscriptionFee,
        subscriptionTokenAmount: tokenEntry.subscriptionTokenAmount,
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
 * GET /api/token/:address - Get token metadata (no payment required)
 * 
 * Returns token information from DynamoDB without processing payment
 * 
 * @param address - IAO token address
 */
app.get('/api/token/:address', async (req, res) => {
  const tokenAddress = req.params.address

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/i.test(tokenAddress)) {
    return res.status(400).json({
      error: "Invalid address format",
      message: "Token address must be a valid Ethereum address"
    })
  }

  try {
    const tokenEntry = await getIAOTokenEntry(tokenAddress)

    if (!tokenEntry) {
      return res.status(404).json({
        error: "Token not found",
        message: `No IAO token registered with address ${tokenAddress}`
      })
    }

    console.log("All tokens: ", await dynamoDBService.scanAllItems());
    // Get all user requests
    const allUserRequests = await userRequestService.scanAllUserRequests();

    // Get all request queue entries
    const allRequestQueue = await userRequestService.scanAllRequestQueue();

    console.log("All user requests: ", allUserRequests);
    console.log("All request queue: ", allRequestQueue);

    return res.status(200).json({
      success: true,
      token: tokenEntry
    })
  } catch (error: any) {
    console.error("Error fetching token:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to fetch token"
    })
  }
})

/**
 * GET /api/tokens - Get all registered IAO tokens
 * Returns all tokens from DynamoDB
 */
app.get('/api/tokens', async (req, res) => {
  try {
    if (!dynamoDBService) {
      return res.status(503).json({
        error: "DynamoDB not configured",
        message: "DynamoDB service is not available"
      })
    }

    const tokens = await dynamoDBService.scanAllItems()
    return res.status(200).json({
      success: true,
      count: tokens.length,
      tokens
    })
  } catch (error: any) {
    console.error("Error fetching all tokens:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "Failed to fetch tokens"
    })
  }
})

/**
 * IAO Proxy Endpoint: /api/:address
 * 
 * Flow with Thirdweb facilitator:
 * 1. Query DynamoDB for IAO token entry
 * 2. Use thirdweb's settlePayment() to verify and process payment
 * 3. If payment verified, forward request to builder endpoint
 * 4. Return builder response to user
 * 
 * @param address - IAO token address (id from DynamoDB)
 */
// Handle HEAD requests - facilitator uses these for validation
app.head('/api/:address', async (req, res) => {
  // For HEAD requests, just return 200 OK with proper headers
  // The facilitator uses HEAD to validate the resource exists
  res.status(200).end()
})

// Handle GET requests for /api/:address
app.get('/api/:address', async (req, res) => {
  const tokenAddress = req.params.address

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/i.test(tokenAddress)) {
    return res.status(400).json({
      error: "Invalid address format",
      message: "Token address must be a valid Ethereum address"
    })
  }

  try {
    // Query DynamoDB for IAO token entry
    const tokenEntry = await getIAOTokenEntry(tokenAddress)

    console.log("Token entry Gajendra: ", tokenEntry)

    if (!tokenEntry) {
      return res.status(404).json({
        error: "API not found",
        message: `No IAO token registered with address ${tokenAddress}`
      })
    }

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
            description: `IAO Proxy endpoint - ${tokenEntry.name} (${tokenEntry.symbol})`,
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
              const tokenDBEntry = await dynamoDBService.getItem(tokenAddress.toLowerCase())
              if (tokenDBEntry) {
                const currentSubscriptionCount = BigInt(tokenDBEntry.subscriptionCount || "0")
                const globalRequestNumber = (currentSubscriptionCount + BigInt(1)).toString()

                // Create RequestQueue entry
                await userRequestService.createRequestQueueEntry(
                  tokenAddress,
                  userAddress,
                  globalRequestNumber
                )

                // Update token's subscriptionCount in DynamoDB
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
    // Forward request to builder endpoint
    try {
      // Build builder endpoint URL with query parameters
      const builderUrl = new URL(tokenEntry.apiUrl)
      // const builderUrl = new URL("https://api.github.com/users"); // TODO : just for testing purpose
       
      // Copy all query parameters from proxy request to builder endpoint
      Object.keys(req.query).forEach(key => {
        builderUrl.searchParams.set(key, req.query[key] as string)
      })

      console.log(`Forwarding request to builder endpoint: ${builderUrl.toString()}`)

      // Forward request to builder endpoint
      // Convert headers to proper format (string arrays to comma-separated strings)
      const forwardHeaders: Record<string, string> = {}
      Object.entries(req.headers).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase()
        if (!['host', 'x-payment-proof', 'x-payment-token', 'x-payment-amount'].includes(lowerKey)) {
          forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : (value || '')
        }
      })

      // Add JWT authentication header if secret phrase is configured
      if (BUILDER_SECRET_PHRASE) {
        try {
          const jwtToken = generateBuilderJWT(
            tokenAddress,
            tokenEntry.apiUrl,
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
        const builderResponse = await fetch(builderUrl.toString(), {
          method: req.method,
          headers: {
            ...forwardHeaders,
            'User-Agent': 'IAO-Proxy/1.0',
            'Accept': 'application/json, */*'
          },
          // Forward body if present (for POST/PUT requests)
          body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        // Get response data
        const responseData = await builderResponse.text()
        let parsedData: any
        try {
          parsedData = JSON.parse(responseData)
        } catch {
          parsedData = responseData
        }

        // Return builder response (payment already verified by thirdweb's settlePayment)
        res.status(builderResponse.status).json({
        data: parsedData,
        payment: {
          status: "paid",
          tokenAddress: tokenEntry.id,
          subscriptionFee: tokenEntry.subscriptionFee,
          paymentToken: tokenEntry.paymentToken
        },
          proxy: {
            builderEndpoint: tokenEntry.apiUrl,
            timestamp: new Date().toISOString()
          }
        })

        // Payment settlement logged - automation will read from subgraph and mint rewards
        // Thirdweb facilitator verified and processed payment, automation handles token minting
        console.log("Payment settled for API - automation should mint rewards", {
          tokenAddress: tokenEntry.id,
          tokenSymbol: tokenEntry.symbol,
          subscriptionTokenAmount: tokenEntry.subscriptionTokenAmount,
          builderEndpoint: tokenEntry.apiUrl
        })

      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        
        // Handle timeout specifically
        if (fetchError.name === 'AbortError' || fetchError.code === 'ETIMEDOUT') {
          console.error("Builder endpoint timeout:", builderUrl.toString());
          return res.status(504).json({
            error: "Builder endpoint timeout",
            message: "The builder endpoint did not respond within 60 seconds",
            builderEndpoint: tokenEntry.apiUrl,
            suggestion: "The builder endpoint may be slow or unavailable. Please try again later or contact the API builder."
          });
        }
        
        // Handle other fetch errors
        console.error("Error fetching from builder endpoint:", fetchError);
        return res.status(502).json({
          error: "Builder endpoint error",
          message: fetchError.message || "Failed to fetch from builder endpoint",
          builderEndpoint: tokenEntry.apiUrl,
          errorType: fetchError.type || fetchError.code || "unknown"
        });
      }
    } catch (forwardError: any) {
      console.error("Error forwarding to builder endpoint:", forwardError)
      return res.status(502).json({
        error: "Builder endpoint error",
        message: forwardError.message || "Failed to fetch from builder endpoint",
        builderEndpoint: tokenEntry.apiUrl
      })
    }

  } catch (error: any) {
    console.error("Error in IAO proxy endpoint:", error)
    return res.status(500).json({
      error: "Internal server error",
      message: error.message || "An unexpected error occurred"
    })
  }
})


// Start server if running directly (not in Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    console.log(`🚀 Express server running on port ${PORT}`)
    console.log(`📱 Base URL: http://localhost:${PORT}`)
    console.log(`🔗 Network: Base Mainnet`)
    console.log(`💰 Payment Asset: USDC on Base Mainnet`)
    console.log(`💰 Facilitator: Thirdweb`)
    console.log(`\n📍 Available endpoints:`)
    console.log(`   POST /api/register       - Register new IAO token and API endpoint in DynamoDB`)
    console.log(`   GET /api/tokens          - Get all registered IAO tokens`)
    console.log(`   GET /api/token/:address  - Get token metadata (no payment required)`)
    console.log(`   GET /api/:address        - IAO Proxy endpoint (query IAO token from DynamoDB, handle payment, forward to builder)`)
    console.log(`\n⚙️  Configuration:`)
    console.log(`   - Set THIRDWEB_SECRET_KEY and THIRDWEB_SERVER_WALLET_ADDRESS for payment processing`)
    console.log(`   - Set DYNAMODB_REGION and DYNAMODB_TABLE_NAME for IAO token storage`)
    console.log(`   - Set BUILDER_SECRET_PHRASE for JWT authentication with builder endpoints`)
  })
}

export default app
