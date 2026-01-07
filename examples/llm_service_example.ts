/**
 * Example: Using the LLM Service with Agent Chat
 *
 * This example shows how to use the LLMService to:
 * 1. Stream chat responses with token-by-token output
 * 2. Handle tool calls for API execution
 * 3. Format IAO APIs as tools for the agent
 */

import { LLMService, ToolDefinition } from '../src/services/llmService.js'

// ============================================
// Example 1: Simple Chat with Streaming
// ============================================
async function example1_SimpleChat() {
  console.log('\n📝 Example 1: Simple Chat with Streaming\n')

  const llm = new LLMService()

  // Check if Claude is available
  if (!llm.isProviderAvailable('claude')) {
    console.log('❌ Claude not configured. Set ANTHROPIC_API_KEY.')
    return
  }

  const messages = [
    {
      role: 'user' as const,
      content: 'What are the benefits of decentralized APIs?'
    }
  ]

  console.log('User: What are the benefits of decentralized APIs?\n')
  console.log('Claude: ')

  // Stream response token by token
  for await (const chunk of llm.streamChat('claude', messages, [])) {
    if (chunk.type === 'token') {
      process.stdout.write(chunk.content)
    }
  }

  console.log('\n')
}

// ============================================
// Example 2: Multi-turn Conversation
// ============================================
async function example2_MultiTurnChat() {
  console.log('\n📝 Example 2: Multi-turn Conversation\n')

  const llm = new LLMService()

  if (!llm.isProviderAvailable('claude')) {
    console.log('❌ Claude not configured.')
    return
  }

  // Build conversation history
  const messages = [
    {
      role: 'user' as const,
      content: 'What is an x402 API?'
    },
    {
      role: 'assistant' as const,
      content: 'x402 is a payment protocol for APIs that enables users to pay for API calls using EIP-3009 payment authorization on blockchain.'
    },
    {
      role: 'user' as const,
      content: 'How is it better than traditional APIs?'
    }
  ]

  console.log('Streaming response to second turn...\n')

  for await (const chunk of llm.streamChat('claude', messages, [])) {
    if (chunk.type === 'token') {
      process.stdout.write(chunk.content)
    }
  }

  console.log('\n')
}

// ============================================
// Example 3: Tool Calling (Function Calling)
// ============================================
async function example3_ToolCalling() {
  console.log('\n📝 Example 3: Tool Calling\n')

  const llm = new LLMService()

  if (!llm.isProviderAvailable('claude')) {
    console.log('❌ Claude not configured.')
    return
  }

  // Define tools (APIs) that the agent can use
  const tools: ToolDefinition[] = [
    {
      name: 'get_pool_data',
      description: 'Retrieves total value locked (TVL) and APY for a liquidity pool',
      input_schema: {
        type: 'object',
        properties: {
          pool_name: {
            type: 'string',
            description: 'Name of the liquidity pool (e.g., "Eigen", "Curve")'
          },
          chain: {
            type: 'string',
            description: 'Blockchain name (e.g., "Base", "Ethereum")'
          }
        },
        required: ['pool_name']
      }
    },
    {
      name: 'get_token_price',
      description: 'Gets the current price of a token',
      input_schema: {
        type: 'object',
        properties: {
          token_symbol: {
            type: 'string',
            description: 'Token symbol (e.g., "ETH", "USDC")'
          }
        },
        required: ['token_symbol']
      }
    }
  ]

  const messages = [
    {
      role: 'user' as const,
      content: 'What is the TVL of the Eigen pool on Base, and what is the current price of ETH?'
    }
  ]

  console.log('User: What is the TVL of the Eigen pool on Base, and what is the current price of ETH?\n')
  console.log('Claude (with tools):')
  console.log('  Thinking...\n')

  // Stream response and collect tool calls
  const toolCalls = []

  for await (const chunk of llm.streamChat('claude', messages, tools)) {
    if (chunk.type === 'token') {
      process.stdout.write(chunk.content)
    } else if (chunk.type === 'tool_call') {
      console.log(`\n\n  🔧 Calling tool: ${chunk.tool.name}`)
      console.log(`     Input: ${JSON.stringify(chunk.tool.input)}`)
      toolCalls.push(chunk.tool)
    }
  }

  console.log('\n')

  if (toolCalls.length > 0) {
    console.log(`\n✅ Claude made ${toolCalls.length} tool call(s)`)
    console.log('   The agent would now execute these API calls and report results back.')
  }
}

// ============================================
// Example 4: Format IAO APIs as Tools
// ============================================
async function example4_FormatApisAsTools() {
  console.log('\n📝 Example 4: Converting IAO APIs to LLM Tools\n')

  // Sample IAO APIs from the marketplace
  const iaoApis = [
    {
      serverSlug: 'magpie',
      apiSlug: 'pool-snapshot',
      name: 'Eigenpie Pool Snapshot',
      description: 'Get real-time snapshot of Eigenpie pool metrics including TVL, APY, and user count',
      fee: '10000'  // In wei / 6 decimals for USDC
    },
    {
      serverSlug: 'eigenpie',
      apiSlug: 'tvl-tracker',
      name: 'TVL Tracker',
      description: 'Track total value locked across all Eigen validators',
      fee: '5000'
    },
    {
      serverSlug: 'dex-aggregator',
      apiSlug: 'swap-quote',
      name: 'Swap Quote',
      description: 'Get the best swap quote across multiple DEX protocols',
      fee: '15000'
    }
  ]

  // Convert to LLM tools
  const tools = LLMService.formatApisAsTools(iaoApis)

  console.log('Converted IAO APIs to LLM Tools:\n')

  tools.forEach(tool => {
    console.log(`Tool: ${tool.name}`)
    console.log(`  Description: ${tool.description}`)
    console.log(`  Input Schema:`, JSON.stringify(tool.input_schema, null, 2))
    console.log()
  })

  // Now the agent can call these tools
  console.log(`✅ Ready to use ${tools.length} APIs as agent tools!`)
}

// ============================================
// Example 5: Non-streaming Chat (Simpler)
// ============================================
async function example5_NonStreamingChat() {
  console.log('\n📝 Example 5: Non-streaming Chat (Simpler)\n')

  const llm = new LLMService()

  if (!llm.isProviderAvailable('claude')) {
    console.log('❌ Claude not configured.')
    return
  }

  const messages = [
    {
      role: 'user' as const,
      content: 'Explain blockchain in 2 sentences'
    }
  ]

  console.log('User: Explain blockchain in 2 sentences\n')
  console.log('Claude: ')

  // Get full response at once (no streaming)
  const response = await llm.chat('claude', messages, [])
  console.log(response.content)
  console.log()
}

// ============================================
// Example 6: Agent Chat Flow (Complete)
// ============================================
async function example6_AgentChatFlow() {
  console.log('\n📝 Example 6: Complete Agent Chat Flow\n')

  const llm = new LLMService()

  if (!llm.isProviderAvailable('claude')) {
    console.log('❌ Claude not configured.')
    return
  }

  // System prompt for the agent
  const systemPrompt = 'You are a helpful AI agent that helps users explore decentralized APIs and blockchain data. You have access to various data APIs and should use them to answer user questions accurately.'

  // Available APIs the agent can call
  const availableApis = [
    {
      serverSlug: 'magpie',
      apiSlug: 'pool-snapshot',
      name: 'Pool Snapshot',
      description: 'Get pool metrics'
    }
  ]

  const tools = LLMService.formatApisAsTools(availableApis)

  // User message
  const userMessage = 'What is the current TVL of the Eigenpie pool?'

  const messages = [
    { role: 'user' as const, content: userMessage }
  ]

  console.log('=== Agent Chat Flow ===\n')
  console.log(`User: ${userMessage}\n`)
  console.log('Agent thinking...\n')

  // Stream the response
  let assistantResponse = ''
  const toolsToCall = []

  for await (const chunk of llm.streamChat('claude', messages, tools, systemPrompt)) {
    if (chunk.type === 'token') {
      assistantResponse += chunk.content
      process.stdout.write(chunk.content)
    } else if (chunk.type === 'tool_call') {
      toolsToCall.push(chunk.tool)
      console.log(`\n\n🔧 Calling: ${chunk.tool.name}`)
    }
  }

  console.log('\n\n--- Agent Response Breakdown ---')
  console.log(`Response: ${assistantResponse.substring(0, 100)}...`)
  console.log(`Tool calls: ${toolsToCall.length}`)
  toolsToCall.forEach(tc => {
    console.log(`  - ${tc.name}: ${JSON.stringify(tc.input)}`)
  })
}

// ============================================
// Run Examples
// ============================================
async function runExamples() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║         LLM Service Examples - Agent Chat System              ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')

  try {
    // Run examples in sequence
    await example1_SimpleChat()
    await example2_MultiTurnChat()
    await example3_ToolCalling()
    await example4_FormatApisAsTools()
    await example5_NonStreamingChat()
    await example6_AgentChatFlow()

    console.log('\n✅ All examples completed!')
  } catch (error) {
    console.error('❌ Error running examples:', error)
  }
}

// Run if executed directly
runExamples().catch(console.error)
