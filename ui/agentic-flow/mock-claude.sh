#!/bin/bash

# Mock claude script for testing the UI
# This simulates the streaming JSON output of the real claude command

# Parse arguments to check for stream-json flag
if [[ "$*" == *"--output-format stream-json"* ]]; then
    # Simulate streaming JSON output
    echo '{"type":"system","subtype":"init","session_id":"mock_session_123","tools":["Task","Bash","Read","Write"],"model":"claude-3-opus-20240229"}'
    sleep 0.1
    echo '{"type":"assistant","message":{"id":"msg_001","content":[{"type":"text","text":"I will create a concurrent agent swarm to build hello world."}]}}'
    sleep 0.1
    echo '{"type":"assistant","message":{"id":"msg_002","content":[{"type":"tool_use","id":"toolu_001","name":"mcp__claude-flow__swarm_init","input":{"topology":"mesh","maxAgents":5}}]}}'
    sleep 0.1
    echo '{"type":"user","message":{"content":[{"tool_use_id":"toolu_001","type":"tool_result","content":[{"type":"text","text":"{\\"success\\":true,\\"swarmId\\":\\"swarm_mock_123\\",\\"topology\\":\\"mesh\\",\\"maxAgents\\":5,\\"status\\":\\"initialized\\"}"}]}]}}'
    sleep 0.1
    echo '{"type":"assistant","message":{"id":"msg_003","content":[{"type":"tool_use","id":"toolu_002","name":"mcp__claude-flow__agent_spawn","input":{"type":"researcher","name":"Tech Researcher"}}]}}'
    sleep 0.1
    echo '{"type":"user","message":{"content":[{"tool_use_id":"toolu_002","type":"tool_result","content":[{"type":"text","text":"{\\"success\\":true,\\"agentId\\":\\"agent_001\\",\\"name\\":\\"Tech Researcher\\",\\"type\\":\\"researcher\\",\\"status\\":\\"active\\"}"}]}]}}'
    sleep 0.1
    echo '{"type":"assistant","message":{"id":"msg_004","content":[{"type":"tool_use","id":"toolu_003","name":"TodoWrite","input":{"todos":[{"id":"1","content":"Research hello world patterns","status":"pending","priority":"high"},{"id":"2","content":"Create hello directory","status":"pending","priority":"high"},{"id":"3","content":"Implement hello.js","status":"pending","priority":"medium"}]}}]}}'
    sleep 0.1
    echo '{"type":"assistant","message":{"id":"msg_005","content":[{"type":"text","text":"Swarm initialized successfully. Starting implementation..."}]}}'
else
    # Regular output
    echo "Mock Claude CLI v1.0.0"
    echo "Usage: claude [options]"
fi