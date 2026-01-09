# Agent Tool-Gating Architecture & Constraints

## Overview

Agents in the APIX system are strictly **tool-gated** - they can ONLY respond based on the execution results of their configured API tools. This prevents agents from being misused as free LLM services and ensures all responses come exclusively from the decentralized API marketplace.

**Key Principle:** Agents are NOT general-purpose LLMs. Users cannot use agents to access the LLM's training knowledge. They can only access information from tools (APIs) configured on their server.

---

## Architecture

### Three-Layer Enforcement

The tool-gating constraint is enforced at three levels:

```
1. VALIDATION LAYER (before chat streaming)
   └─ Agents must have at least 1 tool configured

2. SYSTEM PROMPT LAYER (during LLM inference)
   └─ Explicit instructions to ONLY use tools, no knowledge

3. EXECUTION LAYER (during tool calls)
   └─ Verify agent has access to each tool before execution
```

---

## Implementation Details

### Layer 1: Tool Availability Validation

**File:** `/home/error0180/iaodeployment/src/index.ts` (lines 2622-2634)

```typescript
// Validate agent has at least one tool available
if (tools.length === 0) {
  sendEvent('error', {
    message: 'This agent has no tools configured. Please contact the agent creator to add API access.'
  })
  res.end()
  return
}
```

**What happens:**
- When a user starts a chat session, the backend loads all tools configured for that agent
- If `tools.length === 0`, the session immediately ends with an error
- Agent cannot operate without at least one configured tool

**Error Message to User:**
```
"This agent has no tools configured. Please contact the agent creator to add API access."
```

---

### Layer 2: System Prompt Enforcement

**File:** `/home/error0180/iaodeployment/src/index.ts` (lines 2636-2654)

The system prompt explicitly constrains the LLM:

```
CRITICAL CONSTRAINTS (you must follow these exactly):
1. You MUST call tools to retrieve information - do not use your training knowledge
2. You can ONLY provide information that comes directly from tool execution results
3. Do NOT provide responses based on your internal knowledge or reasoning
4. If a tool fails, respond with: "I was unable to retrieve data from [tool_name]. Please try again."
5. If no tools are available, respond with: "I have no tools configured to help with this request."
6. Always cite which tool provided the data you're reporting
7. Do NOT provide general knowledge, advice, or analysis beyond what the tools return

Remember: You are strictly tool-gated. Users cannot use you as a general LLM. You only have access to [N] specific API endpoint(s).
```

**Why this works:**
- Modern LLMs (like Claude) follow explicit system prompt constraints
- The "Remember" statement reinforces the tool-gating boundary
- Explicit refusal instructions prevent knowledge-based responses

**What the prompt prevents:**
- ❌ "You can ask me anything" responses
- ❌ General knowledge answers without tool execution
- ❌ Fallback responses when tools fail
- ❌ Analysis beyond what tools return
- ✅ Only tool-based responses with citations

---

### Layer 3: Tool Access Validation

**File:** `/home/error0180/iaodeployment/src/index.ts` (lines 2682-2691)

Before executing ANY tool call, the backend validates authorization:

```typescript
// Validate agent has access to this tool (tool-gating constraint)
const hasAccess = agentToolService.hasToolAccess(agent, toolCall.name)
if (!hasAccess) {
  console.warn(`⚠️  UNAUTHORIZED TOOL ACCESS: Agent ${agent.id} attempted to call ${toolCall.name}`)
  sendEvent('tool_error', {
    toolName: toolCall.name,
    error: `Access denied. This agent is not authorized to use the ${toolCall.name} tool.`
  })
  continue // Skip execution
}
```

**Implementation Details:**
- Uses `agentToolService.hasToolAccess()` (line 265 in agentToolService.ts)
- Checks if tool name is in agent's `availableTools` list
- Returns tool_error event if access is denied
- Prevents lateral movement (agent using other agents' tools)

**Security Guarantee:**
- Even if an LLM tries to call a tool it wasn't configured for, execution fails
- Logs unauthorized access attempts for audit trail
- Agent cannot access tools from different servers

---

## Tool Access Lookup

**File:** `/home/error0180/iaodeployment/src/services/agentToolService.ts` (lines 265-272)

```typescript
hasToolAccess(agent: Agent, toolName: string): boolean {
  // Tool name format: call_serverSlug_apiSlug
  const availableTools = agent.availableTools.map(t =>
    `call_${t.replace('/', '_')}`.toLowerCase()
  )
  return availableTools.includes(toolName.toLowerCase())
}
```

**How it works:**
1. Agent stores tools as `["server/api", "server/api2", ...]`
2. LLM returns tool calls as `["call_server_api", "call_server_api2", ...]`
3. Validation converts agent's tools to match LLM format
4. Checks if tool name exists in agent's available tools list

---

## Flow Diagram

```
User sends message to agent
  ↓
[VALIDATION LAYER] Check if agent has tools
  ├─ If 0 tools: Return error, end session
  └─ If tools exist: Continue
  ↓
[SYSTEM PROMPT LAYER] Load LLM with constrained prompt
  ├─ Prompt states: "ONLY use tools, no knowledge"
  ├─ Lists available tools explicitly
  └─ Reminds LLM it's tool-gated
  ↓
LLM streams response with potential tool calls
  ↓
For each tool_call event:
  [EXECUTION LAYER] Validate tool access
    ├─ If NOT authorized: Send tool_error, skip execution
    └─ If authorized: Execute tool, return result
  ↓
LLM continues with tool results
  ↓
Save message and metrics
```

---

## What This Prevents

### Scenario 1: Agent as Free LLM
**Before:** Agent could answer "What's the capital of France?" with LLM knowledge
**After:** Agent responds with system prompt instruction: "I can only provide information from my configured APIs"

### Scenario 2: Unauthorized Tool Access
**Before:** Agent could potentially call any API in the system
**After:** Tool access validation prevents this - agent can ONLY call tools in `availableTools`

### Scenario 3: Agent Without Tools
**Before:** Agent would sit idle or provide generic responses
**After:** Session ends with error - agent cannot operate without tools

### Scenario 4: Tool Fallback Responses
**Before:** Old system prompt said "If tools fail, provide your best response"
**After:** New prompt says "If tools fail, tell user the tool failed"

---

## Configuration

### Creating an Agent with Tools

**Frontend (AgentComposerPage.tsx):**
```typescript
// User selects tools in UI
selectedTools = ["magpie/tvl", "magpie/liquidity"]

// Create agent with tools
await createAgent({
  name: "TVL Analyzer",
  availableTools: selectedTools,  // [server/api, server/api]
  ...
})
```

**Backend Storage (Agent document):**
```typescript
{
  id: "agent-123",
  name: "TVL Analyzer",
  availableTools: ["magpie/tvl", "magpie/liquidity"],
  ...
}
```

### Tool Name Format Conversion

```
Frontend/Database: "magpie/tvl"
  ↓ (converted in agentToolService.getToolsForAgent)
  ↓
Tool Definition: "call_magpie_tvl"
  ↓ (used in LLM tool calling)
  ↓
Validation: hasToolAccess checks "call_magpie_tvl" against agent.availableTools
```

---

## Testing

### Test Case 1: Agent with No Tools
```bash
# Create agent with availableTools = []
# Start chat
# Expected: Session ends with error message
```

### Test Case 2: Unauthorized Tool Call
```bash
# Agent configured with tool: "magpie/tvl"
# LLM somehow tries to call: "call_uniswap_swap"
# Expected: tool_error event, execution skipped
```

### Test Case 3: Valid Tool Call
```bash
# Agent configured with tool: "magpie/tvl"
# LLM calls: "call_magpie_tvl" with valid inputs
# Expected: Tool executes successfully
```

### Test Case 4: General Knowledge Question
```bash
# User: "What's the capital of France?"
# Agent: LLM follows system prompt, calls its tools
# Expected: Either tool-based response or "I have no tools for this"
```

---

## Server Context Restriction

Each agent is tied to a specific server and can only call APIs from that server:

```
Server: Magpie
  └─ Agent: TVL Analyzer
      └─ Available Tools:
          ├─ magpie/tvl           ✅
          ├─ magpie/liquidity     ✅
          └─ uniswap/swap         ❌ Different server
```

**Enforcement:**
- Tools are loaded from `server.apis[]` (line 74 in agentToolService.ts)
- Agent's `availableTools` must reference that server
- Tool name validation includes server slug
- Different servers = different agent instances = different tool access

---

## Logging & Monitoring

### Success Logging
```
✅ Agent agentId123 (TVL Analyzer) loaded with 2 tool(s)
🔒 Tool-gating enabled: Agent can ONLY call these tools: call_magpie_tvl, call_magpie_liquidity
✅ Tool executed successfully: call_magpie_tvl
```

### Authorization Failure Logging
```
⚠️  UNAUTHORIZED TOOL ACCESS: Agent agentId123 attempted to call call_uniswap_swap
❌ Agent agentId456 has no tools configured - cannot operate
```

---

## FAQ

### Q: Can an agent call APIs from different servers?
**A:** No. Each agent is configured with tools from a single server. Tools from different servers would require separate agents.

### Q: What if the LLM insists on using its knowledge?
**A:** The system prompt explicitly instructs against this, and modern LLMs follow such constraints. If the LLM violates this, it would indicate a problem with that LLM provider's compliance.

### Q: Can users bypass tool-gating?
**A:** No. All three layers (validation, prompt, execution) work together:
- Session-level: Validation layer prevents agent startup
- Request-level: Prompt layer guides LLM behavior
- Execution-level: Validation layer blocks unauthorized calls

### Q: What about analytics or metrics?
**A:** All tool calls are tracked:
- `tool_call` events show attempted calls
- `tool_result` events show success/failure
- `tool_error` events show authorization failures
- All logged for audit and debugging

### Q: How does this differ from other AI agents?
**A:** Most AI agents can use their training knowledge OR external tools. APIX agents are ONLY tool-gated - no knowledge, only tools. This ensures monetization through the API marketplace.

---

## Related Files

- **Backend Chat Handler:** `/home/error0180/iaodeployment/src/index.ts` (lines 2567-2750)
- **Tool Service:** `/home/error0180/iaodeployment/src/services/agentToolService.ts`
- **LLM Service:** `/home/error0180/iaodeployment/src/services/llmService.ts`
- **Agent Service:** `/home/error0180/iaodeployment/src/services/agentService.ts`
- **Frontend Chat Page:** `/home/error0180/ui-vercel-2/src/pages/ChatPage.tsx`
- **Frontend Agent Composer:** `/home/error0180/ui-vercel-2/src/pages/AgentComposerPage.tsx`

---

## Summary

The three-layer tool-gating architecture ensures:

1. ✅ **Agents cannot operate without tools** - Validation layer
2. ✅ **Agents must use tools, not knowledge** - System prompt layer
3. ✅ **Agents can only access their configured tools** - Execution layer

This prevents agents from being misused as free LLM services and guarantees that all API calls are properly monetized through the APIX marketplace.
