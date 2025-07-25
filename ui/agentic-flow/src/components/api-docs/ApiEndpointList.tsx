import React, { useState, useMemo } from 'react'
import { Search, ChevronRight, Play, Copy, Check } from 'lucide-react'

interface Endpoint {
  path: string
  method: string
  category: string
  description: string
  parameters?: Array<{
    name: string
    type: string
    required: boolean
    description: string
  }>
}

interface ApiEndpointListProps {
  onTestEndpoint: (endpoint: string, method: string) => void
}

const endpoints: Endpoint[] = [
  // Health & Status
  { path: '/api/health', method: 'GET', category: 'System', description: 'Health check endpoint' },
  { path: '/api/system/metrics', method: 'GET', category: 'System', description: 'System metrics (CPU, memory)' },
  { path: '/api/mcp/status', method: 'GET', category: 'System', description: 'MCP server status' },
  
  // MCP Tools
  { path: '/api/mcp/tools', method: 'GET', category: 'MCP', description: 'List all available MCP tools' },
  { path: '/api/mcp/execute', method: 'POST', category: 'MCP', description: 'Execute an MCP tool',
    parameters: [
      { name: 'toolName', type: 'string', required: true, description: 'Name of the MCP tool to execute' },
      { name: 'parameters', type: 'object', required: false, description: 'Tool-specific parameters' },
      { name: 'options', type: 'object', required: false, description: 'Execution options' }
    ]
  },
  { path: '/api/mcp/validate', method: 'POST', category: 'MCP', description: 'Validate tool parameters' },
  { path: '/api/mcp/metrics', method: 'POST', category: 'MCP', description: 'Submit tool metrics' },
  
  // Commands
  { path: '/api/commands/templates', method: 'GET', category: 'Commands', description: 'Get command templates' },
  { path: '/api/commands/template/:category/:name', method: 'GET', category: 'Commands', description: 'Get specific template' },
  
  // Hive/Swarm Management
  { path: '/api/hive/init', method: 'POST', category: 'Hive', description: 'Initialize a new swarm' },
  { path: '/api/hive/status', method: 'GET', category: 'Hive', description: 'Get hive/swarm status' },
  { path: '/api/hive/agents', method: 'GET', category: 'Hive', description: 'List all agents' },
  { path: '/api/hive/agents', method: 'POST', category: 'Hive', description: 'Create new agent' },
  { path: '/api/hive/tasks', method: 'GET', category: 'Hive', description: 'List all tasks' },
  { path: '/api/hive/tasks', method: 'POST', category: 'Hive', description: 'Create new task' },
  { path: '/api/hive/tasks/:taskId', method: 'DELETE', category: 'Hive', description: 'Delete a task' },
  { path: '/api/hive/activities', method: 'GET', category: 'Hive', description: 'Get activity log' },
  
  // Memory
  { path: '/api/memory/swarm', method: 'GET', category: 'Memory', description: 'Get swarm memory data' },
  { path: '/api/memory/hivemind', method: 'GET', category: 'Memory', description: 'Get hivemind memory data' },
  { path: '/api/memory/store', method: 'POST', category: 'Memory', description: 'Store memory entry' }
]

const ApiEndpointList: React.FC<ApiEndpointListProps> = ({ onTestEndpoint }) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)

  const categories = useMemo(() => {
    const cats = new Set(endpoints.map(e => e.category))
    return Array.from(cats).sort()
  }, [])

  const filteredEndpoints = useMemo(() => {
    return endpoints.filter(endpoint => {
      const matchesSearch = searchTerm === '' || 
        endpoint.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
        endpoint.description.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesCategory = !selectedCategory || endpoint.category === selectedCategory
      
      return matchesSearch && matchesCategory
    })
  }, [searchTerm, selectedCategory])

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(`http://localhost:3001${path}`)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 2000)
  }

  const methodColors = {
    GET: 'text-green-400 bg-green-900/30 border-green-700',
    POST: 'text-blue-400 bg-blue-900/30 border-blue-700',
    PUT: 'text-yellow-400 bg-yellow-900/30 border-yellow-700',
    DELETE: 'text-red-400 bg-red-900/30 border-red-700',
    PATCH: 'text-purple-400 bg-purple-900/30 border-purple-700'
  }

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-64 bg-gray-950 border-r-2 border-green-900 p-4 overflow-y-auto">
        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-green-600 w-4 h-4" />
            <input
              type="text"
              placeholder="Search endpoints..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-black border border-green-900 text-green-400 placeholder-green-600 focus:border-green-400 focus:outline-none text-sm"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="mb-2">
          <h3 className="text-xs font-bold text-green-600 mb-2">CATEGORIES</h3>
          <button
            onClick={() => setSelectedCategory(null)}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              !selectedCategory 
                ? 'bg-green-900/30 text-green-400 border-l-2 border-green-400' 
                : 'text-green-600 hover:bg-gray-900'
            }`}
          >
            All Endpoints ({endpoints.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                selectedCategory === cat 
                  ? 'bg-green-900/30 text-green-400 border-l-2 border-green-400' 
                  : 'text-green-600 hover:bg-gray-900'
              }`}
            >
              {cat} ({endpoints.filter(e => e.category === cat).length})
            </button>
          ))}
        </div>
      </div>

      {/* Endpoint List */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {filteredEndpoints.map((endpoint, index) => (
            <div
              key={index}
              className="retro-panel p-4 hover:border-green-400 transition-colors cursor-pointer"
              onClick={() => setExpandedEndpoint(expandedEndpoint === endpoint.path ? null : endpoint.path)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 text-xs font-bold border rounded ${methodColors[endpoint.method as keyof typeof methodColors]}`}>
                    {endpoint.method}
                  </span>
                  <code className="text-sm text-green-400 font-mono">{endpoint.path}</code>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      copyPath(endpoint.path)
                    }}
                    className="p-1 text-gray-500 hover:text-green-400 transition-colors"
                    title="Copy URL"
                  >
                    {copiedPath === endpoint.path ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onTestEndpoint(endpoint.path, endpoint.method)
                    }}
                    className="p-1 text-gray-500 hover:text-green-400 transition-colors"
                    title="Test endpoint"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <ChevronRight className={`w-4 h-4 text-gray-500 transition-transform ${expandedEndpoint === endpoint.path ? 'rotate-90' : ''}`} />
                </div>
              </div>
              
              <p className="text-xs text-green-600 mt-2">{endpoint.description}</p>
              
              {expandedEndpoint === endpoint.path && endpoint.parameters && (
                <div className="mt-4 p-3 bg-gray-900 rounded border border-green-900">
                  <h4 className="text-xs font-bold text-green-400 mb-2">Parameters</h4>
                  <div className="space-y-2">
                    {endpoint.parameters.map((param, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs">
                        <code className="text-green-400 font-mono">
                          {param.name}
                          {param.required && <span className="text-red-400">*</span>}
                        </code>
                        <span className="text-gray-500">({param.type})</span>
                        <span className="text-green-600 flex-1">{param.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ApiEndpointList