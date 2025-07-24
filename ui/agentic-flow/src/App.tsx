import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { motion } from 'framer-motion'

// Components (to be implemented)
import Dashboard from './components/dashboard/Dashboard'
import SwarmViewEnhanced from './components/swarm/SwarmViewEnhanced'
import MCPToolsWebSocket from './components/mcp/MCPToolsWebSocket'
import Terminal from './components/shared/Terminal'
import Navigation from './components/shared/Navigation'
import MemoryExplorerV2 from './components/memory/MemoryExplorerV2'
import ClaudeFlow from './components/claude-flow/ClaudeFlow'

// Stores
import { useSwarmStore } from './stores/swarmStore'
import { useMCPStore } from './stores/mcpStore'
import useRealTimeStore from './stores/realTimeStore'
import useRealTimeSync from './hooks/useRealTimeSync'

// Utils
import { cn } from './utils/cn'

function App() {
  const [isInitialized, setIsInitialized] = useState(false)
  
  // Real-time sync state
  const { connected, agents, swarms, performance } = useRealTimeStore()
  const { connecting, error } = useRealTimeSync({ 
    autoConnect: true,
    reconnectInterval: 3000,
    maxReconnectAttempts: 10
  })

  useEffect(() => {
    // Simulate initialization
    setTimeout(() => setIsInitialized(true), 100)
  }, [])

  if (!isInitialized) {
    return null
  }

  return (
    <Router>
      <div className="app-container">
        {/* Retro console frame */}
        <div className="console-frame">
          {/* Terminal header */}
          <div className="terminal-header">
            <div className="terminal-title">
              <span className="terminal-icon">◼</span>
              <span>AGENTIC FLOW v2.0.0 - HIVEMIND CONSOLE</span>
            </div>
            <div className="terminal-controls">
              <button className="terminal-btn minimize">_</button>
              <button className="terminal-btn maximize">□</button>
              <button className="terminal-btn close">×</button>
            </div>
          </div>

          {/* Main content area */}
          <div className="console-content">
            {/* Navigation sidebar */}
            <Navigation />

            {/* Main view area */}
            <main className="main-view">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/swarm" element={<SwarmViewEnhanced />} />
                <Route path="/claude-flow" element={<ClaudeFlow />} />
                <Route path="/mcp-tools" element={<MCPToolsWebSocket />} />
                <Route path="/memory" element={<MemoryExplorerV2 />} />
                <Route path="/terminal" element={<Terminal />} />
              </Routes>
            </main>
          </div>

          {/* Status bar - Real-time data */}
          <div className="status-bar">
            <div className="status-item">
              <span className="status-label">SYNC:</span>
              <span className={`status-value ${connected ? 'status-active' : 'status-error'}`}>
                {connected ? 'LIVE' : connecting ? 'CONNECTING' : 'OFFLINE'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">SWARM:</span>
              <span className={`status-value ${swarms.some(s => s.status === 'active') ? 'status-active' : 'status-idle'}`}>
                {swarms.some(s => s.status === 'active') ? 'ACTIVE' : 'IDLE'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">AGENTS:</span>
              <span className="status-value">
                {agents.filter(a => a.status !== 'offline').length}/{agents.length || '0'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">MEMORY:</span>
              <span className="status-value">{performance.memory.toFixed(1)}MB</span>
            </div>
            <div className="status-item">
              <span className="status-label">CPU:</span>
              <span className="status-value">{performance.cpu.toFixed(1)}%</span>
            </div>
            <div className="status-item status-time">
              {new Date().toLocaleTimeString('en-US', { hour12: false })}
            </div>
          </div>
        </div>

        {/* Toast notifications with retro styling */}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#000',
              color: '#00ff00',
              border: '1px solid #00ff00',
              borderRadius: '0',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '12px',
              boxShadow: '0 0 20px rgba(0, 255, 0, 0.5)',
            },
            success: {
              iconTheme: {
                primary: '#00ff00',
                secondary: '#000',
              },
            },
            error: {
              style: {
                color: '#ff0000',
                border: '1px solid #ff0000',
                boxShadow: '0 0 20px rgba(255, 0, 0, 0.5)',
              },
              iconTheme: {
                primary: '#ff0000',
                secondary: '#000',
              },
            },
          }}
        />
      </div>
    </Router>
  )
}

export default App