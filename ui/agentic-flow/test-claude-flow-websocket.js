#!/usr/bin/env node

/**
 * Test script to verify claude-flow WebSocket execution
 */

import { io } from 'socket.io-client';

console.log('🧪 Testing Claude Flow WebSocket connection...');

const socket = io('ws://127.0.0.1:3001', {
  transports: ['websocket'],
  reconnection: false
});

let testTimeout;

socket.on('connect', () => {
  console.log('✅ Connected to WebSocket server');
  console.log('   Socket ID:', socket.id);
  
  // Set up event listeners first (using exact terminal pattern)
  socket.on('claude-flow:output', (data) => {
    console.log('📥 Received output data:', data.data?.substring(0, 100) + (data.data?.length > 100 ? '...' : ''));
  });
  
  socket.on('claude-flow:created', (data) => {
    console.log('✅ Session created:', data.sessionId);
  });
  
  socket.on('claude-flow:complete', (data) => {
    console.log('✅ Command completed:', data);
    cleanup();
  });
  
  socket.on('claude-flow:error', (error) => {
    console.error('❌ Command error:', error);
    cleanup();
  });
  
  // Send test command - use Claude Code format
  console.log('📤 Sending test command...');
  socket.emit('claude-flow:execute', {
    command: 'claude "initialize a swarm and create a hello world project" -p --output-format stream-json --verbose --dangerously-skip-permissions',
    options: {
      cwd: '/workspaces/claude-code-flow',
      shell: true
    }
  });
  
  // Set timeout for test (extended to see more output)
  testTimeout = setTimeout(() => {
    console.log('⏰ Test timeout - ending test');
    cleanup();
  }, 30000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
  cleanup();
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Disconnected:', reason);
  cleanup();
});

function cleanup() {
  if (testTimeout) {
    clearTimeout(testTimeout);
  }
  socket.disconnect();
  process.exit(0);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted');
  cleanup();
});