#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('Testing Claude command execution...\n');

// Test 1: Simple echo command
console.log('Test 1: Echo command');
const echoCommand = 'echo \'{"type":"test","message":"Hello World"}\'';
console.log('Command:', echoCommand);

const echoProcess = spawn('sh', ['-c', echoCommand]);

echoProcess.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString());
});

echoProcess.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString());
});

echoProcess.on('exit', (code) => {
  console.log('Exit code:', code);
  console.log('\n---\n');
  
  // Test 2: Check if claude command exists
  console.log('Test 2: Check claude command');
  const whichProcess = spawn('which', ['claude']);
  
  whichProcess.stdout.on('data', (data) => {
    console.log('Claude path:', data.toString().trim());
    
    // Test 3: Try claude version
    console.log('\nTest 3: Claude version');
    const versionProcess = spawn('claude', ['--version']);
    
    versionProcess.stdout.on('data', (data) => {
      console.log('Version output:', data.toString());
    });
    
    versionProcess.stderr.on('data', (data) => {
      console.error('Version error:', data.toString());
    });
    
    versionProcess.on('error', (error) => {
      console.error('Failed to execute claude:', error.message);
    });
  });
  
  whichProcess.stderr.on('data', (data) => {
    console.error('Claude not found in PATH');
    console.log('\nTo fix this issue:');
    console.log('1. Install Claude CLI: https://docs.anthropic.com/claude/docs/claude-cli');
    console.log('2. Or create a mock claude script for testing:');
    console.log('   echo \'#!/bin/bash\' > /usr/local/bin/claude');
    console.log('   echo \'echo "{\\\"type\\\":\\\"mock\\\",\\\"message\\\":\\\"Mock claude output\\\"}";\' >> /usr/local/bin/claude');
    console.log('   chmod +x /usr/local/bin/claude');
  });
});