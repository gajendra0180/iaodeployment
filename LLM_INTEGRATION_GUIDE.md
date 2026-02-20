# LLM Integration Guide

## Overview

Phase 2 adds unified LLM support to the Agent Chat System. The system now supports:

- **Claude (Anthropic)** ✅ - Full streaming & tool calling support
- **GPT (OpenAI)** ⏳ - Placeholder, full implementation coming
- **Gemini (Google)** ⏳ - Placeholder, full implementation coming

## Architecture

### LLMService Class

The `LLMService` provides a unified interface for all LLM providers:

```typescript
const llm = new LLMService()

// Streaming (token-by-token)
for await (const chunk of llm.streamChat(provider, messages, tools)) {
  if (chunk.type === 'token') { /* ... */ }
  if (chunk.type === 'tool_call') { /* ... */ }
  if (chunk.type === 'done') { /* ... */ }
}

// Non-streaming (simpler)
const response = await llm.chat(provider, messages, tools)
```

### Type Definitions

```typescript
interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ToolDefinition {
  name: string
  description: string
  input_schema: { /* JSON schema */ }
}

interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
}

interface LLMResponse {
  content: string
  toolCalls: ToolCall[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
}
```

## How to Use

### 1. Initialize LLM Service

In `src/index.ts`, the service is already initialized:

```typescript
let llmService: LLMService | null = null
try {
  llmService = new LLMService()
  const providers = llmService.getAvailableProviders()
  console.log(`Available: ${providers.join(', ')}`)
}
```

### 2. Stream Responses to Client

In your chat endpoint, use SSE to stream responses:

```typescript
app.get('/api/chat/stream/:sessionId', async (req, res) => {
  const { sessionId } = req.params

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendEvent = (type: string, data: any) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`)
  }

  try {
    // Get session and conversation history
    const session = await chatSessionService.getSession(sessionId)
    const history = await chatSessionService.getConversationHistory(sessionId)
    const agent = await agentService.getAgent(session.agentId)

    // Get available tools for this agent
    const tools = LLMService.formatApisAsTools(agent.availableTools)

    // Stream LLM response
    for await (const chunk of llmService.streamChat(
      agent.llmProvider,
      history,
      tools
    )) {
      if (chunk.type === 'token') {
        sendEvent('token', { content: chunk.content })
      } else if (chunk.type === 'tool_call') {
        sendEvent('tool_call', { tool: chunk.tool })
        // Save tool call to DB
        await chatSessionService.saveMessage(sessionId, 'tool', `Calling ${chunk.tool.name}`)
      } else if (chunk.type === 'done') {
        sendEvent('done', {})
      }
    }
  } catch (error) {
    sendEvent('error', { message: error.message })
  }

  res.end()
})
```

### 3. Format APIs as Tools

```typescript
import { LLMService } from './src/services/llmService'

const apis = [
  {
    serverSlug: 'magpie',
    apiSlug: 'pool-snapshot',
    name: 'Pool Snapshot',
    description: 'Get pool metrics',
    fee: '10000'
  }
]

const tools = LLMService.formatApisAsTools(apis)
// tools is now ready to pass to the LLM
```

## Testing

### Run Examples

```bash
# Run the comprehensive examples
tsx examples/llm_service_example.ts

# Or use individual examples
yarn dev  # Start server
curl http://localhost:3000/api/chat/stream/{sessionId}  # Test in browser
```

### Manual Test

```bash
# 1. Create an agent
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TestAgent",
    "description": "Test",
    "creator": "0x123...",
    "llmProvider": "claude",
    "availableTools": ["magpie/pool-snapshot"],
    "starterPrompts": ["Test"]
  }'

# 2. Create a chat session
curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d '{"agentId": "...", "userAddress": "0x456..."}'

# 3. Send a message
curl -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "...", "content": "What is the pool TVL?"}'

# 4. Stream the response
curl http://localhost:3000/api/chat/stream/...
```

## Claude Details

### Model: Claude 3.5 Sonnet

- **Speed**: Fast (optimized for agents)
- **Intelligence**: Very high
- **Cost**: $3/$15 per 1M tokens (input/output)
- **Max tokens**: 8192 input context, 2048 output

### Tool Calling

Claude's tool use is exceptional:

```
User: "Check pool TVL"
  ↓
Claude: "I'll check the pool metrics for you"
  ↓
Claude: [Calls: get_pool_data(pool_name="Eigenpie")]
  ↓
Response: "The Eigenpie pool has $2.5M TVL with 12% APY"
```

### Request Format

```typescript
const stream = await client.messages.stream({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 2048,
  system: 'Be helpful...',
  messages: [
    { role: 'user', content: 'What is X?' }
  ],
  tools: [
    {
      name: 'get_data',
      description: 'Fetch data',
      input_schema: { /* ... */ }
    }
  ]
})
```

## Next Steps

### Phase 3: Tool Execution

The LLM will now call tools, and Phase 3 will:
1. Execute the tool calls (call the actual IAO APIs)
2. Handle x402 payments for each API call
3. Return results back to the LLM
4. Continue the conversation

### Phase 4: SSE Chat Streaming

Phase 4 will integrate this with the frontend to show:
- Token-by-token streaming text
- Tool call indicators
- Real-time progress

### Phase 5-6: Frontend UI

The UI will show the chat interface with:
- Message list
- Typing indicator
- Tool execution status
- Agent sidebar

## Environment Setup Checklist

- [ ] Set `ANTHROPIC_API_KEY` in .env
- [ ] Run `yarn install` to add dependencies
- [ ] Run `yarn dev` to start server
- [ ] Check logs for "✅ Claude (Anthropic) API initialized"
- [ ] Run examples to verify: `tsx examples/llm_service_example.ts`

## Troubleshooting

### "Claude client not initialized"

Set `ANTHROPIC_API_KEY` in your .env file.

### "API key invalid"

Visit https://console.anthropic.com/ to verify your API key is active.

### Slow responses

This is normal. Claude 3.5 Sonnet is thorough but slower than cheaper models. For faster responses, you can:
1. Reduce `max_tokens`
2. Use Claude 3 Haiku instead (requires model change)
3. Wait (it's worth it for quality)

### Tool calling not working

Ensure:
1. You passed `tools` parameter to `streamChat`
2. Tools have proper `input_schema`
3. User prompt explicitly mentions using a tool

## Files Created/Modified

### New Files
- `src/services/llmService.ts` - Main LLM service (Claude + stubs for GPT/Gemini)
- `.env.example` - Updated with LLM API keys
- `LLM_SETUP.md` - Setup instructions
- `LLM_INTEGRATION_GUIDE.md` - This file
- `examples/llm_service_example.ts` - Comprehensive examples

### Modified Files
- `src/index.ts` - Added LLM service initialization
- `package.json` - Added @anthropic-ai/sdk dependency

### Status
- ✅ Claude: Fully implemented
- ⏳ GPT: Placeholder (Phase 3+)
- ⏳ Gemini: Placeholder (Phase 3+)
