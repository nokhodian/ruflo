import React, { useState, useEffect, useCallback } from 'react'
import { Play, Copy, Check, FileJson, Globe, Zap, Shield, ChevronRight, Terminal, Loader, X, Plus, Save, Download } from 'lucide-react'
import ApiEndpointList from './ApiEndpointList'
import ApiTester from './ApiTester'
import WebSocketTester from './WebSocketTester'
import ResponseViewer from './ResponseViewer'

interface ApiTab {
  id: string
  name: string
  type: 'rest' | 'websocket'
  endpoint: string
  method?: string
  saved?: boolean
}

interface SavedRequest {
  id: string
  name: string
  type: 'rest' | 'websocket'
  endpoint: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timestamp: Date
}

const ApiDocs: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview')
  const [apiTabs, setApiTabs] = useState<ApiTab[]>([])
  const [activeApiTabId, setActiveApiTabId] = useState<string | null>(null)
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([])
  const [showSavedRequests, setShowSavedRequests] = useState(false)
  const [tabCounter, setTabCounter] = useState(1)

  // Load saved requests from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('claude-flow-api-requests')
    if (saved) {
      setSavedRequests(JSON.parse(saved))
    }
  }, [])

  // Save requests to localStorage
  const saveRequest = useCallback((request: SavedRequest) => {
    const updated = [...savedRequests, request]
    setSavedRequests(updated)
    localStorage.setItem('claude-flow-api-requests', JSON.stringify(updated))
  }, [savedRequests])

  // Create new API test tab
  const createApiTab = useCallback((endpoint: string, method: string = 'GET', type: 'rest' | 'websocket' = 'rest') => {
    const newTab: ApiTab = {
      id: `tab-${tabCounter}`,
      name: `${method} ${endpoint.split('/').pop() || 'Request'}`,
      type,
      endpoint,
      method
    }
    setApiTabs(prev => [...prev, newTab])
    setActiveApiTabId(newTab.id)
    setTabCounter(prev => prev + 1)
    setActiveTab('testing')
  }, [tabCounter])

  // Close API test tab
  const closeApiTab = useCallback((tabId: string) => {
    setApiTabs(prev => prev.filter(tab => tab.id !== tabId))
    if (activeApiTabId === tabId) {
      setActiveApiTabId(apiTabs.length > 1 ? apiTabs[0].id : null)
    }
  }, [activeApiTabId, apiTabs])

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header */}
      <div className="p-4 border-b-2 border-green-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-green-400 glitch flex items-center gap-3" data-text="API DOCUMENTATION">
              <Globe className="w-6 h-6" />
              API DOCUMENTATION
            </h1>
            <p className="text-green-600 text-sm mt-1">
              Web Services • REST API • WebSocket • Third-Party Integration
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSavedRequests(!showSavedRequests)}
              className="px-3 py-1 text-xs bg-gray-900 text-green-400 border border-green-900 rounded hover:bg-gray-800 transition-colors flex items-center gap-2"
            >
              <Save className="w-3 h-3" />
              Saved ({savedRequests.length})
            </button>
            <a
              href="/api/docs/openapi.json"
              download
              className="px-3 py-1 text-xs bg-blue-900/50 text-blue-400 border border-blue-700 rounded hover:bg-blue-900/70 transition-colors flex items-center gap-2"
            >
              <Download className="w-3 h-3" />
              OpenAPI Spec
            </a>
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex items-center bg-gray-950 border-b border-green-900">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-black text-green-400 border-b-2 border-green-400'
              : 'text-green-600 hover:text-green-400'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('endpoints')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'endpoints'
              ? 'bg-black text-green-400 border-b-2 border-green-400'
              : 'text-green-600 hover:text-green-400'
          }`}
        >
          Endpoints
        </button>
        <button
          onClick={() => setActiveTab('testing')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'testing'
              ? 'bg-black text-green-400 border-b-2 border-green-400'
              : 'text-green-600 hover:text-green-400'
          }`}
        >
          API Testing
        </button>
        <button
          onClick={() => setActiveTab('websocket')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'websocket'
              ? 'bg-black text-green-400 border-b-2 border-green-400'
              : 'text-green-600 hover:text-green-400'
          }`}
        >
          WebSocket
        </button>
        <button
          onClick={() => setActiveTab('authentication')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'authentication'
              ? 'bg-black text-green-400 border-b-2 border-green-400'
              : 'text-green-600 hover:text-green-400'
          }`}
        >
          Authentication
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="p-6 overflow-y-auto h-full">
            <div className="max-w-4xl space-y-6">
              <div className="retro-panel p-6">
                <h2 className="text-lg font-bold text-green-400 mb-4">🚀 Getting Started</h2>
                <div className="space-y-3 text-sm">
                  <p className="text-green-600">
                    The Claude Flow API provides programmatic access to all swarm orchestration, neural processing, and memory management capabilities.
                  </p>
                  <div className="bg-gray-900 p-4 rounded border border-green-900">
                    <div className="text-xs text-gray-500 mb-2">Base URL</div>
                    <code className="text-green-400 font-mono">http://localhost:3001</code>
                  </div>
                  <div className="bg-gray-900 p-4 rounded border border-green-900">
                    <div className="text-xs text-gray-500 mb-2">WebSocket URL</div>
                    <code className="text-green-400 font-mono">ws://localhost:3001</code>
                  </div>
                </div>
              </div>

              <div className="retro-panel p-6">
                <h2 className="text-lg font-bold text-green-400 mb-4">📊 Available Services</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-900 p-4 rounded border border-green-900">
                    <div className="flex items-center gap-2 text-green-400 font-bold mb-2">
                      <Terminal className="w-4 h-4" />
                      REST API
                    </div>
                    <ul className="text-xs text-green-600 space-y-1">
                      <li>• 87+ MCP tool endpoints</li>
                      <li>• Swarm management</li>
                      <li>• Memory operations</li>
                      <li>• Performance metrics</li>
                    </ul>
                  </div>
                  <div className="bg-gray-900 p-4 rounded border border-green-900">
                    <div className="flex items-center gap-2 text-green-400 font-bold mb-2">
                      <Zap className="w-4 h-4" />
                      WebSocket
                    </div>
                    <ul className="text-xs text-green-600 space-y-1">
                      <li>• Real-time streaming</li>
                      <li>• Event subscriptions</li>
                      <li>• Live swarm updates</li>
                      <li>• Bidirectional communication</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="retro-panel p-6">
                <h2 className="text-lg font-bold text-green-400 mb-4">🔑 Quick Examples</h2>
                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-green-600 mb-2">Initialize a Swarm</div>
                    <div className="bg-gray-900 p-3 rounded border border-green-900">
                      <code className="text-xs text-green-400 font-mono">
                        POST /api/hive/init<br/>
                        {"{"}<br/>
                        {"  "}"topology": "mesh",<br/>
                        {"  "}"maxAgents": 5,<br/>
                        {"  "}"name": "production-swarm"<br/>
                        {"}"}
                      </code>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-green-600 mb-2">WebSocket Connection</div>
                    <div className="bg-gray-900 p-3 rounded border border-green-900">
                      <code className="text-xs text-green-400 font-mono">
                        const ws = new WebSocket('ws://localhost:3001');<br/>
                        ws.on('message', (data) =&gt; console.log(data));
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Endpoints Tab */}
        {activeTab === 'endpoints' && (
          <ApiEndpointList onTestEndpoint={createApiTab} />
        )}

        {/* API Testing Tab */}
        {activeTab === 'testing' && (
          <div className="h-full flex flex-col">
            {/* Test Tabs */}
            {apiTabs.length > 0 && (
              <div className="flex items-center bg-gray-950 border-b border-green-900 overflow-x-auto">
                {apiTabs.map(tab => (
                  <div
                    key={tab.id}
                    className={`flex items-center px-3 py-2 border-r border-green-900/50 cursor-pointer transition-colors ${
                      activeApiTabId === tab.id
                        ? 'bg-black text-green-400'
                        : 'bg-gray-900 text-green-600 hover:bg-gray-800'
                    }`}
                    onClick={() => setActiveApiTabId(tab.id)}
                  >
                    <FileJson className="w-3 h-3 mr-2" />
                    <span className="text-xs font-mono truncate max-w-[150px]">{tab.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        closeApiTab(tab.id)
                      }}
                      className="ml-2 text-gray-500 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => createApiTab('/api/health', 'GET')}
                  className="px-3 py-2 bg-gray-900 hover:bg-gray-800 text-green-600 hover:text-green-400 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Test Content */}
            <div className="flex-1 overflow-hidden">
              {activeApiTabId && apiTabs.find(t => t.id === activeApiTabId) ? (
                <ApiTester
                  initialEndpoint={apiTabs.find(t => t.id === activeApiTabId)!.endpoint}
                  initialMethod={apiTabs.find(t => t.id === activeApiTabId)!.method}
                  onSave={saveRequest}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <Terminal className="w-12 h-12 text-green-600 mx-auto mb-4" />
                    <p className="text-green-600 mb-4">No API test open</p>
                    <button
                      onClick={() => createApiTab('/api/health', 'GET')}
                      className="px-4 py-2 bg-green-900/30 text-green-400 border border-green-700 rounded hover:bg-green-900/50 transition-colors"
                    >
                      Create New Test
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* WebSocket Tab */}
        {activeTab === 'websocket' && (
          <WebSocketTester />
        )}

        {/* Authentication Tab */}
        {activeTab === 'authentication' && (
          <div className="p-6 overflow-y-auto h-full">
            <div className="max-w-4xl space-y-6">
              <div className="retro-panel p-6">
                <h2 className="text-lg font-bold text-green-400 mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Authentication
                </h2>
                <div className="space-y-4 text-sm">
                  <div className="bg-gray-900 p-4 rounded border border-green-900">
                    <div className="text-green-400 font-bold mb-2">API Key Authentication</div>
                    <p className="text-green-600 mb-3">Include your API key in the request headers:</p>
                    <code className="text-xs text-green-400 font-mono">
                      X-API-Key: your-api-key-here
                    </code>
                  </div>
                  <div className="bg-gray-900 p-4 rounded border border-green-900">
                    <div className="text-green-400 font-bold mb-2">Bearer Token</div>
                    <p className="text-green-600 mb-3">For OAuth2 authentication:</p>
                    <code className="text-xs text-green-400 font-mono">
                      Authorization: Bearer your-token-here
                    </code>
                  </div>
                  <div className="bg-yellow-900/30 p-4 rounded border border-yellow-700">
                    <div className="text-yellow-400 font-bold mb-2">⚠️ Development Mode</div>
                    <p className="text-yellow-600 text-xs">
                      Authentication is currently disabled in development mode. 
                      Enable it in production by setting REQUIRE_AUTH=true
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Saved Requests Sidebar */}
        {showSavedRequests && (
          <div className="absolute top-0 right-0 w-80 h-full bg-gray-950 border-l-2 border-green-900 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-green-400">Saved Requests</h3>
              <button
                onClick={() => setShowSavedRequests(false)}
                className="text-gray-500 hover:text-green-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {savedRequests.map(request => (
                <button
                  key={request.id}
                  onClick={() => createApiTab(request.endpoint, request.method, request.type)}
                  className="w-full text-left p-3 bg-gray-900 hover:bg-gray-800 border border-green-900 rounded transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-green-400">{request.name}</span>
                    <span className="text-xs text-gray-500">{request.method}</span>
                  </div>
                  <div className="text-xs text-green-600 mt-1 truncate">{request.endpoint}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ApiDocs