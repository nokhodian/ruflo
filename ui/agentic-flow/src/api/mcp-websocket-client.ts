/**
 * MCP WebSocket Client
 * Real, functional WebSocket client for MCP JSON-RPC 2.0 protocol
 */

// Browser-compatible EventEmitter
class EventEmitter {
  private events: Map<string, Array<(...args: any[]) => void>> = new Map();

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    if (!this.events.has(event)) return false;
    this.events.get(event)!.forEach(listener => listener(...args));
    return true;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    if (!this.events.has(event)) return this;
    const listeners = this.events.get(event)!;
    const index = listeners.indexOf(listener);
    if (index > -1) listeners.splice(index, 1);
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }
}

export interface MCPWebSocketConfig {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  requestTimeout?: number;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    logging?: boolean;
  };
  serverInfo: {
    name: string;
    version?: string;
  };
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface MCPToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    data?: any;
  }>;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: number;
};

export class MCPWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<MCPWebSocketConfig>;
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private requestId = 0;
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'disconnected';
  private initialized = false;
  private streamingHandlers = new Map<string, (data: any) => void>();

  constructor(config: MCPWebSocketConfig = {}) {
    super();
    
    this.config = {
      url: config.url || 'ws://127.0.0.1:3008',
      reconnectInterval: config.reconnectInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 0, // Disable auto-reconnect by default
      requestTimeout: config.requestTimeout || 30000
    };
  }

  /**
   * Connect to the MCP WebSocket server
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connected') {
      return;
    }

    if (this.connectionState === 'connecting') {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const checkConnection = setInterval(() => {
          if (this.connectionState === 'connected') {
            clearInterval(checkConnection);
            resolve();
          } else if (this.connectionState === 'disconnected') {
            clearInterval(checkConnection);
            reject(new Error('Connection failed'));
          }
        }, 100);
      });
    }

    this.connectionState = 'connecting';
    
    try {
      await this.createWebSocket();
      this.connectionState = 'connected';
      this.reconnectAttempts = 0;
      this.emit('connected');
    } catch (error) {
      this.connectionState = 'disconnected';
      throw error;
    }
  }

  /**
   * Initialize the MCP connection
   */
  async initialize(): Promise<MCPInitializeResult> {
    if (!this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const result = await this.sendRequest<MCPInitializeResult>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      clientInfo: {
        name: 'claude-flow-ui',
        version: '1.0.0'
      }
    });

    this.initialized = true;
    this.emit('initialized', result);
    
    return result;
  }

  /**
   * List all available MCP tools
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.initialized) {
      throw new Error('MCP connection not initialized');
    }

    const response = await this.sendRequest<{ tools: MCPTool[] }>('tools/list', {});
    return response.tools || [];
  }

  /**
   * Call an MCP tool
   */
  async callTool(name: string, params: any = {}): Promise<MCPToolCallResult> {
    if (!this.initialized) {
      throw new Error('MCP connection not initialized');
    }

    return await this.sendRequest<MCPToolCallResult>('tools/call', {
      name,
      arguments: params
    });
  }

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void {
    this.connectionState = 'disconnected';
    this.initialized = false;
    
    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    // Reject all pending requests
    this.pendingRequests.forEach(({ reject, timeout }) => {
      window.clearTimeout(timeout);
      reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();

    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getConnectionState(): string {
    return this.connectionState;
  }

  /**
   * Register a handler for streaming responses
   */
  onStream(streamId: string, handler: (data: any) => void): void {
    this.streamingHandlers.set(streamId, handler);
  }

  /**
   * Unregister a streaming handler
   */
  offStream(streamId: string): void {
    this.streamingHandlers.delete(streamId);
  }

  /**
   * Create and configure WebSocket connection
   */
  private async createWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Check if WebSocket server is likely running by trying to connect silently
        this.ws = new WebSocket(this.config.url);
        
        const connectTimeout = window.setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 2000); // Shorter timeout for faster fallback

        this.ws.onopen = () => {
          window.clearTimeout(connectTimeout);
          console.log('MCP WebSocket connected');
          resolve();
        };

        this.ws.onclose = (event) => {
          window.clearTimeout(connectTimeout);
          // Only log if it was unexpected
          if (this.connectionState === 'connected') {
            console.log('MCP WebSocket closed:', event.code, event.reason);
          }
          this.handleDisconnect();
        };

        this.ws.onerror = (error) => {
          window.clearTimeout(connectTimeout);
          // Silently handle connection errors - HTTP fallback is expected
          this.emit('error', error);
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      // Handle JSON-RPC response
      if ('id' in message && message.id !== null) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          window.clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);
          
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      }
      
      // Handle JSON-RPC notification
      else if ('method' in message && !('id' in message)) {
        this.handleNotification(message as JsonRpcNotification);
      }
    } catch (error) {
      console.error('Failed to parse MCP message:', error);
      this.emit('error', error);
    }
  }

  /**
   * Handle JSON-RPC notifications
   */
  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'stream':
        const { streamId, data } = notification.params || {};
        const handler = this.streamingHandlers.get(streamId);
        if (handler) {
          handler(data);
        }
        this.emit('stream', { streamId, data });
        break;
        
      case 'progress':
        this.emit('progress', notification.params);
        break;
        
      case 'log':
        this.emit('log', notification.params);
        break;
        
      default:
        this.emit('notification', notification);
    }
  }

  /**
   * Send a JSON-RPC request
   */
  private async sendRequest<T = any>(method: string, params?: any): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('WebSocket not connected');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        window.clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket disconnect
   */
  private handleDisconnect(): void {
    const wasConnected = this.connectionState === 'connected';
    this.connectionState = 'disconnected';
    this.initialized = false;

    // Clear all pending requests
    this.pendingRequests.forEach(({ reject, timeout }) => {
      window.clearTimeout(timeout);
      reject(new Error('Connection lost'));
    });
    this.pendingRequests.clear();

    // Attempt reconnection if we were previously connected
    if (wasConnected && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.connectionState = 'reconnecting';
      this.reconnectAttempts++;
      
      console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}...`);
      this.emit('reconnecting', this.reconnectAttempts);

      this.reconnectTimeout = window.setTimeout(async () => {
        try {
          await this.connect();
          if (this.isConnected()) {
            await this.initialize();
          }
        } catch (error) {
          console.error('Reconnection failed:', error);
          this.handleDisconnect();
        }
      }, this.config.reconnectInterval);
    } else {
      this.emit('disconnected');
    }
  }
}

// Singleton instance
let mcpWebSocketClient: MCPWebSocketClient | null = null;

/**
 * Get or create MCP WebSocket client instance
 */
export function getMCPWebSocketClient(config?: MCPWebSocketConfig): MCPWebSocketClient {
  if (!mcpWebSocketClient) {
    mcpWebSocketClient = new MCPWebSocketClient(config);
  }
  return mcpWebSocketClient;
}

/**
 * Typed event emitter for better TypeScript support
 */
export interface MCPWebSocketEvents {
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
  initialized: (result: MCPInitializeResult) => void;
  error: (error: Error) => void;
  stream: (data: { streamId: string; data: any }) => void;
  progress: (data: any) => void;
  log: (data: any) => void;
  notification: (notification: JsonRpcNotification) => void;
}