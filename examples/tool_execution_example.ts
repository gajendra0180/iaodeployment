/**
 * Example: Tool Execution & Payment
 *
 * Demonstrates:
 * 1. Discovering available APIs
 * 2. Loading tools for an agent
 * 3. Executing tool calls
 * 4. Recording payments
 * 5. Checking spending
 */

import { AgentService } from '../src/services/agentService.js'
import { AgentToolService } from '../src/services/agentToolService.js'
import { AgentPaymentService } from '../src/services/agentPaymentService.js'
import { ChatSessionService } from '../src/services/chatSessionService.js'

// ============================================
// Example 1: Discover Available APIs
// ============================================
async function example1_DiscoverApis() {
  console.log('\n📝 Example 1: Discover Available APIs\n')

  const toolService = new AgentToolService()

  console.log('Fetching available IAO servers...\n')

  const servers = await toolService.fetchAvailableServers()

  console.log(`Found ${servers.length} servers:\n`)

  servers.forEach(server => {
    console.log(`Server: ${server.name} (${server.slug})`)
    console.log(`  Builder: ${server.builder}`)
    console.log(`  APIs:`)
    server.apis.forEach(api => {
      const fee = AgentPaymentService.formatFeeForDisplay(api.fee)
      console.log(`    - ${api.name} (${api.slug}) - Fee: ${fee}`)
    })
    console.log()
  })
}

// ============================================
// Example 2: Load Tools for Agent
// ============================================
async function example2_LoadAgentTools() {
  console.log('\n📝 Example 2: Load Tools for Agent\n')

  const agentService = new AgentService('us-west-1', 'apix-iao-agents')
  const toolService = new AgentToolService()

  // Mock agent (in real scenario, would fetch from DB)
  const mockAgent = {
    id: 'agent-123',
    name: 'Analytics Agent',
    description: 'Analyzes pool data',
    creator: '0x123...',
    llmProvider: 'claude' as const,
    availableTools: ['magpie/pool-snapshot', 'eigenpie/tvl-tracker'],
    starterPrompts: ['Check TVL'],
    isPublic: true,
    totalMessages: '0',
    totalUsers: '0',
    totalToolCalls: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  console.log(`Agent: ${mockAgent.name}`)
  console.log(`Available tools: ${mockAgent.availableTools.join(', ')}\n`)

  console.log('Converting to LLM tools...\n')

  const tools = await toolService.getToolsForAgent(mockAgent)

  tools.forEach(tool => {
    console.log(`Tool: ${tool.name}`)
    console.log(`Description: ${tool.description}`)
    console.log()
  })
}

// ============================================
// Example 3: Execute a Tool Call
// ============================================
async function example3_ExecuteTool() {
  console.log('\n📝 Example 3: Execute a Tool Call\n')

  const toolService = new AgentToolService()

  // Mock agent
  const mockAgent = {
    id: 'agent-123',
    name: 'Analytics Agent',
    creator: '0x123...',
    llmProvider: 'claude' as const,
    availableTools: ['magpie/pool-snapshot'],
    starterPrompts: [],
    isPublic: true,
    description: 'Test',
    totalMessages: '0',
    totalUsers: '0',
    totalToolCalls: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  // Simulate LLM tool call
  const toolCall = {
    id: 'toolu_01234567',
    name: 'call_magpie_pool_snapshot',
    input: { query: 'Get pool TVL and APY' }
  }

  console.log(`Executing tool: ${toolCall.name}`)
  console.log(`Input: ${JSON.stringify(toolCall.input)}\n`)

  const result = await toolService.executeTool(toolCall, mockAgent)

  if (result.success) {
    console.log('✅ Tool execution successful!')
    console.log(`Result preview:`, JSON.stringify(result.result).substring(0, 100) + '...')
  } else {
    console.log(`❌ Tool execution failed: ${result.error}`)
  }

  console.log()
}

// ============================================
// Example 4: Execute Multiple Tools
// ============================================
async function example4_ExecuteMultipleTools() {
  console.log('\n📝 Example 4: Execute Multiple Tools\n')

  const toolService = new AgentToolService()

  const mockAgent = {
    id: 'agent-123',
    name: 'Analytics Agent',
    creator: '0x123...',
    llmProvider: 'claude' as const,
    availableTools: ['magpie/pool-snapshot', 'eigenpie/tvl-tracker'],
    starterPrompts: [],
    isPublic: true,
    description: 'Test',
    totalMessages: '0',
    totalUsers: '0',
    totalToolCalls: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const toolCalls = [
    {
      id: 'toolu_001',
      name: 'call_magpie_pool_snapshot',
      input: {}
    },
    {
      id: 'toolu_002',
      name: 'call_eigenpie_tvl_tracker',
      input: {}
    }
  ]

  console.log(`Executing ${toolCalls.length} tools...\n`)

  const results = await toolService.executeTools(toolCalls, mockAgent)

  console.log('Results:')
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌'
    console.log(`  ${status} ${result.toolName}: ${result.success ? 'Success' : result.error}`)
  })

  const successCount = results.filter(r => r.success).length
  console.log(`\n${successCount}/${results.length} tools executed successfully`)

  // Format for LLM consumption
  const formattedResults = toolService.formatToolResults(results)
  console.log(`\nFormatted for LLM:\n${formattedResults}`)
}

// ============================================
// Example 5: Record Payments
// ============================================
async function example5_RecordPayments() {
  console.log('\n📝 Example 5: Record Payments\n')

  const paymentService = new AgentPaymentService(
    'us-west-1',
    'apix-iao-agent-payments'
  )

  const payments = [
    {
      agentId: 'agent-123',
      sessionId: 'session-456',
      serverSlug: 'magpie',
      apiSlug: 'pool-snapshot',
      fee: '10000',
      paymentToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    },
    {
      agentId: 'agent-123',
      sessionId: 'session-456',
      serverSlug: 'eigenpie',
      apiSlug: 'tvl-tracker',
      fee: '5000',
      paymentToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    }
  ]

  console.log(`Recording ${payments.length} payments...\n`)

  for (const payment of payments) {
    try {
      const recorded = await paymentService.recordPayment(
        payment.agentId,
        payment.sessionId,
        payment.serverSlug,
        payment.apiSlug,
        payment.fee,
        payment.paymentToken
      )

      const displayFee = AgentPaymentService.formatFeeForDisplay(payment.fee)
      console.log(
        `✅ ${payment.serverSlug}/${payment.apiSlug}: ${displayFee}`
      )
    } catch (error) {
      console.log(`❌ Failed to record payment: ${error}`)
    }
  }

  // Calculate total
  const total = AgentPaymentService.calculateTotalFee(
    payments.map(p => p.fee)
  )
  const totalDisplay = AgentPaymentService.formatFeeForDisplay(total)
  console.log(`\nTotal cost: ${totalDisplay}`)
}

// ============================================
// Example 6: Check Spending Limits
// ============================================
async function example6_CheckSpendingLimits() {
  console.log('\n📝 Example 6: Check Spending Limits\n')

  const paymentService = new AgentPaymentService(
    'us-west-1',
    'apix-iao-agent-payments'
  )

  const agentId = 'agent-123'
  const dailyLimitWei = '50000'  // $0.05 daily limit

  console.log(`Agent: ${agentId}`)
  console.log(`Daily limit: ${AgentPaymentService.formatFeeForDisplay(dailyLimitWei)}\n`)

  // Check different spending amounts
  const checks = [
    { fee: '10000', description: '$0.01' },
    { fee: '20000', description: '$0.02' },
    { fee: '25000', description: '$0.025' },
    { fee: '30000', description: '$0.03' }
  ]

  for (const check of checks) {
    const result = await paymentService.checkSpendingLimit(
      agentId,
      check.fee,
      dailyLimitWei
    )

    const status = result.allowed ? '✅ Allowed' : '❌ Blocked'
    console.log(`  ${status}: ${check.description}`)
    if (!result.allowed) {
      console.log(`      Reason: ${result.reason}`)
    }
  }
}

// ============================================
// Example 7: Complete Agent Flow
// ============================================
async function example7_CompleteAgentFlow() {
  console.log('\n📝 Example 7: Complete Agent Flow\n')
  console.log('Simulating: User → Agent → Tools → Payment → Response\n')

  const toolService = new AgentToolService()
  const paymentService = new AgentPaymentService('us-west-1', 'apix-iao-agent-payments')

  // 1. User message
  const userMessage = "What's the TVL of the Eigenpie pool?"
  console.log(`User: ${userMessage}\n`)

  // 2. Agent loads
  const agent = {
    id: 'agent-123',
    name: 'Analytics Agent',
    creator: '0x123...',
    llmProvider: 'claude' as const,
    availableTools: ['eigenpie/tvl-tracker'],
    starterPrompts: [],
    isPublic: true,
    description: 'Analyzes pool data',
    totalMessages: '0',
    totalUsers: '0',
    totalToolCalls: '0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  console.log(`Agent loading: ${agent.name}`)

  // 3. Load tools
  const tools = await toolService.getToolsForAgent(agent)
  console.log(`Tools loaded: ${tools.length}\n`)

  // 4. LLM decides to call tool (simulated)
  console.log('Agent thinking...')
  const toolCall = {
    id: 'toolu_001',
    name: 'call_eigenpie_tvl_tracker',
    input: {}
  }
  console.log(`Claude: "I'll check the TVL for you"\n`)

  // 5. Execute tool
  console.log(`Executing: ${toolCall.name}`)
  const result = await toolService.executeTool(toolCall, agent)

  if (!result.success) {
    console.log(`❌ Tool failed: ${result.error}`)
    return
  }

  console.log(`✅ Got pool data\n`)

  // 6. Record payment
  console.log('Recording payment...')
  try {
    await paymentService.recordPayment(
      agent.id,
      'session-123',
      'eigenpie',
      'tvl-tracker',
      '5000',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    )
    console.log(`✅ Payment recorded: ${AgentPaymentService.formatFeeForDisplay('5000')}\n`)
  } catch (error) {
    console.log('Payment recording would be persisted to DynamoDB')
  }

  // 7. LLM generates final response
  console.log(`Claude: "Based on the data, the Eigenpie pool has..."\n`)

  // 8. Response streamed to user
  console.log('Response sent to user ✅')
}

// ============================================
// Run All Examples
// ============================================
async function runExamples() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║    Tool Execution & Payment Examples - Phase 3                 ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')

  try {
    await example1_DiscoverApis()
    await example2_LoadAgentTools()
    await example3_ExecuteTool()
    await example4_ExecuteMultipleTools()
    await example5_RecordPayments()
    await example6_CheckSpendingLimits()
    await example7_CompleteAgentFlow()

    console.log('\n✅ All examples completed!')
  } catch (error) {
    console.error('❌ Error running examples:', error)
  }
}

// Run if executed directly
runExamples().catch(console.error)
