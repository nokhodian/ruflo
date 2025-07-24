/**
 * MCP Tools Bridge
 * Provides access to 71+ MCP tools through the HiveMind integration
 */

import { getHiveMindClient } from './hive-client';
import { getMCPWebSocketClient, MCPWebSocketClient } from './mcp-websocket-client';

export interface MCPTool {
  name: string;
  description: string;
  parameters: any;
  category: ToolCategory;
}

export type ToolCategory = 
  | 'coordination'
  | 'monitoring'
  | 'memory'
  | 'neural'
  | 'github'
  | 'system'
  | 'workflow'
  | 'daa'
  | 'sparc';

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
  metadata?: {
    tokenUsage?: number;
    memoryUsage?: number;
    agentId?: string;
  };
}

export interface ToolExecutionOptions {
  timeout?: number;
  retryCount?: number;
  cacheResult?: boolean;
  trackMetrics?: boolean;
}

/**
 * MCP Tools Bridge Class
 */
export class MCPBridge {
  private client = getHiveMindClient();
  private wsClient: MCPWebSocketClient;
  private toolCache = new Map<string, MCPTool>();
  private executionHistory: Array<{
    tool: string;
    timestamp: Date;
    duration: number;
    success: boolean;
  }> = [];
  private availableTools: MCPTool[] = [];
  private wsConnected = false;

  /**
   * Get all available MCP tools
   */
  async getAvailableTools(): Promise<MCPTool[]> {
    // Return the full list of 71+ MCP tools
    return [
      // Coordination Tools
      {
        name: 'swarm_init',
        description: 'Initialize swarm with topology and configuration',
        parameters: {
          topology: { type: 'string', enum: ['hierarchical', 'mesh', 'ring', 'star'], optional: true, default: 'hierarchical' },
          maxAgents: { type: 'number', default: 8, optional: true },
          strategy: { type: 'string', default: 'auto', optional: true }
        },
        category: 'coordination' as ToolCategory
      },
      {
        name: 'agent_spawn',
        description: 'Create specialized AI agents',
        parameters: {
          type: { type: 'string', enum: ['coordinator', 'researcher', 'coder', 'analyst', 'architect', 'tester', 'reviewer', 'optimizer', 'documenter', 'monitor', 'specialist'], optional: true, default: 'general' },
          name: { type: 'string', optional: true },
          capabilities: { type: 'array', optional: true },
          swarmId: { type: 'string', optional: true }
        },
        category: 'coordination' as ToolCategory
      },
      {
        name: 'task_orchestrate',
        description: 'Orchestrate complex task workflows',
        parameters: {
          task: { type: 'string', optional: true, default: 'default task' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], optional: true, default: 'medium' },
          strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive', 'balanced'], optional: true, default: 'adaptive' },
          dependencies: { type: 'array', optional: true }
        },
        category: 'coordination' as ToolCategory
      },
      
      // Monitoring Tools
      {
        name: 'swarm_status',
        description: 'Monitor swarm health and performance',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'agent_list',
        description: 'List active agents & capabilities',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'agent_metrics',
        description: 'Agent performance metrics',
        parameters: {
          agentId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'swarm_monitor',
        description: 'Real-time swarm monitoring',
        parameters: {
          swarmId: { type: 'string', optional: true },
          interval: { type: 'number', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'task_status',
        description: 'Check task execution status',
        parameters: {
          taskId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'task_results',
        description: 'Get task completion results',
        parameters: {
          taskId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'topology_optimize',
        description: 'Auto-optimize swarm topology',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'load_balance',
        description: 'Distribute tasks efficiently',
        parameters: {
          swarmId: { type: 'string', optional: true },
          tasks: { type: 'array', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'coordination_sync',
        description: 'Sync agent coordination',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'swarm_scale',
        description: 'Auto-scale agent count',
        parameters: {
          swarmId: { type: 'string', optional: true },
          targetSize: { type: 'number', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      {
        name: 'swarm_destroy',
        description: 'Gracefully shutdown swarm',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'monitoring' as ToolCategory
      },
      
      // Memory & Neural Tools
      {
        name: 'memory_usage',
        description: 'Store/retrieve persistent memory with TTL and namespacing',
        parameters: {
          action: { type: 'string', enum: ['store', 'retrieve', 'list', 'delete', 'search'] },
          key: { type: 'string', optional: true },
          value: { type: 'string', optional: true },
          namespace: { type: 'string', default: 'default', optional: true },
          ttl: { type: 'number', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_search',
        description: 'Search memory with patterns',
        parameters: {
          pattern: { type: 'string' },
          namespace: { type: 'string', optional: true },
          limit: { type: 'number', default: 10, optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_persist',
        description: 'Cross-session persistence',
        parameters: {
          sessionId: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_namespace',
        description: 'Namespace management',
        parameters: {
          namespace: { type: 'string', optional: true },
          action: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_backup',
        description: 'Backup memory stores',
        parameters: {
          path: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_restore',
        description: 'Restore from backups',
        parameters: {
          backupPath: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_compress',
        description: 'Compress memory data',
        parameters: {
          namespace: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_sync',
        description: 'Sync across instances',
        parameters: {
          target: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'cache_manage',
        description: 'Manage coordination cache',
        parameters: {
          action: { type: 'string', optional: true },
          key: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'state_snapshot',
        description: 'Create state snapshots',
        parameters: {
          name: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'context_restore',
        description: 'Restore execution context',
        parameters: {
          snapshotId: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'memory_analytics',
        description: 'Analyze memory usage',
        parameters: {
          timeframe: { type: 'string', optional: true }
        },
        category: 'memory' as ToolCategory
      },
      {
        name: 'neural_status',
        description: 'Check neural network status',
        parameters: {
          modelId: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'neural_train',
        description: 'Train neural patterns with WASM SIMD acceleration',
        parameters: {
          pattern_type: { type: 'string', enum: ['coordination', 'optimization', 'prediction'], optional: true, default: 'coordination' },
          training_data: { type: 'string', optional: true, default: 'recent' },
          epochs: { type: 'number', default: 50, optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'neural_patterns',
        description: 'Analyze cognitive patterns',
        parameters: {
          action: { type: 'string', enum: ['analyze', 'learn', 'predict'] },
          operation: { type: 'string', optional: true },
          outcome: { type: 'string', optional: true },
          metadata: { type: 'object', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'neural_predict',
        description: 'Make AI predictions',
        parameters: {
          modelId: { type: 'string', optional: true },
          input: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'model_load',
        description: 'Load pre-trained models',
        parameters: {
          modelPath: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'model_save',
        description: 'Save trained models',
        parameters: {
          modelId: { type: 'string', optional: true },
          path: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'wasm_optimize',
        description: 'WASM SIMD optimization',
        parameters: {
          operation: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'inference_run',
        description: 'Run neural inference',
        parameters: {
          modelId: { type: 'string', optional: true },
          data: { type: 'array', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'pattern_recognize',
        description: 'Pattern recognition',
        parameters: {
          data: { type: 'array', optional: true },
          patterns: { type: 'array', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'cognitive_analyze',
        description: 'Cognitive behavior analysis',
        parameters: {
          behavior: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'learning_adapt',
        description: 'Adaptive learning',
        parameters: {
          experience: { type: 'object', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'neural_compress',
        description: 'Compress neural models',
        parameters: {
          modelId: { type: 'string', optional: true },
          ratio: { type: 'number', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'ensemble_create',
        description: 'Create model ensembles',
        parameters: {
          models: { type: 'array', optional: true },
          strategy: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'transfer_learn',
        description: 'Transfer learning',
        parameters: {
          sourceModel: { type: 'string', optional: true },
          targetDomain: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'neural_explain',
        description: 'AI explainability',
        parameters: {
          modelId: { type: 'string', optional: true },
          prediction: { type: 'object', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      
      // GitHub Integration Tools
      {
        name: 'github_repo_analyze',
        description: 'Repository analysis',
        parameters: {
          repo: { type: 'string', optional: true },
          analysis_type: { type: 'string', enum: ['code_quality', 'performance', 'security'], optional: true }
        },
        category: 'github' as ToolCategory
      },
      {
        name: 'github_pr_manage',
        description: 'Pull request management',
        parameters: {
          repo: { type: 'string', optional: true },
          action: { type: 'string', enum: ['review', 'merge', 'close'], optional: true },
          pr_number: { type: 'number', optional: true }
        },
        category: 'github' as ToolCategory
      },
      {
        name: 'github_issue_track',
        description: 'Issue tracking & triage',
        parameters: {
          repo: { type: 'string', optional: true },
          action: { type: 'string', optional: true }
        },
        category: 'github' as ToolCategory
      },
      {
        name: 'github_release_coord',
        description: 'Release coordination',
        parameters: {
          repo: { type: 'string', optional: true },
          version: { type: 'string', optional: true }
        },
        category: 'github' as ToolCategory
      },
      {
        name: 'github_workflow_auto',
        description: 'Workflow automation',
        parameters: {
          repo: { type: 'string', optional: true },
          workflow: { type: 'object', optional: true }
        },
        category: 'github' as ToolCategory
      },
      {
        name: 'github_code_review',
        description: 'Automated code review',
        parameters: {
          repo: { type: 'string', optional: true },
          pr: { type: 'number', optional: true }
        },
        category: 'github' as ToolCategory
      },
      {
        name: 'github_sync_coord',
        description: 'Multi-repo sync coordination',
        parameters: {
          repos: { type: 'array', optional: true }
        },
        category: 'github' as ToolCategory
      },
      {
        name: 'github_metrics',
        description: 'Repository metrics',
        parameters: {
          repo: { type: 'string', optional: true }
        },
        category: 'github' as ToolCategory
      },
      
      // System Tools
      {
        name: 'performance_report',
        description: 'Generate performance reports with real-time metrics',
        parameters: {
          format: { type: 'string', default: 'summary', enum: ['summary', 'detailed', 'json'] },
          timeframe: { type: 'string', default: '24h', enum: ['24h', '7d', '30d'] }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'bottleneck_analyze',
        description: 'Identify performance bottlenecks',
        parameters: {
          component: { type: 'string', optional: true },
          metrics: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'token_usage',
        description: 'Analyze token consumption',
        parameters: {
          operation: { type: 'string', optional: true },
          timeframe: { type: 'string', default: '24h', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'benchmark_run',
        description: 'Performance benchmarks',
        parameters: {
          suite: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'metrics_collect',
        description: 'Collect system metrics',
        parameters: {
          components: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'trend_analysis',
        description: 'Analyze performance trends',
        parameters: {
          metric: { type: 'string' },
          period: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'cost_analysis',
        description: 'Cost and resource analysis',
        parameters: {
          timeframe: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'quality_assess',
        description: 'Quality assessment',
        parameters: {
          target: { type: 'string' },
          criteria: { type: 'array' }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'error_analysis',
        description: 'Error pattern analysis',
        parameters: {
          logs: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'usage_stats',
        description: 'Usage statistics',
        parameters: {
          component: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'health_check',
        description: 'System health monitoring',
        parameters: {
          components: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'terminal_execute',
        description: 'Execute terminal commands',
        parameters: {
          command: { type: 'string', optional: true },
          args: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'config_manage',
        description: 'Configuration management',
        parameters: {
          action: { type: 'string', optional: true },
          config: { type: 'object', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'security_scan',
        description: 'Security scanning',
        parameters: {
          target: { type: 'string', optional: true },
          depth: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'backup_create',
        description: 'Create system backups',
        parameters: {
          components: { type: 'array', optional: true },
          destination: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'restore_system',
        description: 'System restoration',
        parameters: {
          backupId: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'log_analysis',
        description: 'Log analysis & insights',
        parameters: {
          logFile: { type: 'string', optional: true },
          patterns: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'diagnostic_run',
        description: 'System diagnostics',
        parameters: {
          components: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      
      // Workflow Tools
      {
        name: 'workflow_create',
        description: 'Create custom workflows',
        parameters: {
          name: { type: 'string' },
          steps: { type: 'array' },
          triggers: { type: 'array', optional: true, default: [] }
        },
        category: 'workflow' as ToolCategory
      },
      {
        name: 'workflow_execute',
        description: 'Execute predefined workflows',
        parameters: {
          workflowId: { type: 'string', optional: true },
          params: { type: 'object', optional: true }
        },
        category: 'workflow' as ToolCategory
      },
      
      // DAA Tools
      {
        name: 'daa_agent_create',
        description: 'Create dynamic agents',
        parameters: {
          agent_type: { type: 'string' },
          capabilities: { type: 'array', optional: true },
          resources: { type: 'object', optional: true }
        },
        category: 'daa' as ToolCategory
      },
      {
        name: 'daa_capability_match',
        description: 'Match capabilities to tasks',
        parameters: {
          task_requirements: { type: 'array' },
          available_agents: { type: 'array', optional: true }
        },
        category: 'daa' as ToolCategory
      },
      {
        name: 'daa_resource_alloc',
        description: 'Resource allocation',
        parameters: {
          resources: { type: 'object' },
          agents: { type: 'array', optional: true }
        },
        category: 'daa' as ToolCategory
      },
      {
        name: 'daa_lifecycle_manage',
        description: 'Agent lifecycle management',
        parameters: {
          agentId: { type: 'string' },
          action: { type: 'string' }
        },
        category: 'daa' as ToolCategory
      },
      {
        name: 'daa_communication',
        description: 'Inter-agent communication',
        parameters: {
          from: { type: 'string' },
          to: { type: 'string' },
          message: { type: 'object' }
        },
        category: 'daa' as ToolCategory
      },
      {
        name: 'daa_consensus',
        description: 'Consensus mechanisms',
        parameters: {
          agents: { type: 'array' },
          proposal: { type: 'object' }
        },
        category: 'daa' as ToolCategory
      },
      {
        name: 'daa_fault_tolerance',
        description: 'Fault tolerance & recovery',
        parameters: {
          agentId: { type: 'string' },
          strategy: { type: 'string', optional: true }
        },
        category: 'daa' as ToolCategory
      },
      {
        name: 'daa_optimization',
        description: 'Performance optimization',
        parameters: {
          target: { type: 'string', optional: true },
          metrics: { type: 'array', optional: true }
        },
        category: 'daa' as ToolCategory
      },
      
      // SPARC Development Modes
      {
        name: 'sparc_mode',
        description: 'Run SPARC development modes',
        parameters: {
          mode: { type: 'string', enum: ['dev', 'api', 'ui', 'test', 'refactor'], optional: true, default: 'dev' },
          task_description: { type: 'string', optional: true },
          options: { type: 'object', optional: true }
        },
        category: 'sparc' as ToolCategory
      },
      
      // Additional System Tools
      {
        name: 'topology_optimize',
        description: 'Auto-optimize swarm topology',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'load_balance',
        description: 'Distribute tasks efficiently',
        parameters: {
          swarmId: { type: 'string', optional: true },
          tasks: { type: 'array', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'coordination_sync',
        description: 'Sync agent coordination',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'swarm_scale',
        description: 'Auto-scale agent count',
        parameters: {
          swarmId: { type: 'string', optional: true },
          targetSize: { type: 'number', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'swarm_destroy',
        description: 'Gracefully shutdown swarm',
        parameters: {
          swarmId: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'features_detect',
        description: 'Feature detection',
        parameters: {
          component: { type: 'string', optional: true }
        },
        category: 'system' as ToolCategory
      },
      {
        name: 'neural_sync',
        description: 'Synchronize neural networks',
        parameters: {
          sourceModel: { type: 'string', optional: true },
          targetModel: { type: 'string', optional: true }
        },
        category: 'neural' as ToolCategory
      },
      {
        name: 'remove_agent',
        description: 'Remove agent from swarm',
        parameters: {
          agentId: { type: 'string', optional: true }
        },
        category: 'coordination' as ToolCategory
      },
      {
        name: 'cancel_task',
        description: 'Cancel running task',
        parameters: {
          taskId: { type: 'string', optional: true }
        },
        category: 'coordination' as ToolCategory
      }
    ];
  }

  /**
   * Initialize tools on construction
   */
  constructor() {
    this.wsClient = getMCPWebSocketClient();
    this.initializeTools();
    this.setupWebSocketHandlers();
  }

  private async initializeTools() {
    try {
      // Try to connect to WebSocket first
      await this.connectWebSocket();
      
      if (this.wsConnected) {
        // Get tools from WebSocket server
        const tools = await this.wsClient.listTools();
        this.availableTools = this.convertMCPToolsToLocal(tools);
      } else {
        // Fallback to static list
        this.availableTools = await this.getAvailableTools();
      }
    } catch (error) {
      console.warn('Failed to initialize from WebSocket, using static tools:', error);
      this.availableTools = await this.getAvailableTools();
    }
  }

  /**
   * Connect to WebSocket and initialize MCP
   */
  private async connectWebSocket(): Promise<void> {
    try {
      // Silently attempt WebSocket connection
      await this.wsClient.connect();
      await this.wsClient.initialize();
      console.log('MCP WebSocket initialized successfully');
      this.wsConnected = true;
    } catch (error) {
      // Silently fall back to HTTP - this is expected behavior
      this.wsConnected = false;
      // Don't throw error to allow HTTP fallback
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    this.wsClient.on('connected', () => {
      console.log('MCP WebSocket connected');
      this.initializeTools(); // Refresh tools on reconnect
    });

    this.wsClient.on('disconnected', () => {
      // Silently handle disconnection - HTTP fallback continues to work
      this.wsConnected = false;
    });

    this.wsClient.on('error', (error) => {
      // Silently handle WebSocket errors - HTTP fallback is working
    });

    this.wsClient.on('stream', ({ streamId, data }) => {
      // Handle streaming responses
      console.log('Stream data:', streamId, data);
    });
  }

  /**
   * Convert MCP tools to local format
   */
  private convertMCPToolsToLocal(mcpTools: any[]): MCPTool[] {
    return mcpTools.map(tool => {
      // Extract category from tool name pattern
      let category: ToolCategory = 'system';
      if (tool.name.includes('swarm') || tool.name.includes('agent') || tool.name.includes('task')) {
        category = 'coordination';
      } else if (tool.name.includes('memory') || tool.name.includes('cache')) {
        category = 'memory';
      } else if (tool.name.includes('neural') || tool.name.includes('model')) {
        category = 'neural';
      } else if (tool.name.includes('github') || tool.name.includes('repo')) {
        category = 'github';
      } else if (tool.name.includes('monitor') || tool.name.includes('status') || tool.name.includes('metrics')) {
        category = 'monitoring';
      } else if (tool.name.includes('workflow')) {
        category = 'workflow';
      } else if (tool.name.includes('daa')) {
        category = 'daa';
      } else if (tool.name.includes('sparc')) {
        category = 'sparc';
      }

      return {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema || {},
        category
      };
    });
  }

  /**
   * Validate parameters for a tool
   */
  async validateParameters(toolName: string, parameters: any): Promise<{ valid: boolean; errors?: string[] }> {
    // Remove the mcp__claude-flow__ prefix if present
    const cleanToolName = toolName.replace(/^mcp__claude-flow__/, '');
    
    // Find the tool in available tools
    const tool = this.availableTools.find(t => t.name === cleanToolName);
    
    if (!tool) {
      return {
        valid: false,
        errors: [`Unknown tool: ${cleanToolName}`]
      };
    }

    const errors: string[] = [];
    
    // Validate required parameters
    if (tool.parameters) {
      for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
        const paramConfig = paramDef as any;
        
        // Check if parameter is required (no default value and not optional)
        if (!paramConfig.optional && paramConfig.default === undefined && !(paramName in parameters)) {
          errors.push(`Missing required parameter: ${paramName}`);
        }
        
        // Validate parameter type
        if (paramName in parameters) {
          const value = parameters[paramName];
          const expectedType = paramConfig.type;
          
          if (expectedType === 'string' && typeof value !== 'string') {
            errors.push(`Parameter ${paramName} must be a string`);
          } else if (expectedType === 'number' && typeof value !== 'number') {
            errors.push(`Parameter ${paramName} must be a number`);
          } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
            errors.push(`Parameter ${paramName} must be a boolean`);
          } else if (expectedType === 'array' && !Array.isArray(value)) {
            errors.push(`Parameter ${paramName} must be an array`);
          }
          
          // Validate enum values
          if (paramConfig.enum && !paramConfig.enum.includes(value)) {
            errors.push(`Parameter ${paramName} must be one of: ${paramConfig.enum.join(', ')}`);
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Execute an MCP tool
   */
  async executeTool(
    toolName: string, 
    parameters: any, 
    options: ToolExecutionOptions = {}
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Remove the mcp__claude-flow__ prefix if present
      const cleanToolName = toolName.replace(/^mcp__claude-flow__/, '');
      
      // Map tool names to client methods
      const result = await this.executeToolInternal(cleanToolName, parameters);
      
      const executionTime = Date.now() - startTime;
      
      // Track execution history
      this.executionHistory.push({
        tool: toolName,
        timestamp: new Date(),
        duration: executionTime,
        success: true
      });
      
      // Store in cache if requested
      if (options.cacheResult) {
        await this.cacheToolResult(toolName, parameters, result);
      }
      
      // Track metrics if requested
      if (options.trackMetrics) {
        await this.trackToolMetrics(toolName, executionTime, true);
      }
      
      return {
        success: true,
        data: result,
        executionTime,
        metadata: {
          agentId: parameters.agentId,
          tokenUsage: await this.estimateTokenUsage(toolName, parameters)
        }
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // Track failed execution
      this.executionHistory.push({
        tool: toolName,
        timestamp: new Date(),
        duration: executionTime,
        success: false
      });
      
      // Track metrics for failure
      if (options.trackMetrics) {
        await this.trackToolMetrics(toolName, executionTime, false);
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime
      };
    }
  }

  /**
   * Internal tool execution
   */
  private async executeToolInternal(toolName: string, parameters: any): Promise<any> {
    // Try WebSocket first if connected
    if (this.wsConnected) {
      try {
        const result = await this.wsClient.callTool(`mcp__claude-flow__${toolName}`, parameters);
        
        // Extract content from MCP response format
        if (result && result.content) {
          const textContent = result.content.find(c => c.type === 'text');
          if (textContent && textContent.text) {
            try {
              // Try to parse as JSON if possible
              return JSON.parse(textContent.text);
            } catch {
              // Return as-is if not JSON
              return textContent.text;
            }
          }
          
          // Return the first content item's data if no text
          if (result.content[0] && result.content[0].data) {
            return result.content[0].data;
          }
        }
        
        return result;
      } catch (wsError) {
        console.warn('WebSocket tool execution failed, falling back to HTTP:', wsError);
      }
    }
    
    // Fallback to HTTP API
    const response = await fetch('http://localhost:3001/api/mcp/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        toolName,
        parameters
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Tool execution failed');
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Tool execution failed');
    }

    return result.data;
  }

  /**
   * Get tool by name
   */
  async getTool(name: string): Promise<MCPTool | undefined> {
    if (this.toolCache.has(name)) {
      return this.toolCache.get(name);
    }
    
    const tools = await this.getAvailableTools();
    const tool = tools.find(t => t.name === name);
    
    if (tool) {
      this.toolCache.set(name, tool);
    }
    
    return tool;
  }

  /**
   * Get tools by category
   */
  async getToolsByCategory(category: ToolCategory): Promise<MCPTool[]> {
    const tools = await this.getAvailableTools();
    return tools.filter(t => t.category === category);
  }

  /**
   * Search tools by keyword
   */
  async searchTools(keyword: string): Promise<MCPTool[]> {
    const tools = await this.getAvailableTools();
    const lowerKeyword = keyword.toLowerCase();
    
    return tools.filter(t => 
      t.name.toLowerCase().includes(lowerKeyword) ||
      t.description.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Cache tool result
   */
  private async cacheToolResult(toolName: string, parameters: any, result: any): Promise<void> {
    try {
      const cacheKey = `tool:${toolName}:${JSON.stringify(parameters)}`;
      await this.client.storeMemory(cacheKey, result, 'tool-cache', 3600); // 1 hour TTL
    } catch (error) {
      console.warn('Failed to cache tool result:', error);
    }
  }

  /**
   * Track tool metrics
   */
  private async trackToolMetrics(toolName: string, executionTime: number, success: boolean): Promise<void> {
    try {
      await this.client.storeMemory(
        `metrics:tool:${toolName}`,
        {
          lastExecution: new Date(),
          executionTime,
          success,
          totalExecutions: this.executionHistory.filter(h => h.tool === toolName).length
        },
        'metrics',
        86400 // 24 hour TTL
      );
    } catch (error) {
      console.warn('Failed to track tool metrics:', error);
    }
  }

  /**
   * Estimate token usage for a tool
   */
  private async estimateTokenUsage(toolName: string, parameters: any): Promise<number> {
    // Simple estimation based on parameter size
    const paramStr = JSON.stringify(parameters);
    const baseTokens = 50; // Base tokens for tool execution
    const paramTokens = Math.ceil(paramStr.length / 4); // Rough estimation
    
    return baseTokens + paramTokens;
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit?: number): Array<{
    tool: string;
    timestamp: Date;
    duration: number;
    success: boolean;
  }> {
    if (limit) {
      return this.executionHistory.slice(-limit);
    }
    return [...this.executionHistory];
  }

  /**
   * Clear execution history
   */
  clearExecutionHistory(): void {
    this.executionHistory = [];
  }

  /**
   * Get tool statistics
   */
  getToolStatistics(): Record<string, {
    totalExecutions: number;
    successRate: number;
    avgExecutionTime: number;
  }> {
    const stats: Record<string, any> = {};
    
    for (const execution of this.executionHistory) {
      if (!stats[execution.tool]) {
        stats[execution.tool] = {
          totalExecutions: 0,
          successCount: 0,
          totalTime: 0
        };
      }
      
      stats[execution.tool].totalExecutions++;
      if (execution.success) {
        stats[execution.tool].successCount++;
      }
      stats[execution.tool].totalTime += execution.duration;
    }
    
    // Calculate final statistics
    const finalStats: Record<string, any> = {};
    for (const [tool, data] of Object.entries(stats)) {
      finalStats[tool] = {
        totalExecutions: data.totalExecutions,
        successRate: data.successCount / data.totalExecutions,
        avgExecutionTime: data.totalTime / data.totalExecutions
      };
    }
    
    return finalStats;
  }

  /**
   * Get WebSocket connection status
   */
  isWebSocketConnected(): boolean {
    return this.wsConnected;
  }

  /**
   * Manually reconnect WebSocket
   */
  async reconnectWebSocket(): Promise<void> {
    await this.connectWebSocket();
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    this.wsClient.disconnect();
    this.wsConnected = false;
  }
}

// Singleton instance
let mcpBridge: MCPBridge | null = null;

/**
 * Get or create MCP Bridge instance
 */
export function getMCPBridge(): MCPBridge {
  if (!mcpBridge) {
    mcpBridge = new MCPBridge();
  }
  return mcpBridge;
}