import React, { useState, useCallback } from 'react'
import { Play, Loader, Save, Copy, Check, Plus, Trash2 } from 'lucide-react'
import ResponseViewer from './ResponseViewer'

interface ApiTesterProps {
  initialEndpoint?: string
  initialMethod?: string
  onSave?: (request: any) => void
}

interface Header {
  key: string
  value: string
}

const ApiTester: React.FC<ApiTesterProps> = ({ 
  initialEndpoint = '/api/health', 
  initialMethod = 'GET',
  onSave 
}) => {
  const [endpoint, setEndpoint] = useState(initialEndpoint)
  const [method, setMethod] = useState(initialMethod)
  const [headers, setHeaders] = useState<Header[]>([
    { key: 'Content-Type', value: 'application/json' }
  ])
  const [body, setBody] = useState('')
  const [response, setResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }])
  }

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...headers]
    updated[index][field] = value
    setHeaders(updated)
  }

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index))
  }

  const executeRequest = async () => {
    setLoading(true)
    setError(null)
    setResponse(null)
    
    const startTime = Date.now()
    
    try {
      const url = `http://localhost:3001${endpoint}`
      const requestHeaders: Record<string, string> = {}
      
      headers.forEach(header => {
        if (header.key && header.value) {
          requestHeaders[header.key] = header.value
        }
      })

      const options: RequestInit = {
        method,
        headers: requestHeaders
      }

      if (method !== 'GET' && method !== 'HEAD' && body) {
        options.body = body
      }

      const res = await fetch(url, options)
      const responseTime = Date.now() - startTime
      setExecutionTime(responseTime)

      const contentType = res.headers.get('content-type')
      let data
      
      if (contentType && contentType.includes('application/json')) {
        data = await res.json()
      } else {
        data = await res.text()
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        data
      })

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
      setExecutionTime(Date.now() - startTime)
    } finally {
      setLoading(false)
    }
  }

  const saveRequest = () => {
    if (onSave) {
      const request = {
        id: `req-${Date.now()}`,
        name: `${method} ${endpoint.split('/').pop()}`,
        type: 'rest' as const,
        endpoint,
        method,
        headers: headers.reduce((acc, h) => {
          if (h.key && h.value) acc[h.key] = h.value
          return acc
        }, {} as Record<string, string>),
        body,
        timestamp: new Date()
      }
      onSave(request)
    }
  }

  const copyCurl = () => {
    const curlHeaders = headers
      .filter(h => h.key && h.value)
      .map(h => `-H "${h.key}: ${h.value}"`)
      .join(' ')
    
    let curl = `curl -X ${method} "http://localhost:3001${endpoint}" ${curlHeaders}`
    
    if (body && method !== 'GET') {
      curl += ` -d '${body}'`
    }
    
    navigator.clipboard.writeText(curl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="h-full flex">
      {/* Request Builder */}
      <div className="w-1/2 border-r-2 border-green-900 p-4 overflow-y-auto">
        <div className="space-y-4">
          {/* Method & Endpoint */}
          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="px-3 py-2 bg-black border border-green-900 text-green-400 focus:border-green-400 focus:outline-none"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="flex-1 px-3 py-2 bg-black border border-green-900 text-green-400 placeholder-green-600 focus:border-green-400 focus:outline-none font-mono text-sm"
              placeholder="/api/v1/..."
            />
          </div>

          {/* Headers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-green-400">Headers</h3>
              <button
                onClick={addHeader}
                className="text-xs text-green-600 hover:text-green-400 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add Header
              </button>
            </div>
            <div className="space-y-2">
              {headers.map((header, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={header.key}
                    onChange={(e) => updateHeader(index, 'key', e.target.value)}
                    placeholder="Key"
                    className="flex-1 px-2 py-1 bg-gray-900 border border-green-900 text-green-400 placeholder-green-600 focus:border-green-400 focus:outline-none text-xs"
                  />
                  <input
                    type="text"
                    value={header.value}
                    onChange={(e) => updateHeader(index, 'value', e.target.value)}
                    placeholder="Value"
                    className="flex-1 px-2 py-1 bg-gray-900 border border-green-900 text-green-400 placeholder-green-600 focus:border-green-400 focus:outline-none text-xs"
                  />
                  <button
                    onClick={() => removeHeader(index)}
                    className="px-2 py-1 text-red-400 hover:bg-red-900/30 border border-red-900 rounded transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          {method !== 'GET' && method !== 'HEAD' && (
            <div>
              <h3 className="text-sm font-bold text-green-400 mb-2">Body</h3>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{"key": "value"}'
                className="w-full h-32 px-3 py-2 bg-gray-900 border border-green-900 text-green-400 placeholder-green-600 focus:border-green-400 focus:outline-none font-mono text-xs"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={executeRequest}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-green-900/30 text-green-400 border border-green-700 rounded hover:bg-green-900/50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Execute
                </>
              )}
            </button>
            <button
              onClick={saveRequest}
              className="px-4 py-2 bg-gray-900 text-green-400 border border-green-900 rounded hover:bg-gray-800 transition-colors flex items-center gap-2"
            >
              <Save className="w-3 h-3" />
              Save
            </button>
            <button
              onClick={copyCurl}
              className="px-4 py-2 bg-gray-900 text-green-400 border border-green-900 rounded hover:bg-gray-800 transition-colors flex items-center gap-2"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              cURL
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded">
              <div className="text-red-400 text-sm font-bold mb-1">Error</div>
              <div className="text-red-300 text-xs">{error}</div>
            </div>
          )}
        </div>
      </div>

      {/* Response Viewer */}
      <div className="w-1/2 p-4 overflow-y-auto">
        {response ? (
          <ResponseViewer 
            response={response} 
            executionTime={executionTime}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <div className="text-6xl mb-4">📡</div>
              <p className="text-sm">Execute a request to see the response</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ApiTester