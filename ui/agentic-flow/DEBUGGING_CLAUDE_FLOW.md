# Debugging Claude Flow UI

## Overview
This guide helps troubleshoot issues with the Claude Flow UI component when stream output is not appearing.

## Browser Console Debugging

When you navigate to the Claude Flow page and click "Start", you should see the following in the browser console:

### 1. Initial Connection
```
🚀 [ClaudeFlow] Initializing WebSocket connection...
✅ [ClaudeFlow] WebSocket connected successfully
   Socket ID: <socket-id>
   Connected: true
```

### 2. Starting Stream
```
🎬 [ClaudeFlow] Starting stream...
   Socket connected: true
   Is streaming: false
📤 [ClaudeFlow] Emitting claude-flow:execute
   Command: claude "test a concurrent agent swarm..." -p --output-format stream-json --verbose --dangerously-skip-permissions
   Options: { cwd: '/workspaces/claude-code-flow', shell: true }
```

### 3. Receiving Events
```
📨 [ClaudeFlow] Received event: claude-flow:stream
   Args: [{ event: '{"type":"system","subtype":"init"...}' }]
📥 [ClaudeFlow] Received stream data
   Raw data: { event: '{"type":"system"...}' }
   Parsed event: { type: 'system', ... }
```

## Server Console Debugging

In the server terminal, you should see:

### 1. Client Connection
```
👤 ====== NEW CLIENT CONNECTION ======
   Socket ID: <socket-id>
   Transport: websocket
   Remote Address: ::1
   Time: 2025-01-24T16:30:00.000Z
====================================
```

### 2. Receiving Execute Command
```
📨 [Socket <id>] Event: claude-flow:execute
   Args: [{"command":"claude \"test a concurrent...","options":{"cwd":"/workspaces/claude-code-flow","shell":true}}]

🚀 ====== CLAUDE FLOW EXECUTION START ======
📋 Full command: claude "test a concurrent agent swarm..." -p --output-format stream-json --verbose --dangerously-skip-permissions
📁 Working directory: /workspaces/claude-code-flow
🐚 Shell mode: true
🔧 Using shell mode execution
🎯 Executable: /bin/sh
📝 Arguments: ['-c', 'claude "test a concurrent...']
✅ Process spawned with PID: <pid>
```

### 3. Receiving Output
```
📥 [STDOUT] Received 523 bytes
📥 [STDOUT] Raw data preview: {"type":"system","subtype":"init"...
📄 [STDOUT] Processing line: {"type":"system"...
✅ [STDOUT] Valid JSON detected, type: system
```

## Common Issues and Solutions

### Issue 1: WebSocket Not Connecting
**Symptoms:**
- No "WebSocket connected successfully" message
- Connection error messages in console

**Solutions:**
1. Ensure the WebSocket server is running on port 3001
2. Check if another process is using port 3001
3. Verify CORS settings allow WebSocket connections

### Issue 2: Command Not Executing
**Symptoms:**
- "claude-flow:execute" event sent but no response
- No "CLAUDE FLOW EXECUTION START" in server logs

**Solutions:**
1. Check if the `claude` command is available in PATH
2. Try running the command manually in terminal:
   ```bash
   claude "test" -p --output-format stream-json
   ```
3. Ensure the working directory exists and has proper permissions

### Issue 3: No Stream Output
**Symptoms:**
- Process spawns but no stdout data received
- Empty stream events in UI

**Possible Causes:**
1. The `claude` command might not be installed
2. The command might be failing silently
3. Output might be going to stderr instead of stdout

**Debug Steps:**
1. Check server logs for stderr output:
   ```
   🔴 [STDERR] Received error output: <error message>
   ```

2. Check process exit code:
   ```
   🏁 ====== CLAUDE FLOW PROCESS EXIT ======
      Exit code: <code>
   ```

3. Try a simpler command first:
   ```javascript
   // In ClaudeFlow.tsx, change the command to:
   const [command, setCommand] = useState('echo "Hello World"')
   ```

### Issue 4: JSON Parsing Errors
**Symptoms:**
- "Failed to parse stream event" errors
- Raw output being sent instead of JSON

**Solutions:**
1. Verify the claude command supports `--output-format stream-json`
2. Check if the output is actually JSON formatted
3. Look for non-JSON output in the raw data preview

## Testing Steps

1. **Test WebSocket Connection:**
   - Open browser console
   - Navigate to Claude Flow page
   - Verify connection messages

2. **Test Simple Command:**
   - Change command to `echo '{"type":"test","data":"hello"}'`
   - Click Start
   - Should see JSON output in stream

3. **Test Claude Command Manually:**
   ```bash
   # In terminal, run:
   claude "test" -p --output-format stream-json --verbose
   ```
   - If this doesn't work, the issue is with claude installation

4. **Check Process Spawning:**
   - Look for PID in server logs
   - Check if process appears in system process list
   - Monitor CPU/memory usage

## Environment Variables

Ensure these are set if needed:
```bash
# If claude is installed in a custom location
export PATH="/path/to/claude/bin:$PATH"

# If using a specific Node version
export NODE_ENV=development
```

## Additional Debugging

1. **Enable Node.js debugging:**
   ```bash
   NODE_DEBUG=* npm run server
   ```

2. **Check file permissions:**
   ```bash
   ls -la /workspaces/claude-code-flow
   which claude
   claude --version
   ```

3. **Monitor network traffic:**
   - Open browser DevTools Network tab
   - Filter by WS (WebSocket)
   - Check message frames

If none of these solutions work, the issue might be:
- Claude CLI not installed or not in PATH
- Permissions issue with spawning processes
- Firewall or security software blocking the connection
- The specific command syntax not supported by your claude version