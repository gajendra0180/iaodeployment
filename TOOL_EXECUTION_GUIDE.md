# Tool Execution & Payment Guide (Phase 3)

## Overview

Phase 3 enables agents to execute tool calls (API invocations) and track payments. The system:

1. **Agent Tool Service** - Converts IAO APIs to LLM tools and executes them
2. **Payment Service** - Tracks and records payments for API calls
3. **Integration** - Links LLM responses to tool execution and payments

## Architecture

```
User Message
    ↓
[Chat Session] → Save user message
    ↓
[LLM Service] → Claude generates response + tool calls
    ↓
[Agent Tool Service] → Execute the tools (call IAO APIs)
    ↓
[Agent Payment Service] → Record payment for each API call
    ↓
[LLM Service] → Pass tool results back to Claude
    ↓
[Response] → Stream complete answer to user
    ↓
[Chat Session] → Save assistant messages + tool calls
```

## Services

### 1. Agent Tool Service (`src/services/agentToolService.ts`)

Handles tool discovery, definition, and execution.

#### Methods

```typescript
// Fetch all available IAO servers and APIs
const servers = await agentToolService.fetchAvailableServers()

// Get tools for a specific agent
const tools = await agentToolService.getToolsForAgent(agent)

// Execute a single tool call
const result = await agentToolService.executeTool(toolCall, agent)

// Execute multiple tools
const results = await agentToolService.executeTools(toolCalls, agent)

// Format results for LLM
const formattedResults = agentToolService.formatToolResults(results)

// Check agent access to a tool
const hasAccess = agentToolService.hasToolAccess(agent, toolName)

// Get API call fee
const fee = await agentToolService.getApiCallFee(serverSlug, apiSlug)
```

### 2. Agent Payment Service (`src/services/agentPaymentService.ts`)

Tracks payments for API calls.

#### Methods

```typescript
// Record a payment
const payment = await agentPaymentService.recordPayment(
  agentId,
  sessionId,
  serverSlug,
  apiSlug,
  fee,
  paymentToken,
  txHash
)

// Get total spending for agent
const spending = await agentPaymentService.getAgentSpending(agentId)

// Get total spending for session
const sessionSpending = await agentPaymentService.getSessionSpending(sessionId)

// Check spending limit
const allowed = await agentPaymentService.checkSpendingLimit(
  agentId,
  upcomingFee,
  dailyLimitWei
)

// Format fee for display
const display = AgentPaymentService.formatFeeForDisplay(feeWei) // "$0.01"

// Calculate total fee
const total = AgentPaymentService.calculateTotalFee(['1000000', '2000000'])
```

## How It Works

### Tool Discovery

When an agent is loaded:

1. **Fetch available servers**: `agentToolService.fetchAvailableServers()`
   - Calls `/api/servers` endpoint
   - Gets all registered IAO servers and their APIs

2. **Filter for agent**: `agentToolService.getToolsForAgent(agent)`
   - Looks at `agent.availableTools` list
   - Creates LLM tool definitions for each accessible API
   - Returns tools in LLM format

### Tool Execution Flow

When LLM requests a tool call:

```typescript
// 1. LLM generates tool call
const toolCall = {
  id: 'toolu_...',
  name: 'call_magpie_pool_snapshot',
  input: { query: 'TVL data' }
}

// 2. Execute the tool
const result = await agentToolService.executeTool(toolCall, agent)
// Returns: { success: true, result: { ... API response ... } }

// 3. Record the payment
const payment = await agentPaymentService.recordPayment(
  agent.id,
  sessionId,
  'magpie',  // serverSlug
  'pool-snapshot',  // apiSlug
  '10000',  // fee in wei
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // USDC
)

// 4. Format results for LLM
const formattedResults = agentToolService.formatToolResults([result])
// Returns: "✅ call_magpie_pool_snapshot:\n{\"tvl\": \"$2.5M\", ...}"

// 5. Pass back to LLM for continued conversation
// Claude uses this to generate final response to user
```

### Payment Tracking

Each tool execution creates a payment record:

```typescript
{
  id: '550e8400-e29b-41d4-a716-446655440000',
  agentId: 'agent-123',
  sessionId: 'session-456',
  serverSlug: 'magpie',
  apiSlug: 'pool-snapshot',
  fee: '10000',  // wei (0.01 USDC with 6 decimals)
  paymentToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  txHash: null,  // Phase 3: null, Phase 4: actual tx hash
  paidBy: 'company',
  timestamp: '2024-01-15T10:30:00.000Z'
}
```

Stored in `apix-iao-agent-payments` DynamoDB table.

## Usage Example

### Step 1: Load Agent

```typescript
const agent = await agentService.getAgent('agent-123')
// agent.availableTools = ['magpie/pool-snapshot', 'eigenpie/tvl-tracker']
```

### Step 2: Get Tools for LLM

```typescript
const tools = await agentToolService.getToolsForAgent(agent)
// tools = [
//   {
//     name: 'call_magpie_pool_snapshot',
//     description: 'Eigenpie Pool Snapshot...',
//     input_schema: { ... }
//   },
//   {
//     name: 'call_eigenpie_tvl_tracker',
//     description: 'TVL Tracker...',
//     input_schema: { ... }
//   }
// ]
```

### Step 3: Chat with LLM

```typescript
const userMessage = "What's the TVL of the Eigenpie pool?"

const messages = [
  { role: 'user', content: userMessage }
]

// LLM will decide to use tools
for await (const chunk of llmService.streamChat('claude', messages, tools)) {
  if (chunk.type === 'tool_call') {
    // LLM decided to call a tool
    const toolCall = chunk.tool

    // Execute tool
    const result = await agentToolService.executeTool(toolCall, agent)

    // Record payment
    await agentPaymentService.recordPayment(
      agent.id,
      sessionId,
      'eigenpie',
      'tvl-tracker',
      '5000',
      paymentTokenAddress
    )
  }
}
```

### Step 4: Agentic Loop

In a real agentic scenario (Phase 4), the LLM would:

1. Receive user message
2. Decide to call tools
3. Get tool results
4. Process results
5. Decide if more tools needed
6. Eventually provide final answer

```
User: "What's the TVL trend for Eigenpie?"
  ↓
Claude: "I'll check current TVL and recent history"
  ↓
Tool Call 1: get_eigenpie_tvl
  ↓
Tool Result 1: { tvl: "$2.5M" }
  ↓
Claude: "Let me check if there are trend indicators"
  ↓
Tool Call 2: get_eigenpie_metrics
  ↓
Tool Result 2: { trend: "up 15% this week" }
  ↓
Claude: Final Response
"Eigenpie currently has $2.5M TVL, up 15% this week..."
```

## Spending Limits

To prevent runaway API calls, set spending limits:

```typescript
const dailyLimitWei = '1000000000000000000' // 1 USDC

const canSpend = await agentPaymentService.checkSpendingLimit(
  agent.id,
  '100000',  // upcoming fee
  dailyLimitWei
)

if (!canSpend.allowed) {
  // Reject the tool call
  console.log(canSpend.reason)
}
```

## Current Phase 3 Limitations

**Phase 3 is payments tracking only:**

- ✅ Records payments in DynamoDB
- ✅ Calculates fees
- ✅ Tracks spending per agent/session
- ❌ Does NOT execute actual x402 transactions
- ❌ Does NOT transfer tokens on-chain
- ❌ Does NOT verify company wallet signature

**Phase 4 will implement actual payment execution:**

- Add x402 payment authorization
- Execute transfers via Thirdweb
- Verify company wallet signature
- Handle failed payments

## Integration Points

### In SSE Chat Endpoint

```typescript
// GET /api/chat/stream/:sessionId
for await (const chunk of llmService.streamChat(provider, messages, tools)) {
  if (chunk.type === 'tool_call') {
    // Step 1: Execute tool
    const result = await agentToolService.executeTool(chunk.tool, agent)

    // Step 2: Record payment
    if (result.success) {
      await agentPaymentService.recordPayment(
        agent.id,
        sessionId,
        serverSlug,
        apiSlug,
        fee,
        paymentToken
      )
    }

    // Step 3: Stream tool result to client
    sendEvent('tool_result', { tool: chunk.tool, result })
  }
}
```

### In Frontend (Phase 5+)

The UI will show:

```
User: "Check pool TVL"
Assistant: "Getting pool data..."
🔧 Calling: call_magpie_pool_snapshot
⏳ Cost: $0.01
✅ Pool TVL: $2.5M, APY: 12%
```

## Testing Tool Execution

### Test 1: Fetch Servers

```bash
curl http://localhost:3000/api/servers | jq
```

### Test 2: Create Agent with APIs

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TestAgent",
    "description": "Test tool execution",
    "creator": "0x123...",
    "llmProvider": "claude",
    "availableTools": ["magpie/pool-snapshot"],
    "starterPrompts": ["Check pool status"]
  }'
```

### Test 3: Execute Tools Manually

```typescript
const agent = await agentService.getAgent('agent-id')
const tools = await agentToolService.getToolsForAgent(agent)

const toolCall = {
  id: 'test-123',
  name: 'call_magpie_pool_snapshot',
  input: {}
}

const result = await agentToolService.executeTool(toolCall, agent)
console.log(result)
// { success: true, result: { ... API response ... } }
```

## Files in Phase 3

**New:**
- `src/services/agentToolService.ts` - Tool discovery & execution
- `src/services/agentPaymentService.ts` - Payment tracking
- `TOOL_EXECUTION_GUIDE.md` - This guide

**Modified:**
- `src/index.ts` - Service initialization
- `package.json` - No new dependencies needed

## Next Phase: SSE Chat Streaming (Phase 4)

Phase 4 will:

1. Integrate tool execution into chat streaming
2. Execute actual x402 payments
3. Handle payment failures
4. Stream tool results back to frontend
5. Continue LLM conversation with tool results

See the main plan for Phase 4 details.
