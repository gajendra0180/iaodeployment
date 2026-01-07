# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

APIX (IAO - Initial API Offering) is a decentralized API marketplace that enables developers to monetize their APIs through a bonding curve token model. The system consists of three main components across separate repositories:

- **Backend (this repo)**: Express.js proxy server that handles payment verification and request forwarding
- **Frontend**: `/home/error0180/ui-vercel-2` - React/Vite application for API marketplace UI
- **Smart Contracts**: `/home/error0180/hyperpie/contracts/IAO` - Solidity contracts for IAO token creation and bonding curve

### How It Works

1. **API Server Registration**: Developers register their APIs through the frontend, which creates an IAO token via smart contract
2. **Payment Flow (x402 Protocol)**: Users pay for API access using EIP-3009 payment authorization (signed off-chain, settled on-chain)
3. **Token Distribution**: Successful API calls trigger token minting following a bonding curve until graduation threshold
4. **Graduation**: When threshold is reached, liquidity deploys to Uniswap V4 for token trading

## Development Commands

### Backend (Express.js)
```bash
# Development server (uses tsx for TypeScript execution)
yarn dev

# Build TypeScript to JavaScript
yarn build

# Production server (runs compiled JS)
yarn start
```

### Frontend (React/Vite)
```bash
cd /home/error0180/ui-vercel-2

# Development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Smart Contracts (Foundry)
```bash
cd /home/error0180/hyperpie

# Build contracts
forge build

# Run tests
forge test

# Test with gas report
forge test --gas-report

# Deploy to testnet
make deploy-lrt-testnet
```

## Architecture

### Backend Proxy Flow (src/index.ts)

The proxy implements a "pay-after-success" model:

1. **Request arrives** at `/api/:serverSlug/:apiSlug`
2. **Lookup server** from DynamoDB by slug
3. **Verify payment authorization** (without settling) using `verifyPaymentAuthorization()`
4. **Forward to builder endpoint** - Call actual API first
5. **Settle payment** only if builder returns 2xx status via `executePaymentTransfer()`
6. **Update metrics** and subscription counts in DynamoDB
7. **Return response** to user with payment confirmation

Key principle: Users are only charged if the API successfully returns data.

### Payment Protocol (x402 V2)

- Uses EIP-3009 `transferWithAuthorization` for gasless payments
- Payment data sent in `PAYMENT-SIGNATURE` header (base64-encoded JSON)
- Thirdweb facilitator handles on-chain settlement
- Users sign payment to facilitator address, which forwards to token address

### Database Schema (DynamoDB)

**Table: apix-iao-tokens** (token metadata)
- `id` (PK): Token address (lowercase)
- `slug` (GSI): Server slug (e.g., "magpie")
- `apis[]`: Array of API endpoints with fees
- `subscriptionCount`: Total API calls across all APIs

**Table: apix-iao-user-requests** (user call history)
- `id` (PK): `{tokenAddress}#{userAddress}#{requestNumber}`
- `iaoToken` (GSI): Token address for querying

**Table: apix-iao-request-queue** (pending request queue)
- `id` (PK): `{tokenAddress}#{userAddress}#{requestNumber}`
- Used for automation to mint tokens after successful payments

**Table: apix-iao-metrics** (API performance metrics)
- `id` (PK): `{tokenAddress}#{apiSlug}`
- Tracks success/failure rates, latency, revenue

### Smart Contract Architecture

**IAOTokenFactory.sol** (`0x5a40F7f30b25D07aB1C06dEB7400554Bc20f8ad4` on Base Sepolia)
- Creates IAO tokens via minimal proxy clones
- Manages payment token configurations (price, decimals, graduation threshold)
- One token per server slug

**IAOToken.sol** (ERC20 + bonding curve)
- Distributes tokens on successful API payments via `receiveWithAuthorization()`
- Tracks `graduationThreshold` (62.5% of 1B tokens = 625M)
- Deploys Uniswap V4 liquidity on graduation via `deployLiquidity()`
- Uses LpGuardHook to prevent early liquidity removal

### Frontend Structure

- **Pages**: MarketplacePage, APIDetailsPage, OverviewPage (metrics), SubmitAPIForm, Dashboard
- **Hooks**: `useX402Payment.ts` - Handles EIP-3009 payment signing
- **API Client**: `utils/api.ts` - Calls backend endpoints
- **Thirdweb Integration**: Web3 wallet connection and transaction signing

## Environment Variables

### Backend (.env)
```bash
# Thirdweb x402 facilitator (required for payments)
THIRDWEB_SECRET_KEY=sk_...
THIRDWEB_SERVER_WALLET_ADDRESS=0x...

# DynamoDB configuration
DYNAMODB_REGION=us-west-1
DYNAMODB_ENDPOINT=http://localhost:8000  # Local testing only

# JWT authentication for builder endpoints
BUILDER_SECRET_PHRASE=your-shared-secret

# Server configuration
PORT=3000
NODE_ENV=development
```

### Frontend (.env)
```bash
VITE_THIRDWEB_CLIENT_ID=...
VITE_API_BASE_URL=http://localhost:3000
```

### Smart Contracts (.env)
```bash
PRIVATE_KEY=0x...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ETHERSCAN_API_KEY=...
```

## Key Files

### Backend
- `src/index.ts` - Main Express server with all API routes (2165 lines, monolithic)
- `src/services/dynamoDBService.ts` - DynamoDB CRUD operations for IAO tokens
- `src/services/userRequestService.ts` - Request queue and user history management
- `src/services/metricsService.ts` - API call metrics tracking
- `src/utils/jwtAuth.ts` - JWT generation for builder authentication
- `abis/IAOToken.json` - ABI for reading on-chain token state
- `abis/IAOTokenFactory.json` - ABI for factory contract

### Frontend
- `src/pages/SubmitAPIForm.tsx` - Server and API registration form
- `src/hooks/useX402Payment.ts` - Payment authorization signing logic
- `src/utils/api.ts` - Backend API client
- `src/contracts/tokenFactory.ts` - Smart contract interaction helpers

### Smart Contracts
- `contracts/IAO/IAOToken.sol` - Main token contract with bonding curve
- `contracts/IAO/IAOTokenFactory.sol` - Token creation factory
- `contracts/IAO/LpGuardHook.sol` - Uniswap V4 hook to prevent early LP removal
- `contracts/IAO/interfaces/` - Contract interfaces

## Important Implementation Details

### Server Registration Flow
1. Frontend calls `POST /api/register` with `tokenAddress` missing (validation mode)
2. Backend validates slug availability, API URLs are reachable (200 status), no duplicates
3. Frontend creates token via `IAOTokenFactory.createToken()`
4. Frontend calls `POST /api/register` again with `tokenAddress` (registration mode)
5. Backend stores token metadata in DynamoDB

### Payment Authorization (x402 V2)
- Payment signature must be to **facilitator address**, not token address
- Backend uses `verifyPaymentAuthorization()` to check signature validity
- After builder success, `executePaymentTransfer()` calls `settlePayment()` from thirdweb
- The facilitator forwards payment to the token address

### Builder Authentication
- Proxy generates JWT with `generateBuilderJWT()` and sends in `X-IAO-Auth` header
- Builders verify JWT using shared `BUILDER_SECRET_PHRASE`
- JWT contains: `iss: "iao-proxy"`, `aud: <endpoint>`, `tokenAddress`, `exp: 5min`

### Bonding Curve Logic (Smart Contract)
- Payment settled → `receiveWithAuthorization()` called on IAOToken
- Token amount calculated: `(fee * paymentTokenPrice) / (10^paymentTokenDecimals)`
- Tokens minted to payer's address
- Progress tracked: `totalTokensDistributed / graduationThreshold`
- At 100%: `deployLiquidity()` creates Uniswap V4 pool with LpGuardHook

## Testing & Debugging

### Check DynamoDB Tables (Local)
```bash
# Scan all servers
aws dynamodb scan --endpoint-url http://localhost:8000 --table-name apix-iao-tokens | jq

# Get server by slug
aws dynamodb query \
  --endpoint-url http://localhost:8000 \
  --table-name apix-iao-tokens \
  --index-name slug-index \
  --key-condition-expression "slug = :slug" \
  --expression-attribute-values '{":slug": {"S": "magpie"}}'
```

### Test API Endpoints
```bash
# Get all servers
curl http://localhost:3000/api/servers | jq

# Get server metadata
curl http://localhost:3000/api/server/magpie | jq

# Get server metrics (includes bonding progress)
curl http://localhost:3000/api/metrics/magpie | jq
```

### Common Issues

**"Builder endpoint validation failed"**: The API URL must return 200 status on GET request during registration

**"Payment recipient mismatch"**: User signed payment to wrong address - must be facilitator address, not token address

**"Thirdweb credentials not found"**: Set `THIRDWEB_SECRET_KEY` and `THIRDWEB_SERVER_WALLET_ADDRESS` in backend .env

**"Server slug already taken"**: Slug must be unique globally - each slug maps to one IAO token

## Contract Addresses (Base Sepolia)

- **IAOTokenFactory**: `0x5a40F7f30b25D07aB1C06dEB7400554Bc20f8ad4`
- **USDC (Mock)**: Check `paymentTokenInfo` mapping in factory

## Documentation References

- Builder JWT Authentication: `BUILDER_JWT_AUTH.md`
- Thirdweb Facilitator Setup: `THIRDWEB_SETUP.md`
- DynamoDB Query Examples: `QUERY_DYNAMODB.md`
- Table Creation Scripts: `CREATE_DYNAMODB_TABLES.sh`
