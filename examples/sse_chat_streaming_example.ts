/**
 * Example: SSE Chat Streaming & Agent Conversation
 *
 * Demonstrates:
 * 1. Creating a chat session
 * 2. Sending messages
 * 3. Streaming responses with SSE
 * 4. Handling tool calls and payments
 * 5. Complete agent conversation flow
 */

import fetch from 'node-fetch'
import { Agent } from '../src/services/agentService.js'

// ============================================
// Example 1: Create Chat Session
// ============================================
async function example1_CreateSession() {
  console.log('\n📝 Example 1: Create Chat Session\n')

  const agentId = 'agent-123' // Should exist from previous phases
  const userAddress = '0x1234567890123456789012345678901234567890'

  try {
    const response = await fetch('http://localhost:3000/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        userAddress
      })
    })

    const result = (await response.json()) as any

    if (result.success) {
      console.log(`✅ Session created: ${result.data.id}`)
      console.log(`   Agent: ${agentId}`)
      console.log(`   User: ${userAddress}\n`)
      return result.data.id
    } else {
      console.log(`❌ Failed to create session: ${result.error}\n`)
      return null
    }
  } catch (error) {
    console.log(`❌ Error: ${error}\n`)
    return null
  }
}

// ============================================
// Example 2: Send a Message
// ============================================
async function example2_SendMessage(sessionId: string) {
  console.log('\n📝 Example 2: Send a Message\n')

  const message = 'What is the current TVL of the Magpie pool?'

  try {
    const response = await fetch('http://localhost:3000/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        content: message
      })
    })

    const result = (await response.json()) as any

    if (result.success) {
      console.log(`✅ Message sent: "${message}"`)
      console.log(`   Session: ${sessionId}\n`)
    } else {
      console.log(`❌ Failed to send message: ${result.error}\n`)
    }
  } catch (error) {
    console.log(`❌ Error: ${error}\n`)
  }
}

// ============================================
// Example 3: Stream Response (Basic)
// ============================================
async function example3_StreamResponse(sessionId: string) {
  console.log('\n📝 Example 3: Stream Response\n')

  try {
    const response = await fetch(`http://localhost:3000/api/chat/stream/${sessionId}`)

    if (!response.ok) {
      console.log(`❌ Stream failed: ${response.status}`)
      return
    }

    const text = await response.text()
    console.log('Raw SSE stream received:')
    console.log(text.substring(0, 200) + '...\n')
  } catch (error) {
    console.log(`❌ Error: ${error}\n`)
  }
}

// ============================================
// Example 4: Parse SSE Events
// ============================================
function parseSSEEvents(sseText: string): Array<{ type: string; data: any }> {
  const events: Array<{ type: string; data: any }> = []

  const lines = sseText.split('\n')
  let currentEvent = ''

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const dataStr = line.substring('data: '.length)
      try {
        const parsed = JSON.parse(dataStr)
        events.push(parsed)
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return events
}

// ============================================
// Example 5: Complete Agent Chat Flow
// ============================================
async function example5_CompleteAgentFlow() {
  console.log('\n📝 Example 5: Complete Agent Chat Flow\n')
  console.log('Simulating: Create Session → Send Message → Stream Response\n')

  const agentId = 'agent-123'
  const userAddress = '0x1234567890123456789012345678901234567890'

  try {
    // Step 1: Create session
    console.log('Step 1: Creating chat session...')
    const sessionRes = await fetch('http://localhost:3000/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, userAddress })
    })

    const sessionData = (await sessionRes.json()) as any
    if (!sessionData.success) {
      console.log(`❌ Failed to create session: ${sessionData.error}`)
      return
    }

    const sessionId = sessionData.data.id
    console.log(`✅ Session created: ${sessionId}\n`)

    // Step 2: Send message
    console.log('Step 2: Sending message...')
    const userMessage = 'What are the top performing APIs in the ecosystem?'

    const msgRes = await fetch('http://localhost:3000/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: userMessage })
    })

    const msgData = (await msgRes.json()) as any
    if (!msgData.success) {
      console.log(`❌ Failed to send message: ${msgData.error}`)
      return
    }

    console.log(`✅ Message sent: "${userMessage}"\n`)

    // Step 3: Stream response
    console.log('Step 3: Streaming response...\n')
    const streamRes = await fetch(`http://localhost:3000/api/chat/stream/${sessionId}`)

    if (!streamRes.ok) {
      console.log(`❌ Stream failed: ${streamRes.status}`)
      return
    }

    const streamText = await streamRes.text()
    const events = parseSSEEvents(streamText)

    // Display events
    let responseText = ''
    console.log('SSE Events received:')

    for (const event of events) {
      if (event.type === 'token') {
        responseText += event.data.content
        process.stdout.write(event.data.content)
      } else if (event.type === 'tool_call') {
        console.log(`\n\n🔧 Calling: ${event.data.name}`)
      } else if (event.type === 'tool_result') {
        if (event.data.success) {
          console.log(`✅ Tool result:`)
          console.log(JSON.stringify(event.data.result, null, 2))
        } else {
          console.log(`❌ Tool failed: ${event.data.error}`)
        }
      } else if (event.type === 'payment_recorded') {
        console.log(`💳 Payment: ${event.data.displayFee} for ${event.data.serverSlug}/${event.data.apiSlug}`)
      } else if (event.type === 'done') {
        console.log('\n\n✅ Stream complete')
      } else if (event.type === 'error') {
        console.log(`\n❌ Error: ${event.data.message}`)
      }
    }

    console.log(`\n\nFinal response:\n${responseText}\n`)

    // Step 4: Get conversation history
    console.log('Step 4: Retrieving conversation history...\n')
    const histRes = await fetch(`http://localhost:3000/api/chat/sessions/${sessionId}/messages`)

    const histData = (await histRes.json()) as any
    if (histData.success) {
      console.log(`Conversation (${histData.data.length} messages):`)
      histData.data.forEach((msg: any) => {
        console.log(`\n${msg.role.toUpperCase()}:`)
        console.log(`  ${msg.content}`)
      })
    }
  } catch (error) {
    console.log(`❌ Error: ${error}`)
  }
}

// ============================================
// Example 6: Multi-Turn Conversation
// ============================================
async function example6_MultiTurnConversation() {
  console.log('\n📝 Example 6: Multi-Turn Conversation\n')

  const agentId = 'agent-123'
  const userAddress = '0x1234567890123456789012345678901234567890'

  try {
    // Create session once
    const sessionRes = await fetch('http://localhost:3000/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, userAddress })
    })

    const sessionData = (await sessionRes.json()) as any
    const sessionId = sessionData.data.id

    console.log(`Session: ${sessionId}\n`)

    // Define multiple messages
    const messages = [
      'What APIs are available in the ecosystem?',
      'Tell me about the Magpie pool',
      'What is the current fee structure?'
    ]

    for (let i = 0; i < messages.length; i++) {
      console.log(`\n--- Turn ${i + 1} ---\n`)

      // Send message
      const userMessage = messages[i]
      console.log(`User: ${userMessage}\n`)

      await fetch('http://localhost:3000/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content: userMessage })
      })

      // Stream response (simplified - just show events)
      const streamRes = await fetch(`http://localhost:3000/api/chat/stream/${sessionId}`)
      const streamText = await streamRes.text()
      const events = parseSSEEvents(streamText)

      let response = ''
      for (const event of events) {
        if (event.type === 'token') {
          response += event.data.content
        }
      }

      console.log(`Agent: ${response}\n`)
    }

    // Get full conversation
    const histRes = await fetch(`http://localhost:3000/api/chat/sessions/${sessionId}/messages`)
    const histData = (await histRes.json()) as any

    console.log(`\n--- Full Conversation (${histData.data.length} messages) ---\n`)
    histData.data.forEach((msg: any, idx: number) => {
      console.log(`${idx + 1}. ${msg.role.toUpperCase()}: ${msg.content.substring(0, 60)}...`)
    })
  } catch (error) {
    console.log(`❌ Error: ${error}`)
  }
}

// ============================================
// Example 7: Tool Execution with Payments
// ============================================
async function example7_ToolExecutionFlow() {
  console.log('\n📝 Example 7: Tool Execution & Payment Tracking\n')

  const agentId = 'agent-123'
  const userAddress = '0x1234567890123456789012345678901234567890'

  try {
    // Create session
    const sessionRes = await fetch('http://localhost:3000/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, userAddress })
    })

    const sessionData = (await sessionRes.json()) as any
    const sessionId = sessionData.data.id

    // Send message that should trigger tool call
    const userMessage = 'Get the snapshot of the Magpie pool'
    await fetch('http://localhost:3000/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: userMessage })
    })

    // Stream and track events
    console.log(`Query: "${userMessage}"\n`)

    const streamRes = await fetch(`http://localhost:3000/api/chat/stream/${sessionId}`)
    const streamText = await streamRes.text()
    const events = parseSSEEvents(streamText)

    let totalCost = '0'
    let toolsExecuted = 0
    const executedTools: string[] = []

    for (const event of events) {
      if (event.type === 'token') {
        process.stdout.write(event.data.content)
      } else if (event.type === 'tool_call') {
        console.log(`\n\n🔧 Executing: ${event.data.name}`)
        toolsExecuted++
      } else if (event.type === 'tool_result') {
        if (event.data.success) {
          executedTools.push(event.data.toolName)
          console.log(`✅ Got result`)
        } else {
          console.log(`❌ Failed: ${event.data.error}`)
        }
      } else if (event.type === 'payment_recorded') {
        console.log(`💳 Cost: ${event.data.displayFee}`)
        totalCost = event.data.fee
      }
    }

    console.log(`\n\n--- Summary ---`)
    console.log(`Tools executed: ${toolsExecuted}`)
    console.log(`Total cost: $${(parseInt(totalCost) / 1000000).toFixed(2)}`)
    console.log(`APIs used: ${executedTools.join(', ')}\n`)
  } catch (error) {
    console.log(`❌ Error: ${error}`)
  }
}

// ============================================
// Run All Examples
// ============================================
async function runExamples() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║    SSE Chat Streaming Examples - Phase 4                       ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')

  try {
    // Example 1: Create session
    const sessionId = await example1_CreateSession()
    if (!sessionId) {
      console.log('⚠️  Cannot continue without session. Create an agent first.')
      return
    }

    // Example 2: Send message
    await example2_SendMessage(sessionId)

    // Example 3: Stream response
    await example3_StreamResponse(sessionId)

    // Other examples
    await example5_CompleteAgentFlow()
    await example6_MultiTurnConversation()
    await example7_ToolExecutionFlow()

    console.log('\n✅ All examples completed!')
  } catch (error) {
    console.error('❌ Error running examples:', error)
  }
}

// Run if executed directly
runExamples().catch(console.error)
