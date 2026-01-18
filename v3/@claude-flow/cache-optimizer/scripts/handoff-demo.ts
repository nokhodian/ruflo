#!/usr/bin/env npx tsx
/**
 * Handoff Feature Demo
 *
 * Demonstrates the background process model handoff capabilities:
 * 1. Local model requests (Ollama)
 * 2. Remote model requests (Anthropic, OpenAI)
 * 3. Background processing
 * 4. Callback instruction injection
 * 5. Multi-step workflow chains
 */

import {
  HandoffManager,
  handoff,
  BackgroundHandler,
  createHandoffChain,
  handleHandoffRequest,
  handleHandoffHealthCheck,
  createHandoffWorkflow,
  getHandoffMetrics,
} from '../src/index.js';

process.env.CLAUDE_FLOW_HEADLESS = 'true';

function printHeader(title: string): void {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

function printSection(title: string): void {
  console.log(`\n  📦 ${title}`);
  console.log('  ' + '─'.repeat(60));
}

async function demo1_BasicHandoff(): Promise<void> {
  printHeader('DEMO 1: Basic Handoff (Simple API)');

  console.log('\n  Using the simple handoff() function for quick requests:');
  console.log('  (Note: Requires local Ollama or API keys for remote providers)\n');

  // Check provider availability
  const manager = new HandoffManager();
  const health = await manager.healthCheckAll();

  console.log('  Provider Health:');
  for (const [provider, isHealthy] of Object.entries(health)) {
    console.log(`    ${isHealthy ? '✅' : '❌'} ${provider}: ${isHealthy ? 'Available' : 'Unavailable'}`);
  }

  // Find first available provider
  const availableProvider = Object.entries(health).find(([_, h]) => h)?.[0];

  if (!availableProvider) {
    console.log('\n  ⚠️  No providers available. Skipping actual request.');
    console.log('     To test, start Ollama locally or set API keys:');
    console.log('     - ANTHROPIC_API_KEY for Claude');
    console.log('     - OPENAI_API_KEY for GPT');
    return;
  }

  console.log(`\n  Using provider: ${availableProvider}`);

  try {
    console.log('  Sending request...');
    const response = await handoff({
      prompt: 'What is 2 + 2? Answer in one word.',
      provider: availableProvider,
    });

    console.log(`\n  Response:`);
    console.log(`    Status: ${response.status}`);
    console.log(`    Provider: ${response.provider}`);
    console.log(`    Model: ${response.model}`);
    console.log(`    Content: ${response.content.substring(0, 100)}${response.content.length > 100 ? '...' : ''}`);
    console.log(`    Tokens: ${response.tokens.total}`);
    console.log(`    Duration: ${response.durationMs}ms`);
  } catch (error) {
    console.log(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function demo2_CallbackInjection(): Promise<void> {
  printHeader('DEMO 2: Callback Instruction Injection');

  console.log('\n  Demonstrating how callback instructions are injected into responses:');

  const manager = new HandoffManager();

  // Create a request with callback instructions
  const request = manager.createRequest({
    prompt: 'Analyze the code quality of this function',
    systemPrompt: 'You are a code reviewer.',
    callbackInstructions: `
After reviewing the response above, please:
1. Create a new branch: git checkout -b fix/code-quality-issues
2. Apply the suggested fixes using the Edit tool
3. Run the test suite: npm test
4. If tests pass, create a PR`,
  });

  console.log('\n  Request Configuration:');
  console.log(`    Prompt: "${request.prompt}"`);
  console.log(`    System Prompt: "${request.systemPrompt}"`);
  console.log(`    Callback Instructions: (${request.callbackInstructions?.split('\n').length} lines)`);

  // Simulate what the response would look like
  const mockResponse = {
    content: 'The function has several issues:\n1. Missing error handling\n2. No input validation\n3. Hardcoded values should be constants',
  };

  const injected = manager.injectInstructions(
    { ...mockResponse, requestId: request.id, provider: 'mock', model: 'mock', tokens: { prompt: 0, completion: 0, total: 0 }, durationMs: 0, status: 'completed' as const, completedAt: Date.now() },
    request.callbackInstructions!
  );

  console.log('\n  Injected Response:');
  console.log('  ' + '─'.repeat(60));
  console.log(injected.split('\n').map(l => `  ${l}`).join('\n'));
  console.log('  ' + '─'.repeat(60));

  console.log('\n  ✅ The callback instructions are now part of the response,');
  console.log('     ready to be executed by the next step in the workflow.');
}

async function demo3_BackgroundProcessing(): Promise<void> {
  printHeader('DEMO 3: Background Processing');

  console.log('\n  Demonstrating non-blocking background handoff processing:');

  const handler = new BackgroundHandler({
    workDir: '/tmp/claude-flow-handoff-demo',
    maxConcurrent: 3,
    pollInterval: 100,
  });

  // Set up event listeners
  handler.on('started', (id) => {
    console.log(`  📤 Background process started: ${id.substring(0, 8)}...`);
  });

  handler.on('complete', (id, response) => {
    console.log(`  ✅ Background process complete: ${id.substring(0, 8)}...`);
  });

  console.log('\n  Creating mock background request...');
  console.log('  (In real usage, this would spawn a detached Node.js process)');

  const mockRequest = {
    id: 'demo-bg-123',
    provider: 'auto',
    prompt: 'Analyze this codebase and identify optimization opportunities',
    systemPrompt: 'You are a performance engineer.',
    callbackInstructions: 'Apply the optimizations using the Edit tool.',
    metadata: {
      sessionId: 'demo-session',
      source: 'handoff-demo',
      tags: ['performance', 'optimization'],
      createdAt: Date.now(),
    },
    options: {},
  };

  console.log('\n  Background Request:');
  console.log(`    ID: ${mockRequest.id}`);
  console.log(`    Provider: ${mockRequest.provider}`);
  console.log(`    Prompt: "${mockRequest.prompt.substring(0, 50)}..."`);

  console.log('\n  Process Lifecycle:');
  console.log('    1. 📝 Request written to temp file');
  console.log('    2. 🚀 Detached Node.js process spawned');
  console.log('    3. 🔄 Process makes API request independently');
  console.log('    4. 💾 Response written to output file');
  console.log('    5. 📥 Parent process polls and retrieves result');
  console.log('    6. 🧹 Temp files cleaned up');

  // Show the handler's internal state
  console.log('\n  Handler Status:');
  console.log(`    Active Processes: ${handler.getActiveCount()}`);
  console.log(`    Poll Interval: 100ms`);
  console.log(`    Max Concurrent: 3`);

  await handler.shutdown();
}

async function demo4_WorkflowChain(): Promise<void> {
  printHeader('DEMO 4: Multi-Step Workflow Chain');

  console.log('\n  Demonstrating chained handoffs for complex workflows:');

  const workflow = createHandoffWorkflow();

  // Build a 3-step workflow
  workflow
    .step('Analyze the authentication system in this codebase', {
      systemPrompt: 'You are a security analyst.',
    })
    .step('Based on your analysis, suggest security improvements', {
      context: 'previous', // Uses previous response as context
    })
    .step('Create implementation tasks for the suggested improvements', {
      context: 'all', // Uses all previous responses as context
    });

  console.log('\n  Workflow Steps:');
  console.log('    Step 1: Security Analysis');
  console.log('      └─ System: "You are a security analyst"');
  console.log('      └─ Context: None (fresh start)');
  console.log('    Step 2: Improvement Suggestions');
  console.log('      └─ Context: Previous response');
  console.log('    Step 3: Implementation Tasks');
  console.log('      └─ Context: All previous responses');

  console.log('\n  Execution Flow:');
  console.log('    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐');
  console.log('    │   Step 1    │───▶│   Step 2    │───▶│   Step 3    │');
  console.log('    │  (Analysis) │    │ (Improve)   │    │  (Tasks)    │');
  console.log('    └─────────────┘    └─────────────┘    └─────────────┘');
  console.log('          │                  │                  │');
  console.log('          ▼                  ▼                  ▼');
  console.log('       Response 1 ──────▶ Context ───────▶ All Context');

  console.log('\n  ✅ Workflow chain configured. In production, call:');
  console.log('     const result = await workflow.execute();');
}

async function demo5_HookIntegration(): Promise<void> {
  printHeader('DEMO 5: Hook System Integration');

  console.log('\n  Demonstrating handoff integration with Claude Code hooks:');

  console.log('\n  Available Hook Handlers:');
  console.log('    handleHandoffRequest()   - Initiate a model handoff');
  console.log('    handleHandoffPoll()      - Poll for background completion');
  console.log('    handleHandoffCancel()    - Cancel a background handoff');
  console.log('    handleHandoffHealthCheck() - Check all providers');
  console.log('    getHandoffMetrics()      - Get usage statistics');

  console.log('\n  Example Hook Usage:');
  console.log(`
  // In Claude Code hook handler:
  async function onComplexTask(task: string) {
    // Start background handoff to specialized model
    const result = await handleHandoffRequest(task, {
      provider: 'ollama-local',
      systemPrompt: 'You are a specialized code analyzer.',
      callbackInstructions: \`
        After receiving this analysis:
        1. Store findings in memory
        2. Create tasks for each issue found
        3. Notify the user of completion
      \`,
      background: true,
    });

    // Return immediately, process continues in background
    return { handoffId: result.handoffId };
  }

  // Later, poll for completion:
  const completion = await handleHandoffPoll(handoffId, 30000);
  if (completion.handoffResponse) {
    // Process the response with injected instructions
    console.log(completion.handoffResponse.content);
  }
  `);

  // Show current metrics
  const metrics = getHandoffMetrics();
  console.log('\n  Current Metrics:');
  console.log(`    Total Requests: ${metrics.totalRequests}`);
  console.log(`    Successful: ${metrics.successfulRequests}`);
  console.log(`    Failed: ${metrics.failedRequests}`);
  console.log(`    Avg Latency: ${metrics.averageLatency.toFixed(2)}ms`);
  console.log(`    Queue Length: ${metrics.queueLength}`);
}

async function demo6_ProviderConfiguration(): Promise<void> {
  printHeader('DEMO 6: Provider Configuration');

  console.log('\n  Available Providers and Configuration:');

  const providers = [
    {
      name: 'ollama-local',
      type: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'llama3.2',
      priority: 1,
      description: 'Local Ollama instance - fastest, no API costs',
    },
    {
      name: 'anthropic',
      type: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-3-5-haiku-20241022',
      priority: 2,
      description: 'Anthropic API - Claude models, excellent for complex tasks',
    },
    {
      name: 'openai',
      type: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      priority: 3,
      description: 'OpenAI API - GPT models, good for general tasks',
    },
    {
      name: 'openrouter',
      type: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'anthropic/claude-3.5-sonnet',
      priority: 4,
      description: 'OpenRouter - Multi-provider gateway',
    },
  ];

  for (const provider of providers) {
    console.log(`\n  ${provider.name.toUpperCase()}`);
    console.log(`    Type: ${provider.type}`);
    console.log(`    Endpoint: ${provider.endpoint}`);
    console.log(`    Default Model: ${provider.model}`);
    console.log(`    Priority: ${provider.priority}`);
    console.log(`    ${provider.description}`);
  }

  console.log('\n  Custom Provider Example:');
  console.log(`
  const manager = new HandoffManager();
  manager.addProvider({
    name: 'my-custom-model',
    type: 'custom',
    endpoint: 'http://my-server:8080/v1/chat',
    model: 'my-model-v1',
    priority: 0,  // Highest priority
    healthy: true,
    options: {
      customHeader: 'value',
    },
  });
  `);
}

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║         HANDOFF FEATURE DEMO - Background Model Requests          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  console.log('\nThe Handoff feature enables:');
  console.log('  • Requesting other AI models (local Ollama or remote APIs)');
  console.log('  • Background processing for non-blocking operations');
  console.log('  • Callback instruction injection for workflow continuation');
  console.log('  • Multi-step workflow chains with context passing');

  await demo1_BasicHandoff();
  await demo2_CallbackInjection();
  await demo3_BackgroundProcessing();
  await demo4_WorkflowChain();
  await demo5_HookIntegration();
  await demo6_ProviderConfiguration();

  printHeader('SUMMARY');

  console.log('\n  Key Features:');
  console.log('    ✅ Multi-provider support (Ollama, Anthropic, OpenAI, OpenRouter)');
  console.log('    ✅ Automatic provider selection with health checking');
  console.log('    ✅ Background processing via detached Node.js processes');
  console.log('    ✅ Callback instruction injection for workflow continuation');
  console.log('    ✅ Multi-step workflow chains with context passing');
  console.log('    ✅ Full integration with Claude Code hooks');
  console.log('    ✅ Retry logic with exponential backoff');
  console.log('    ✅ Comprehensive metrics and monitoring');

  console.log('\n  Usage:');
  console.log(`
  import { handoff, createHandoffWorkflow, HandoffManager } from '@claude-flow/cache-optimizer';

  // Simple handoff
  const response = await handoff({
    prompt: 'Analyze this code',
    provider: 'auto',
    callbackInstructions: 'Apply fixes using Edit tool',
  });

  // Background handoff
  const response = await handoff({
    prompt: 'Deep analysis',
    background: true,
  });

  // Workflow chain
  const workflow = createHandoffWorkflow()
    .step('Analyze', { systemPrompt: 'Analyst' })
    .step('Improve', { context: 'previous' })
    .step('Test', { context: 'all' });
  const result = await workflow.execute();
  `);

  console.log('═'.repeat(70));
}

main().catch(console.error);
