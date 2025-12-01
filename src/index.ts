import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import cors from 'cors'
import { paymentMiddleware } from 'x402-express'
import { facilitator } from '@coinbase/x402'
import { JsonRpcProvider, Contract, ethers } from 'ethers'
import fetch from 'node-fetch'

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

if (existsSync(publicPath)) {
  app.use(express.static(publicPath))
  
  // Serve frontend for all non-API routes (SPA routing)
  app.get('*', (req, res, next) => {
    // Skip API routes and other backend routes
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/mint-token') ||
        req.path.startsWith('/healthz') ||
        req.path.startsWith('/about') ||
        req.path.startsWith('/api-data')) {
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

// CDP x402 Payment Middleware for protected endpoints
// const receiverContract = "0x4334c769b915B8fA93707f0256AFA1F85ac83d46"
const receiverContract="0x4966baf06bfc7a9b566662bb52cfa718a2f60ee9"

const BASE_RPC_URL = "https://base-mainnet.public.blastapi.io"
// IAO Token Subgraph URL - queries iaotoken entities by token address (id)
const IAO_SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cm8plie9y1pjh01yea3kubv4c/subgraphs/IAO/dev/gn"
const mintPaths = new Set(["/mint-token", "/mint-token/50000"])

let provider: JsonRpcProvider | null = null
let tokenContract: Contract | null = null
let tokenDecimals: number | null = null
let cachedSubgraphSupply: bigint | null = null
let subgraphSupplyTimestamp = 0
const SUBGRAPH_CACHE_MS = 15_000
const MEME_SUPPLY_CAP = 1000_000_000n

if (BASE_RPC_URL) {
  try {
    provider = new JsonRpcProvider(BASE_RPC_URL)
    const tokenAbi = [
      "function totalSupply() view returns (uint256)",
      "function decimals() view returns (uint8)"
    ]
    tokenContract = new Contract(receiverContract, tokenAbi, provider)
    console.log("Token contract initialised successfully")
    console.log("Token contract totalSupply: ", await tokenContract.totalSupply())
    console.log("Token contract decimals: ", await tokenContract.decimals())

    const subgraphSupply = await getSubgraphSupply()
    console.log("Subgraph supply: ", subgraphSupply)
  } catch (error) {
    console.error("Failed to initialise provider/contract", error)
    provider = null
    tokenContract = null
  }
} else {
  console.warn("BASE_RPC_URL not set. Supply checks will be skipped and minting APIs disabled.")
}

async function ensureSupplyBelowCap(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Check if path is in mintPaths or starts with /api/ (IAO proxy endpoint)
  const isMintPath = mintPaths.has(req.path) || req.path.startsWith('/api/')
  if (!isMintPath) {
    return next()
  }

  // First, enforce supply based on the subgraph so we gate minting using indexed data
  try {
    const subgraphSupply = await getSubgraphSupply()
    if (subgraphSupply !== null && subgraphSupply >= MEME_SUPPLY_CAP) {
      return res.status(410).json({
        error: "Mint closed",
        message: "Total MEME supply tracked by subgraph has reached 1B. Mint endpoints are no longer available."
      })
    }
  } catch (error) {
    console.error("Error checking subgraph supply", error)
    return res.status(503).json({
      error: "Subgraph unavailable",
      message: "Unable to verify MEME supply from subgraph"
    })
  }

  if (!tokenContract) {
    return res.status(500).json({
      error: "Minting temporarily unavailable",
      message: "Token contract is not configured"
    })
  }

  try {
    if (tokenDecimals === null) {
      try {
        tokenDecimals = Number(await tokenContract.decimals())
      } catch (err) {
        console.warn("Failed to fetch token decimals, defaulting to 18", err)
        tokenDecimals = 18
      }
    }

    const maxSupply = ethers.parseUnits("10000000", tokenDecimals)
    const totalSupply: bigint = await tokenContract.totalSupply()

    if (totalSupply >= maxSupply) {
      return res.status(410).json({
        error: "Mint closed",
        message: "Total MEME supply has reached 10M. Mint endpoints are no longer available."
      })
    }

    return next()
  } catch (error) {
    console.error("Error checking token supply", error)
    return res.status(500).json({
      error: "Supply check failed",
      message: "Unable to verify remaining supply"
    })
  }
}

app.use(ensureSupplyBelowCap)

async function getSubgraphSupply(): Promise<bigint | null> {
  if (!IAO_SUBGRAPH_URL) {
    return null
  }
  console.log("Getting subgraph supply")

  const now = Date.now()
  if (cachedSubgraphSupply !== null && now - subgraphSupplyTimestamp < SUBGRAPH_CACHE_MS) {
    console.log("Cached subgraph supply: ", cachedSubgraphSupply)
    return cachedSubgraphSupply
  }

  const query = {
    query: `
      {
        iaotoken(id: "${receiverContract.toLowerCase()}") {
          subscriptionCount
        }
      }
    `
  }

  const response = await fetch(IAO_SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query)
  })

  if (!response.ok) {
    throw new Error(`Subgraph returned ${response.status}`)
  }

  console.log("Response: ", response)

  const payload = (await response.json()) as {
    data?: {
      iaotoken?: {
        subscriptionCount?: string
      }
    }
  }
  console.log("Payload: ", payload)
  const totalCount = payload?.data?.iaotoken?.subscriptionCount
  console.log("Total count: ", totalCount)
  if (!totalCount) {
    cachedSubgraphSupply = 0n
    subgraphSupplyTimestamp = now
    return cachedSubgraphSupply
  }

  const supply = BigInt(totalCount)
  cachedSubgraphSupply = supply
  subgraphSupplyTimestamp = now
  console.log("Supply: ", supply)
  return supply
}

// IAO Token Types (updated schema)
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

// Cache for IAO token entries
const iaoTokenCache = new Map<string, { data: IAOTokenEntry | null; timestamp: number }>()
const API_REGISTRY_CACHE_MS = 60_000 // Cache for 1 minute

/**
 * Query subgraph for IAO token entry by token address (id)
 */
async function getIAOTokenEntry(tokenAddress: string): Promise<IAOTokenEntry | null> {
  if (!IAO_SUBGRAPH_URL) {
    console.error("IAO_SUBGRAPH_URL not configured")
    return null
  }

  const addressLower = tokenAddress.toLowerCase()
  const now = Date.now()
  
  // Check cache
  const cached = iaoTokenCache.get(addressLower)
  if (cached && now - cached.timestamp < API_REGISTRY_CACHE_MS) {
    return cached.data
  }

  try {
    const query = {
      query: `
        {
          iaotoken(id: "${addressLower}") {
            id
            apiUrl
            builder
            name
            symbol
            subscriptionFee
            subscriptionTokenAmount
            paymentToken
          }
        }
      `
    }

    const response = await fetch(IAO_SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query)
    })

    if (!response.ok) {
      throw new Error(`Subgraph returned ${response.status}`)
    }

    console.log("Response Gajendra: ", response)
    const payload = (await response.json()) as {
      data?: {
        iaotoken?: IAOTokenEntry
      }
      errors?: Array<{ message: string }>
    }

    console.log("Payload Gajendra: ", payload)
    if (payload.errors) {
      console.error("Subgraph query errors:", payload.errors)
      iaoTokenCache.set(addressLower, { data: null, timestamp: now })
      return null
    }

    const tokenEntry = payload.data?.iaotoken || null
    iaoTokenCache.set(addressLower, { data: tokenEntry, timestamp: now })
    
    if (tokenEntry) {
      console.log(`Found IAO token entry for ${addressLower}:`, {
        name: tokenEntry.name,
        symbol: tokenEntry.symbol,
        apiUrl: tokenEntry.apiUrl,
        subscriptionFee: tokenEntry.subscriptionFee,
        paymentToken: tokenEntry.paymentToken
      })
    } else {
      console.log(`No IAO token entry found for ${addressLower}`)
    }

    console.log("Token entry Gajendra: ", tokenEntry)
    return tokenEntry
  } catch (error) {
    console.error(`Error querying IAO token for ${addressLower}:`, error)
    iaoTokenCache.set(addressLower, { data: null, timestamp: now })
    return null
  }
}

// Only add payment middleware if CDP credentials are available
if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) {
  console.log("🔐 Adding CDP x402 payment middleware for protected endpoints")
  
  app.use(paymentMiddleware(
    receiverContract, // receiving wallet address
    {  // Route configurations for protected endpoints
      "GET /mint-token": {
        price: "$0.01",
        network: "base", // Base mainnet
        config: {
          description: "Mint 500 MEME tokens for $0.01 USDC (testing tier). MEME supply is 10M and graduates at 100 USDC; endpoint then closes.",
          mimeType: "application/json",
          maxTimeoutSeconds: 300,
          discoverable: true, // Make this endpoint discoverable in x402 Bazaar
          outputSchema: {
            type: "object",
            properties: {
              payment: {
                type: "object",
                properties: {
                  status: { type: "string", description: "Payment settlement status" },
                  amount: { type: "string", description: "USDC amount charged" }
                }
              },
              mint: {
                type: "object",
                properties: {
                  tokensMinted: { type: "number", description: "Number of MEME tokens minted" },
                  message: { type: "string", description: "Summary of minting result" }
                }
              }
            }
          }
        }
      },
      "GET /mint-token/50000": {
        price: "$1",
        network: "base",
        config: {
          description: "Mint 50,000 MEME tokens for $1 USDC. MEME supply is 10M and graduates at 100 USDC; endpoint then closes.",
          mimeType: "application/json",
          maxTimeoutSeconds: 300,
          outputSchema: {
            type: "object",
            properties: {
              payment: {
                type: "object",
                properties: {
                  status: { type: "string", description: "Payment settlement status" },
                  amount: { type: "string", description: "USDC amount charged" }
                }
              },
              mint: {
                type: "object",
                properties: {
                  tokensMinted: { type: "number", description: "Number of MEME tokens minted" },
                  message: { type: "string", description: "Summary of minting result" }
                }
              }
            }
          }
        }
      },
      "GET /api/*": {
        price: "$0.01", // Default price - will be validated against subgraph subscriptionFee in middleware
        network: "base",
        config: {
          description: "IAO Proxy endpoint - routes to registered APIs after payment verification. Actual fee from subgraph.",
          mimeType: "application/json",
          maxTimeoutSeconds: 300,
          discoverable: false // Don't list individual APIs in Bazaar
        }
      },
    },
    facilitator // CDP facilitator for mainnet
  ))
} else {
  console.log("⚠️  CDP credentials not found - x402 payment middleware not enabled")
  console.log("   Set CDP_API_KEY_ID and CDP_API_KEY_SECRET to enable payment protection")
}

// Home route - HTML
app.get('/', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>X402 MEME Server</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/api-data">API Data</a>
          <a href="/mint-token">Mint Tokens ($0.01)</a>
          <a href="/mint-token/50000">Mint 50K Tokens ($1)</a>
          <a href="/healthz">Health</a>
        </nav>
        <h1>Welcome to MEME Server with x402 🚀</h1>
        <p>This is a minimal example with CDP x402 payment integration.</p>
        <p><strong>New:</strong> Mint 500 meme tokens instantly for $0.01 USDC!</p>
        <img src="/logo.png" alt="Logo" width="120" />
      </body>
    </html>
  `)
})

app.get('/about', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'about.htm'))
})

// Example API endpoint - JSON
app.get('/api-data', (req, res) => {
  res.json({
    message: 'Here is some sample API data',
    items: ['apple', 'banana', 'cherry'],
  })
})

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

/**
 * IAO Proxy Endpoint: /api/:address
 * 
 * Flow (same as /mint-token/50000):
 * 1. paymentMiddleware handles payment verification automatically
 * 2. If payment verified, handler queries subgraph and forwards to builder endpoint
 * 3. Return builder response to user
 * 
 * @param address - IAO token address (id from subgraph)
 */
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
    // Query subgraph for IAO token entry
    const tokenEntry = await getIAOTokenEntry(tokenAddress)

    console.log("Token entry Gajendra: ", tokenEntry)

    if (!tokenEntry) {
      return res.status(404).json({
        error: "API not found",
        message: `No IAO token registered with address ${tokenAddress}`
      })
    }

    // If we reach this point, payment has been verified by paymentMiddleware (same as /mint-token/50000)
    // Forward request to builder endpoint (payment already verified by paymentMiddleware)
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

        // Return builder response (payment already verified by paymentMiddleware, same as /mint-token/50000)
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
        // Same flow as /mint-token/50000 - paymentMiddleware verified payment, automation handles token minting
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

// Meme token mint endpoint - $0.01 USDC
// Payment verification is handled by CDP middleware
app.get('/mint-token', (req, res) => {
  // If we reach this point, payment has been verified by CDP middleware
  res.json({
    payment: {
      status: "paid",
      amount: "$0.01"
    },
    mint: {
      tokensMinted: 500,
      message: "500 MEME tokens will be delivered to your wallet shortly"
    },
    timestamp: new Date().toISOString()
  })
})

app.get('/mint-token/50000', (req, res) => {
  res.json({
    payment: {
      status: "paid",
      amount: "$1"
    },
    mint: {
      tokensMinted: 50000,
      message: "50,000 MEME tokens will be delivered to your wallet shortly"
    },
    timestamp: new Date().toISOString()
  })
})

// Start server if running directly (not in Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    console.log(`🚀 Express server with CDP x402 running on port ${PORT}`)
    console.log(`📱 Base URL: http://localhost:${PORT}`)
    console.log(`🔗 Network: Base Mainnet`)
    console.log(`💰 Payment Asset: USDC on Base Mainnet`)
    console.log(`💰 Facilitator: Coinbase CDP`)
    console.log(`🌐 Bazaar: Endpoint discoverable in x402 Bazaar`)
    console.log(`\n📍 Available endpoints:`)
    console.log(`   GET /                    - Home page`)
    console.log(`   GET /about               - About page`)
    console.log(`   GET /api-data            - Sample API data`)
    console.log(`   GET /api/:address        - IAO Proxy endpoint (query IAO token from subgraph, handle payment, forward to builder)`)
    console.log(`   GET /mint-token          - Mint 500 tokens for $0.01 USDC`)
    console.log(`   GET /mint-token/50000    - Mint 50,000 tokens for $1 USDC`)
    console.log(`   GET /healthz             - Health check`)
    console.log(`\n⚙️  Set CDP_API_KEY_ID and CDP_API_KEY_SECRET for payment protection`)
    console.log(`   Set IAO_SUBGRAPH_URL for IAO API registry queries`)
  })
}

export default app
