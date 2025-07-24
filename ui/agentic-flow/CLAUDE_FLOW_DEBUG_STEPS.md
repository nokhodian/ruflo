# Claude Flow Debugging Steps

## 1. Check Server Status

First, verify the server is running:
```bash
curl http://localhost:3001/health
```

You should see:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "version": "2.0.0",
  "integrations": {
    "hive": true,
    "mastra": true
  }
}
```

## 2. Test WebSocket Connection

Open the test HTML file in a browser:
```bash
# Navigate to the UI directory
cd /workspaces/claude-code-flow/ui/agentic-flow

# Open the test file
# (or open test-claude-flow.html in your browser directly)
```

Click "Test Connection" and check the output.

## 3. Check Claude Installation

Run the test script:
```bash
node test-claude-server.js
```

This will check if:
- Basic command execution works
- Claude CLI is installed
- Claude can output JSON

## 4. Use Mock Claude for Testing

If Claude CLI is not installed, use the mock script:
```bash
# Create a symlink to use the mock
sudo ln -sf /workspaces/claude-code-flow/ui/agentic-flow/mock-claude.sh /usr/local/bin/claude

# Or copy it
sudo cp /workspaces/claude-code-flow/ui/agentic-flow/mock-claude.sh /usr/local/bin/claude
sudo chmod +x /usr/local/bin/claude

# Test it
claude --output-format stream-json
```

## 5. Browser Console Debugging

1. Open Chrome DevTools (F12)
2. Go to the Claude Flow page
3. Click the "🐛 Debug" button
4. Check the console for:
   - Connection status
   - Socket ID
   - Any error messages

## 6. Check Network Tab

1. In Chrome DevTools, go to Network tab
2. Filter by "WS" (WebSocket)
3. Click on the WebSocket connection
4. Check the "Messages" tab for:
   - Outgoing: `claude-flow:execute`
   - Incoming: `claude-flow:stream`, `claude-flow:complete`, or `claude-flow:error`

## 7. Server Console Debugging

Watch the server console for:
```
🚀 ====== CLAUDE FLOW EXECUTION START ======
📋 Full command: claude "test..." -p --output-format stream-json --verbose --dangerously-skip-permissions
🎯 Executable: /bin/sh
✅ Process spawned with PID: 12345
📥 [STDOUT] Received 523 bytes
```

## 8. Common Issues

### Issue: "Command not found"
```
❌ ====== CLAUDE FLOW PROCESS ERROR ======
   Error name: Error
   Error message: spawn claude ENOENT
```
**Solution**: Install Claude CLI or use the mock script

### Issue: No output from command
- Check if the command is correct
- Try a simple echo command first
- Check stderr output in server console

### Issue: WebSocket not connecting
- Ensure server is running on port 3001
- Check for CORS issues
- Try http://localhost:3001 instead of 127.0.0.1:3001

## 9. Quick Test Commands

Try these in the UI:
1. `echo '{"type":"test","data":"hello"}'` - Simple JSON echo
2. `ls -la | head -5` - List files (non-JSON)
3. Use the mock claude with default command

## 10. Enable All Debug Output

In browser console:
```javascript
localStorage.debug = '*'
```

Then refresh the page to see all socket.io debug messages.