# AP2/x402 Payment Protocol Research

This document summarizes research on payment protocols relevant to the APIX platform, including our current implementation and potential future migration paths.

## Table of Contents

1. [Current Implementation (Thirdweb x402)](#current-implementation-thirdweb-x402)
2. [x402 Protocol Overview](#x402-protocol-overview)
3. [Coinbase CDP Facilitator](#coinbase-cdp-facilitator)
4. [Google AP2 (Agent Payments Protocol)](#google-ap2-agent-payments-protocol)
5. [A2A x402 Extension](#a2a-x402-extension)
6. [Migration Considerations](#migration-considerations)
7. [Key Links](#key-links)

---

## Current Implementation (Thirdweb x402)

### How It Works

Our current payment system uses Thirdweb's x402 facilitator implementation:

1. **User signs payment authorization** using EIP-3009 `transferWithAuthorization`
2. **Payment data sent in header** - Base64-encoded JSON in `PAYMENT-SIGNATURE` header
3. **Proxy verifies signature** via `verifyPaymentAuthorization()` before forwarding request
4. **On success, payment settles** via `executePaymentTransfer()` which calls Thirdweb's `settlePayment()`
5. **Thirdweb facilitator executes on-chain** - Handles the actual token transfer

### Key Components

```typescript
// Payment signature header format
{
  "signature": "0x...",
  "payload": {
    "from": "0xUserAddress",
    "to": "0xFacilitatorAddress",  // Must be facilitator, not token
    "value": "1000000",            // Amount in smallest unit
    "validAfter": 0,
    "validBefore": 1234567890,
    "nonce": "0x..."
  }
}
```

### Limitations

1. **No transaction hash returned** - Thirdweb's `settlePayment()` does not return the on-chain transaction hash, making it difficult to verify settlements on-chain or provide users with transaction receipts.

2. **Opaque processing** - The settlement process is a black box; we trust Thirdweb executed correctly but have no visibility into the actual on-chain transaction.

3. **Single facilitator dependency** - All payments route through Thirdweb's facilitator address.

4. **Limited error information** - When settlements fail, error messages are generic.

### Why We're Staying With It

Despite limitations, migrating away from Thirdweb is not currently worth the effort because:

- **It works reliably** - Payments settle correctly
- **Already integrated** - Significant code written around their API
- **Migration cost high** - Would need to update frontend payment signing, backend verification, and settlement logic
- **Transaction hashes are nice-to-have** - Not critical for MVP functionality
- **Thirdweb may improve** - They might add tx hash returns in future updates

**Decision**: Stay with Thirdweb for now. Revisit if transaction hashes become a hard requirement.

---

## x402 Protocol Overview

x402 is an open payment protocol standard created by Coinbase that enables seamless crypto payments for API access using the HTTP 402 "Payment Required" status code.

### Core Concepts

1. **HTTP 402 Payment Required** - Standard HTTP status code repurposed for crypto payments
2. **EIP-3009 Authorization** - Gasless token transfers via signed messages
3. **Facilitator Pattern** - Third party settles payments on-chain

### Flow Diagram

```
┌──────────┐    1. Request     ┌──────────┐
│  Client  │ ───────────────▶  │  Server  │
└──────────┘                   └──────────┘
     │                              │
     │  2. 402 Payment Required     │
     │◀─────────────────────────────│
     │                              │
     │  3. Sign EIP-3009 auth       │
     ▼                              │
┌──────────┐                        │
│  Wallet  │                        │
└──────────┘                        │
     │                              │
     │  4. Request + PAYMENT-SIGNATURE
     │─────────────────────────────▶│
     │                              │
     │                    5. Verify & Forward
     │                              │
     │                    6. Settle Payment
     │                              ▼
     │                        ┌───────────┐
     │                        │Facilitator│
     │                        └───────────┘
     │                              │
     │  7. Response + Receipt       │
     │◀─────────────────────────────│
```

### PAYMENT-SIGNATURE Header Format

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base-sepolia",
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0xPayer",
      "to": "0xFacilitator",
      "value": "1000000",
      "validAfter": "0",
      "validBefore": "1735689600",
      "nonce": "0x..."
    }
  }
}
```

### EIP-3009 transferWithAuthorization

The payment signature authorizes a token transfer without requiring the payer to submit a transaction:

```solidity
function transferWithAuthorization(
    address from,
    address to,
    uint256 value,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce,
    bytes memory signature
) external;
```

Benefits:
- **Gasless for users** - Facilitator pays gas
- **Atomic with API call** - Payment only settles if API succeeds
- **Replay protection** - Nonce prevents double-spending

---

## Coinbase CDP Facilitator

Coinbase provides a production-ready x402 facilitator service as part of their CDP (Coinbase Developer Platform).

### Endpoints

| Environment | URL |
|-------------|-----|
| **Testnet** | `https://x402.org/facilitator` |
| **Mainnet** | `https://api.cdp.coinbase.com/platform/v2/x402` |

### Key Features

1. **Returns transaction hashes** - Unlike Thirdweb, CDP returns the actual on-chain tx hash
2. **Fee-free on Base/Solana** - No additional fees beyond gas on supported chains
3. **Open source client libraries** - TypeScript, Go, Python SDKs available
4. **Standardized API** - Follows x402 specification exactly

### Settlement Response

```json
{
  "success": true,
  "transactionHash": "0x1234567890abcdef...",
  "network": "base-sepolia",
  "settledAt": "2024-01-15T10:30:00Z"
}
```

### Integration Example

```typescript
import { settlePayment } from '@coinbase/x402';

const result = await settlePayment({
  paymentSignature: req.headers['payment-signature'],
  facilitatorUrl: 'https://api.cdp.coinbase.com/platform/v2/x402',
  recipient: tokenAddress,
});

console.log('Transaction hash:', result.transactionHash);
```

---

## Google AP2 (Agent Payments Protocol)

AP2 (Agent-to-Payments) is Google's protocol announced in late 2024/early 2025 for enabling AI agents to make payments autonomously.

### Overview

- **60+ launch partners** including Stripe, PayPal, Visa, Mastercard
- **Part of Google's Agent ecosystem** with Agentspace
- **Payment-agnostic** - Supports cards, crypto, bank transfers
- **Built on A2A protocol** - Agent-to-Agent communication standard

### Mandate System

AP2 uses a "mandate" concept where users pre-authorize agents to make payments within specified limits:

#### Intent Mandate
User authorizes agent to make purchases matching certain criteria:
```json
{
  "type": "intent",
  "maxAmount": 100,
  "currency": "USD",
  "categories": ["food", "transportation"],
  "validUntil": "2024-12-31"
}
```

#### Cart Mandate
User approves a specific transaction:
```json
{
  "type": "cart",
  "items": [
    {"name": "API Credits", "amount": 50}
  ],
  "total": 50,
  "currency": "USDC"
}
```

### How AP2 Works

```
┌─────────┐     1. User Request    ┌─────────┐
│  User   │ ────────────────────▶  │  Agent  │
└─────────┘                        └─────────┘
     │                                  │
     │                    2. Find relevant APIs/services
     │                                  │
     │  3. Payment mandate request      │
     │◀─────────────────────────────────│
     │                                  │
     │  4. User approves mandate        │
     │─────────────────────────────────▶│
     │                                  │
     │                    5. Agent makes payment
     │                                  │
     │  6. Task completed + receipt     │
     │◀─────────────────────────────────│
```

### Relevance to APIX

AP2 is primarily designed for agent-to-human payment authorization, not API micropayments. However, as AI agents become first-class consumers of APIs, AP2 could become relevant for:

- Agents purchasing API credits on behalf of users
- Multi-service agent workflows that need payment authorization
- Enterprise agent deployments with spending controls

---

## A2A x402 Extension

The A2A (Agent-to-Agent) protocol has an x402 extension specifically for crypto payments between agents.

### Overview

- **Developed by**: Google with community contributions
- **Purpose**: Enable crypto payments in A2A workflows
- **GitHub**: `google-agentic-commerce/a2a-x402`

### Three-Stage Payment Flow

Unlike standard x402 (single round-trip), A2A x402 uses three stages:

```
Stage 1: payment-required
┌─────────────┐    Request     ┌─────────────┐
│ Agent (Buy) │ ─────────────▶ │ Agent (Sell)│
└─────────────┘                └─────────────┘
                                     │
                  402 + payment details
                 ◀───────────────────│

Stage 2: payment-submitted
┌─────────────┐                ┌─────────────┐
│ Agent (Buy) │                │ Agent (Sell)│
└─────────────┘                └─────────────┘
     │                               │
     │  Request + payment-submitted  │
     │ (signature attached)          │
     │──────────────────────────────▶│
     │                               │
     │        202 Accepted           │
     │◀──────────────────────────────│

Stage 3: payment-completed
┌─────────────┐                ┌─────────────┐
│ Agent (Buy) │                │ Agent (Sell)│
└─────────────┘                └─────────────┘
     │                               │
     │  Facilitator settles ─────────┤
     │                               │
     │     200 + payment-completed   │
     │       (with tx hash)          │
     │◀──────────────────────────────│
```

### A2A x402 Headers

```
# Stage 1: Server requests payment
X-Payment-Required: true
X-Payment-Amount: 1000000
X-Payment-Token: 0xUSDCAddress
X-Payment-Network: base-sepolia

# Stage 2: Client submits payment
X-Payment-Submitted: <base64-encoded-signature>

# Stage 3: Server confirms settlement
X-Payment-Completed: true
X-Payment-TxHash: 0x...
```

### Use Cases

1. **Agent-to-agent API calls** - AI agents paying other agents for services
2. **Multi-agent workflows** - Complex pipelines where agents pay each other
3. **Autonomous agent operations** - Agents with crypto wallets transacting independently

### Current Limitations

- Still experimental
- Limited tooling/SDK support
- Requires agents to have wallet access
- Not widely adopted yet

---

## Migration Considerations

### Current State: Thirdweb x402

| Aspect | Status |
|--------|--------|
| Stability | Stable, production-ready |
| Transaction Hashes | Not returned |
| Integration Effort | Already complete |
| Documentation | Good |
| Support | Active |

### Option 1: Migrate to CDP Facilitator

**When to consider:**
- Transaction hashes become a hard requirement
- Need standardized x402 implementation
- Want to leverage Coinbase ecosystem

**Migration effort:**
1. Update `executePaymentTransfer()` to use CDP endpoint
2. Update response handling to capture tx hash
3. Store tx hash in database records
4. Update API responses to include tx hash

**Estimated effort:** 2-3 days

### Option 2: A2A x402 for Agent Commerce

**When to consider:**
- Building agent-to-agent marketplace
- Agents need to autonomously pay for services
- Complex multi-agent workflows

**Migration effort:**
1. Implement three-stage payment flow
2. Add A2A protocol support
3. Update agent tool execution to handle payment states
4. Significant architecture changes

**Estimated effort:** 1-2 weeks

### Recommendation

```
Now:        Stay with Thirdweb (works, already integrated)
                    │
                    ▼
If tx hashes needed: Migrate to CDP Facilitator (minimal changes)
                    │
                    ▼
Long-term:  Evaluate A2A x402 when agent commerce matures
```

### Decision Matrix

| Scenario | Recommendation |
|----------|----------------|
| Current MVP | Stay with Thirdweb |
| Need tx hashes | Migrate to CDP |
| Agent marketplace | Evaluate A2A x402 |
| Enterprise compliance | CDP (better audit trail) |
| Maximum flexibility | CDP (open standard) |

---

## Key Links

### x402 Protocol
- **Coinbase x402 GitHub**: https://github.com/coinbase/x402
- **x402 Documentation**: https://docs.cdp.coinbase.com/x402/welcome
- **x402.org (Testnet)**: https://x402.org

### A2A Protocol
- **A2A x402 Extension**: https://github.com/google-agentic-commerce/a2a-x402
- **A2A Protocol Spec**: https://github.com/google/A2A

### Google AP2
- **AP2 Announcement Blog**: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
- **Google Agentspace**: https://cloud.google.com/agentspace

### EIP-3009
- **EIP-3009 Specification**: https://eips.ethereum.org/EIPS/eip-3009
- **USDC Implementation**: https://github.com/centrehq/centre-tokens

### Current Implementation
- **Thirdweb x402 Docs**: https://portal.thirdweb.com/connect/pay/x402

---

## Appendix: Code Comparison

### Current Thirdweb Settlement

```typescript
// Current implementation - no tx hash returned
const result = await settlePayment({
  paymentSignature: paymentData,
  thirdwebSecretKey: process.env.THIRDWEB_SECRET_KEY,
});
// result.success but no result.transactionHash
```

### CDP Settlement (Future)

```typescript
// CDP implementation - returns tx hash
const result = await settlePayment({
  paymentSignature: paymentData,
  facilitatorUrl: 'https://api.cdp.coinbase.com/platform/v2/x402',
});
// result.transactionHash available
```

### A2A x402 (Future Agent-to-Agent)

```typescript
// A2A x402 - three-stage flow
const paymentRequired = await agentClient.request(serviceUrl);
// Returns 402 with payment details

const paymentSubmitted = await agentClient.submitPayment(signature);
// Returns 202, settlement pending

const paymentCompleted = await agentClient.awaitSettlement();
// Returns 200 with tx hash
```

---

*Last updated: January 2025*
*Author: APIX Team*
