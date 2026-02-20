# Phase 4: SSE Chat Streaming Implementation Guide

## Overview

Phase 4 integrates all previous phases (backend, LLM, tools, payments) into a real-time chat streaming system. Users can have multi-turn conversations with agents that autonomously call IAO APIs and process results.

## Architecture

```
User sends message
    ↓
[POST /api/chat/message]
    ↓
Message saved to DynamoDB
    ↓
Client starts SSE stream
    ↓
[GET /api/chat/stream/:sessionId]
    ↓
Agentic Loop:
  1. Get session → agent → conversation history
  2. Get tools for agent
  3. Stream LLM response with system prompt
  4. For each LLM output:
     - Token: Stream immediately
     - Tool call: Execute → Record payment → Continue
     - Done: Save & close
    ↓
Response streamed to client in real-time
    ↓
[Client receives SSE events and displays]
```

## SSE Event Types

The streaming endpoint sends different event types as SSE (Server-Sent Events):

### 1. Token Events
```json
{
  "type": "token",
  "data": {
    "content": "Hello"
  }
}
```
Real-time text chunks as the LLM generates responses.

### 2. Tool Call Events
```json
{
  "type": "tool_call",
  "data": {
    "name": "call_magpie_pool_snapshot",
    "description": "Get pool snapshot from Magpie"
  }
}
```
When LLM decides to call a tool.

### 3. Tool Result Events
```json
{
  "type": "tool_result",
  "data": {
    "toolName": "call_magpie_pool_snapshot",
    "success": true,
    "result": {
      "tvl": "$2.5M",
      "apy": "12.5%"
    }
  }
}
```
Results from executed tools.

### 4. Payment Recorded Events
```json
{
  "type": "payment_recorded",
  "data": {
    "serverSlug": "magpie",
    "apiSlug": "pool-snapshot",
    "fee": "10000",
    "displayFee": "$0.01"
  }
}
```
Confirmation that payment was recorded for API call.

### 5. Done Event
```json
{
  "type": "done",
  "data": {
    "success": true
  }
}
```
Indicates streaming is complete.

### 6. Error Events
```json
{
  "type": "error",
  "data": {
    "message": "Error description"
  }
}
```
Errors that occur during streaming.

## The Agentic Loop

### Step 1: Session Setup
```typescript
const session = await chatSessionService.getSession(sessionId)
const agent = await agentService.getAgent(session.agentId)
const messages = await chatSessionService.getRecentMessages(sessionId, 20)
```

### Step 2: Prepare Tools
```typescript
const tools = await agentToolService.getToolsForAgent(agent)
// Converts agent.availableTools like ["magpie/pool-snapshot"]
// Into LLM tool definitions
```

### Step 3: Dynamic System Prompt
```typescript
const systemPrompt = `You are ${agent.name}, an AI agent powered by decentralized APIs.

Your available tools:
- call_magpie_pool_snapshot: Get pool snapshot...
- call_eigenpie_tvl_tracker: Track TVL...

When responding:
1. Provide helpful information
2. Use tools to get real data
3. Be clear about data sources
4. If tools fail, provide best response`
```

### Step 4: Stream with Tool Execution
```typescript
for await (const chunk of llmService.streamChat(
  agent.llmProvider,
  messages,
  tools,
  systemPrompt
)) {
  if (chunk.type === 'token') {
    // Send token immediately
    sendEvent('token', { content: chunk.content })
  } else if (chunk.type === 'tool_call') {
    // 1. Execute tool
    const result = await agentToolService.executeTool(chunk.tool, agent)

    // 2. Record payment
    await agentPaymentService.recordPayment(...)

    // 3. Send events
    sendEvent('tool_result', { success: true, result })
  } else if (chunk.type === 'done') {
    sendEvent('done', { success: true })
  }
}
```

### Step 5: Persist Conversation
```typescript
// Save full assistant message
await chatSessionService.saveMessage(sessionId, 'assistant', assistantMessage)

// Update agent metrics
await agentService.incrementMetric(agent.id, 'totalMessages')
await agentService.incrementMetric(agent.id, 'totalToolCalls')

// Cleanup (keep only last 100 messages)
await chatSessionService.pruneOldMessages(sessionId, 100)
```

## Complete Chat Flow

### Client-Side Flow

```
1. User types message
   ↓
2. POST /api/chat/message
   {
     "sessionId": "session-123",
     "content": "What's the TVL of the Magpie pool?"
   }
   ↓
   Response: { success: true }
   ↓
3. Open EventSource to GET /api/chat/stream/session-123
   ↓
4. Listen for events:
   - "token": Append to response
   - "tool_call": Show "Calling tool_name..."
   - "tool_result": Show data
   - "payment_recorded": Show cost
   - "done": Mark as complete
   - "error": Show error message
```

### Server-Side Flow

```
1. Receive message via POST
   ↓
2. Save to DynamoDB
   ↓
3. Client starts GET /api/chat/stream/:sessionId
   ↓
4. Fetch session, agent, conversation history
   ↓
5. Get tools for agent
   ↓
6. Call llmService.streamChat()
   ↓
7. For each yielded chunk:
   - token: Stream immediately
   - tool_call: Execute → Pay → Send result
   - done: Save conversation → Exit
   ↓
8. Clean up (prune old messages)
```

## Example Conversation

```
User: "What's the current TVL of the Magpie pool?"
  ↓
Agent system prompt loads tools
  ↓
LLM starts streaming:
"I'll check the current TVL of the Magpie pool for you."
  ↓
LLM decides to call tool: call_magpie_pool_snapshot
  ↓
Server executes tool → Gets {tvl: "$2.5M", apy: "12%"}
  ↓
Server records payment: $0.01
  ↓
LLM continues:
"The Magpie pool currently has a TVL of $2.5M with an APY of 12%."
  ↓
Complete response sent to user
  ↓
Entire conversation saved to DynamoDB
```

## API Endpoints (Phase 4)

### 1. Create Chat Session
```
POST /api/chat/sessions
{
  "agentId": "agent-123",
  "userAddress": "0x123..."
}

Response:
{
  "success": true,
  "data": {
    "id": "session-456",
    "agentId": "agent-123",
    "userAddress": "0x123...",
    "createdAt": "2024-01-15T..."
  }
}
```

### 2. Send Message
```
POST /api/chat/message
{
  "sessionId": "session-456",
  "content": "What's the TVL?"
}

Response:
{
  "success": true,
  "data": {
    "role": "user",
    "content": "What's the TVL?",
    "timestamp": "2024-01-15T..."
  }
}
```

### 3. Stream Response (SSE)
```
GET /api/chat/stream/session-456

Returns EventSource stream with events:
- token
- tool_call
- tool_result
- payment_recorded
- done
- error
```

### 4. Get Chat Messages
```
GET /api/chat/sessions/session-456/messages

Response:
{
  "success": true,
  "data": [
    {
      "role": "user",
      "content": "What's the TVL?",
      "timestamp": "..."
    },
    {
      "role": "assistant",
      "content": "The Magpie pool has...",
      "timestamp": "..."
    }
  ]
}
```

## Testing Phase 4

### 1. Start the Server
```bash
yarn dev
```

Should log:
```
✅ Agent service initialized
✅ Chat session service initialized
✅ LLM service initialized
✅ Agent tool service initialized
✅ Agent payment service initialized
```

### 2. Create an Agent
```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pool Analyzer",
    "description": "Analyzes pool data",
    "creator": "0x123...",
    "llmProvider": "claude",
    "availableTools": ["magpie/pool-snapshot"],
    "starterPrompts": ["Check pool status"]
  }'
```

Save the returned `id`.

### 3. Create a Chat Session
```bash
curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-123",
    "userAddress": "0x456..."
  }'
```

Save the returned session `id`.

### 4. Send a Message
```bash
curl -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session-456",
    "content": "What is the current TVL of the Magpie pool?"
  }'
```

### 5. Stream the Response
```bash
curl -N http://localhost:3000/api/chat/stream/session-456
```

Should see SSE events like:
```
data: {"type":"token","data":{"content":"I"}}
data: {"type":"token","data":{"content":"'ll"}}
data: {"type":"tool_call","data":{"name":"call_magpie_pool_snapshot",...}}
data: {"type":"tool_result","data":{"toolName":"call_magpie_pool_snapshot",...}}
data: {"type":"token","data":{"content":" check"}}
...
data: {"type":"done","data":{"success":true}}
```

### 6. Test with Node Script
Create `test_agent_chat.ts`:
```typescript
import { AgentService } from './src/services/agentService.js'
import { ChatSessionService } from './src/services/chatSessionService.js'

async function testAgentChat() {
  const agentService = new AgentService('us-west-1', 'apix-iao-agents')
  const chatSessionService = new ChatSessionService(
    'us-west-1',
    'apix-iao-chat-sessions',
    'apix-iao-chat-messages'
  )

  // Get agent
  const agent = await agentService.getAgent('agent-123')
  console.log('Agent:', agent.name)

  // Create session
  const session = await chatSessionService.createSession('agent-123', '0x123...')
  console.log('Session:', session.id)

  // Save user message
  const userMsg = await chatSessionService.saveMessage(
    session.id,
    'user',
    'What tools do I have?'
  )
  console.log('User message saved:', userMsg)

  // Get messages
  const messages = await chatSessionService.getRecentMessages(session.id, 10)
  console.log('Messages:', messages)
}

testAgentChat().catch(console.error)
```

Run with:
```bash
npx tsx test_agent_chat.ts
```

## Streaming in the Browser

Create an HTML test file:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Agent Chat Test</title>
</head>
<body>
  <div id="chat"></div>
  <input id="message" placeholder="Type message...">
  <button onclick="sendMessage()">Send</button>

  <script>
    let sessionId = null

    async function sendMessage() {
      const message = document.getElementById('message').value
      if (!message) return

      // Send message
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content: message })
      })

      // Clear input
      document.getElementById('message').value = ''

      // Stream response
      const eventSource = new EventSource(`/api/chat/stream/${sessionId}`)

      eventSource.addEventListener('token', (e) => {
        const { content } = JSON.parse(e.data).data
        document.getElementById('chat').innerHTML += content
      })

      eventSource.addEventListener('tool_call', (e) => {
        const { name } = JSON.parse(e.data).data
        document.getElementById('chat').innerHTML += `\n🔧 Calling ${name}...\n`
      })

      eventSource.addEventListener('done', (e) => {
        eventSource.close()
      })

      eventSource.addEventListener('error', (e) => {
        console.error('Stream error:', e)
        eventSource.close()
      })
    }
  </script>
</body>
</html>
```

## Phase 4 Limitations

**Phase 4 does NOT include:**
- ❌ Multi-turn tool calling (LLM can't see tool results and continue)
- ❌ Actual x402 payment execution
- ❌ User wallet signatures required
- ❌ Frontend UI

**What Phase 4 DOES include:**
- ✅ Real-time SSE streaming
- ✅ LLM token streaming
- ✅ Tool execution and results
- ✅ Payment recording
- ✅ Multi-message conversations
- ✅ Agent metrics tracking
- ✅ Conversation history persistence

## Next Phase: Phase 5 (Frontend)

Phase 5 will add:
1. **Agent Composer UI** - Create/edit agents
2. **Chat UI** - Beautiful interface for conversations
3. **Real-time indicators** - Show when tools are running
4. **Cost display** - Show API call costs
5. **Agent marketplace** - Browse public agents

## Integration Points

### In Your Backend
The SSE streaming is fully integrated at:
- **File**: `src/index.ts`
- **Endpoint**: `GET /api/chat/stream/:sessionId`
- **Services used**:
  - ChatSessionService (get session, messages)
  - AgentService (get agent, update metrics)
  - AgentToolService (get tools, execute)
  - LLMService (stream responses)
  - AgentPaymentService (record payments)

### For Frontend Integration
1. Send user message via `POST /api/chat/message`
2. Open `EventSource` to `GET /api/chat/stream/:sessionId`
3. Listen for event types and update UI accordingly
4. Handle errors gracefully
5. Show streaming tokens in real-time

## Troubleshooting

### "Session not found"
- Make sure sessionId is valid
- Session must be created first via `POST /api/chat/sessions`

### "Agent not found"
- Verify agent exists via `GET /api/agents/:agentId`
- Check agent ID in the session

### "Tool execution failed"
- Verify IAO API is running at `/api/servers`
- Check that agent has tool access
- Review AgentToolService logs

### "Payment recording failed"
- Check DynamoDB tables are created
- Verify AWS credentials are set
- Check CloudWatch logs for DynamoDB errors

### LLM streaming timeout
- Increase timeout in LLMService (currently 30s)
- Check Claude API is reachable
- Verify ANTHROPIC_API_KEY is set

## Files Modified in Phase 4

**Modified:**
- `src/index.ts` - Implemented full SSE endpoint with agentic loop

**Documentation:**
- `SSE_CHAT_STREAMING_GUIDE.md` - This file

**No new dependencies added** - Uses existing services and libraries.

## Summary

Phase 4 completes the backend infrastructure for agent chat. Users can now:
1. Create agents with specific tools
2. Have multi-turn conversations
3. Let LLM autonomously call APIs
4. See real-time streaming responses
5. Track API costs

The frontend (Phases 5-6) will build the UI on top of these endpoints.
