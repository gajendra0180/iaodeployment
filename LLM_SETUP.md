# LLM Setup Guide for Agent Chat System

This guide explains how to set up LLM providers for the Agent Chat System. The system supports Claude (Anthropic), GPT (OpenAI), and Gemini (Google).

## Quick Start: Claude (Recommended)

Claude is recommended for agents because of its superior tool-calling abilities and clear handling of function definitions.

### Step 1: Get Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Create a new API key
5. Copy the key (starts with `sk-ant-`)

### Step 2: Add to .env

```bash
# Copy the example file
cp .env.example .env

# Edit .env and add your Claude API key
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
```

### Step 3: Install Dependencies

```bash
yarn install
```

### Step 4: Verify Setup

Start the server and check the logs:

```bash
yarn dev
```

You should see:
```
✅ Claude (Anthropic) API initialized
✅ LLM service initialized (Available providers: claude)
```

## Alternative Providers

### GPT (OpenAI)

1. **Get API Key**: https://platform.openai.com/api-keys
2. **Add to .env**:
   ```bash
   OPENAI_API_KEY=sk-...
   ```
3. **Install dependencies** (once implemented):
   ```bash
   yarn add openai
   ```

**Status**: Placeholder implemented, full streaming support coming soon.

### Gemini (Google)

1. **Get API Key**: https://aistudio.google.com/app/apikey
2. **Add to .env**:
   ```bash
   GOOGLE_AI_API_KEY=...
   ```
3. **Install dependencies** (once implemented):
   ```bash
   yarn add @google/generative-ai
   ```

**Status**: Placeholder implemented, full streaming support coming soon.

## Testing the LLM Service

### Basic Chat Test

```bash
# Run this in a Node.js environment
import { LLMService } from './src/services/llmService'

const llm = new LLMService()

const messages = [
  { role: 'user', content: 'What is the capital of France?' }
]

const response = await llm.chat('claude', messages, [])
console.log(response.content)
// Output: The capital of France is Paris...
```

### With Tool Calling

```bash
const tools = [
  {
    name: 'check_pool_tvl',
    description: 'Check total value locked in a liquidity pool',
    input_schema: {
      type: 'object',
      properties: {
        pool_name: { type: 'string', description: 'Pool name' }
      },
      required: ['pool_name']
    }
  }
]

const messages = [
  { role: 'user', content: 'What is the TVL of the Eigen pool?' }
]

const response = await llm.chat('claude', messages, tools)
console.log('Tool calls:', response.toolCalls)
// Output: [{ id: 'toolu_...', name: 'check_pool_tvl', input: { pool_name: 'Eigen' } }]
```

### Streaming Responses

```bash
for await (const chunk of llm.streamChat('claude', messages, [])) {
  if (chunk.type === 'token') {
    process.stdout.write(chunk.content)  // Print tokens as they arrive
  } else if (chunk.type === 'tool_call') {
    console.log('Tool call:', chunk.tool)
  } else if (chunk.type === 'done') {
    console.log('\nDone!')
  }
}
```

## Claude Model Selection

The LLM service uses **Claude 3.5 Sonnet** by default (model: `claude-3-5-sonnet-20241022`).

### Available Claude Models

| Model | Speed | Intelligence | Cost | Best For |
|-------|-------|--------------|------|----------|
| Claude 3.5 Sonnet | Fast | Very High | $$ | Tool calling, agents (default) |
| Claude 3 Opus | Slower | Highest | $$$ | Complex reasoning tasks |
| Claude 3 Haiku | Very Fast | Good | $ | Simple tasks, high volume |

To change the model, edit `src/services/llmService.ts` line 87:

```typescript
const stream = await this.claudeClient.messages.stream({
  model: 'claude-3-opus-20240229',  // Change this line
  // ...
})
```

## API Pricing

### Claude (Anthropic)

**Input**: $3 per 1M tokens
**Output**: $15 per 1M tokens

For an agent making 100 API calls per day with average 1000 tokens in/out:
- Daily: ~$0.18
- Monthly: ~$5.40

### GPT-4 (OpenAI)

**Input**: $30 per 1M tokens
**Output**: $60 per 1M tokens

Much more expensive than Claude for production use.

### Gemini (Google)

**Input**: $0.50 per 1M tokens
**Output**: $1.50 per 1M tokens

Cheapest option, but less proven for tool calling.

## Environment Variables Reference

```bash
# Required for Claude
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# Optional: OpenAI (Phase 3)
OPENAI_API_KEY=sk-...

# Optional: Google Gemini (Phase 3)
GOOGLE_AI_API_KEY=...
```

## Troubleshooting

### "Claude client not initialized"

**Problem**: `ANTHROPIC_API_KEY` not set or invalid

**Solution**:
```bash
# Verify the key is set
echo $ANTHROPIC_API_KEY

# Check .env file
cat .env | grep ANTHROPIC_API_KEY
```

### "API key invalid"

**Problem**: API key is expired, revoked, or incorrect

**Solution**:
1. Go to https://console.anthropic.com/
2. Check that the API key is still active
3. Create a new key if needed
4. Update .env

### Slow responses

**Problem**: Claude taking too long to respond

**Solution**: Claude 3.5 Sonnet is slower than Haiku. Options:
1. Wait (normal for complex queries)
2. Switch to Haiku for faster responses (less intelligent)
3. Reduce max_tokens in llmService.ts

### Rate limiting errors

**Problem**: "Too many requests" from Anthropic

**Solution**: Anthropic has rate limits:
- Default: 50,000 requests/minute
- Contact support for higher limits
- Implement request queuing on your end

## Next Steps

Now that LLM is set up:

1. **Phase 3**: Implement tool execution - Agents will call IAO APIs
2. **Phase 4**: Implement SSE streaming - Real-time responses to frontend
3. **Phase 5-6**: Build frontend chat UI

See the main plan at `/home/error0180/.claude/plans/partitioned-waddling-taco.md`
