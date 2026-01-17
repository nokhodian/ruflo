/**
 * @claude-flow/cache-optimizer - Type Definitions
 * Intelligent Cache Optimization System (ICOS)
 * Based on ADR-030: Claude Code Content Management Architecture
 */

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export interface CacheOptimizerConfig {
  /** Target utilization - never exceed this (default: 0.75 = 75%) */
  targetUtilization: number;

  /** Context window size in tokens (default: 200000) */
  contextWindowSize: number;

  /** Pruning thresholds and strategy */
  pruning: PruningConfig;

  /** Temporal compression settings */
  temporal: TemporalConfig;

  /** Intelligence layer settings */
  intelligence: IntelligenceConfig;

  /** Storage backend settings */
  storage: StorageConfig;

  /** Benchmarking settings */
  benchmarks: BenchmarkConfig;

  /** Hook timeouts */
  hooks: HookConfig;
}

export interface PruningConfig {
  /** Start pruning at this utilization (default: 0.60) */
  softThreshold: number;

  /** Aggressive pruning at this utilization (default: 0.75) */
  hardThreshold: number;

  /** Emergency pruning - last resort before compaction (default: 0.85) */
  emergencyThreshold: number;

  /** Minimum relevance score to keep (0-1, default: 0.3) */
  minRelevanceScore: number;

  /** Pruning strategy */
  strategy: PruningStrategy;

  /** Regex patterns for items to always preserve */
  preservePatterns: string[];

  /** Always keep last N entries regardless of score (default: 10) */
  preserveRecentCount: number;
}

export type PruningStrategy = 'adaptive' | 'aggressive' | 'conservative' | 'semantic';

export interface TemporalConfig {
  /** Tier boundaries and compression ratios */
  tiers: {
    hot: TierConfig;
    warm: TierConfig;
    cold: TierConfig;
  };

  /** Compression strategy */
  compressionStrategy: CompressionStrategy;

  /** Auto-promotion on access (default: true) */
  promoteOnAccess: boolean;

  /** Decay rate for relevance scores (default: 0.1 per tier transition) */
  decayRate: number;
}

export interface TierConfig {
  /** Maximum age in milliseconds */
  maxAge: number;
  /** Compression ratio (1.0 = no compression, 0.3 = 70% reduction) */
  compressionRatio: number;
}

export type CompressionStrategy = 'summary' | 'embedding' | 'hybrid';

export interface IntelligenceConfig {
  /** Attention mechanism settings */
  attention: AttentionConfig;

  /** SONA self-learning settings */
  sona: SONAConfig;

  /** Mixture of Experts settings */
  moe: MoEConfig;
}

export interface AttentionConfig {
  /** Enable attention-based scoring (default: true) */
  enabled: boolean;

  /** Attention type to use */
  type: AttentionType;

  /** Flash attention settings */
  flash: FlashAttentionConfig;

  /** Hyperbolic attention for hierarchical data */
  hyperbolic: HyperbolicAttentionConfig;
}

export type AttentionType = 'flash' | 'hyperbolic' | 'standard';

export interface FlashAttentionConfig {
  /** Block size for flash attention (default: 256) */
  blockSize: number;
  /** Use causal masking (default: true) */
  causal: boolean;
}

export interface HyperbolicAttentionConfig {
  /** Poincaré ball curvature (default: -1.0) */
  curvature: number;
  /** Embedding dimension (default: 128) */
  dimension: number;
}

export interface SONAConfig {
  /** Enable SONA self-learning (default: true) */
  enabled: boolean;

  /** Learning rate (default: 0.05) */
  learningRate: number;

  /** Trajectory window size (default: 100) */
  trajectoryWindow: number;

  /** EWC++ settings */
  ewc: EWCConfig;

  /** LoRA adaptation settings */
  lora: LoRAConfig;
}

export interface EWCConfig {
  /** EWC lambda parameter (default: 0.5) */
  lambda: number;
  /** Number of Fisher samples (default: 200) */
  fisherSamples: number;
}

export interface LoRAConfig {
  /** LoRA rank (default: 8) */
  rank: number;
  /** LoRA alpha (default: 16) */
  alpha: number;
}

export interface MoEConfig {
  /** Enable Mixture of Experts (default: true) */
  enabled: boolean;

  /** Number of experts (default: 4) */
  numExperts: number;

  /** Top-K experts to activate (default: 2) */
  topK: number;

  /** Expert types */
  experts: ExpertType[];
}

export type ExpertType = 'code' | 'tool' | 'conversation' | 'system';

export interface StorageConfig {
  /** Vector store settings */
  vector: VectorStoreConfig;

  /** Memory backend settings */
  memory: MemoryBackendConfig;

  /** LRU cache settings */
  cache: LRUCacheConfig;
}

export interface VectorStoreConfig {
  /** Vector store backend */
  backend: VectorBackend;

  /** HNSW settings */
  hnsw: HNSWConfig;

  /** Embedding dimensions (default: 384) */
  dimensions: number;
}

export type VectorBackend = 'hnsw' | 'flat' | 'ivf';

export interface HNSWConfig {
  /** HNSW M parameter (default: 16) */
  m: number;
  /** HNSW efConstruction (default: 200) */
  efConstruction: number;
  /** HNSW efSearch (default: 50) */
  efSearch: number;
}

export interface MemoryBackendConfig {
  /** Memory backend type */
  backend: MemoryBackend;
  /** Storage path */
  path?: string;
  /** Maximum entries */
  maxSize: number;
}

export type MemoryBackend = 'agentdb' | 'sqlite' | 'memory';

export interface LRUCacheConfig {
  /** Maximum cache size (default: 1000) */
  maxSize: number;
  /** TTL in milliseconds (default: 300000 = 5 min) */
  ttl: number;
}

export interface BenchmarkConfig {
  /** Enable benchmarking (default: true) */
  enabled: boolean;

  /** Sampling rate 0-1 (default: 0.1) */
  sampleRate: number;

  /** Metrics to track */
  metrics: MetricsConfig;

  /** Export settings */
  export: ExportConfig;
}

export interface MetricsConfig {
  tokenUsage: boolean;
  latency: boolean;
  compressionRatio: boolean;
  hitRate: boolean;
  compactionPrevention: boolean;
}

export interface ExportConfig {
  format: ExportFormat;
  /** Export interval in milliseconds (default: 60000 = 1 min) */
  interval: number;
  path?: string;
}

export type ExportFormat = 'json' | 'prometheus' | 'opentelemetry';

export interface HookConfig {
  /** Maximum execution time per hook in milliseconds */
  timeouts: HookTimeouts;

  /** Async processing settings */
  async: AsyncConfig;
}

export interface HookTimeouts {
  userPromptSubmit: number;
  preToolUse: number;
  postToolUse: number;
  preCompact: number;
}

export interface AsyncConfig {
  /** Enable async processing (default: true) */
  enabled: boolean;
  /** Queue size (default: 100) */
  queueSize: number;
}

// =============================================================================
// CACHE ENTRY TYPES
// =============================================================================

export interface CacheEntry {
  /** Unique entry identifier */
  id: string;

  /** Entry type classification */
  type: CacheEntryType;

  /** Original content */
  content: string;

  /** Token count */
  tokens: number;

  /** Creation timestamp */
  timestamp: number;

  /** Entry metadata */
  metadata: CacheEntryMetadata;

  /** Relevance scoring */
  relevance: RelevanceScore;

  /** Current temporal tier */
  tier: TemporalTier;

  /** Compressed versions (populated when tier > hot) */
  compressed?: CompressedEntry;

  /** Vector embedding */
  embedding?: Float32Array;

  /** Access count for frequency scoring */
  accessCount: number;

  /** Last access timestamp */
  lastAccessedAt: number;
}

export type CacheEntryType =
  | 'system_prompt'
  | 'claude_md'
  | 'file_read'
  | 'file_write'
  | 'tool_result'
  | 'bash_output'
  | 'user_message'
  | 'assistant_message'
  | 'mcp_context';

export interface CacheEntryMetadata {
  /** Origin of the entry */
  source: string;

  /** Associated file path */
  filePath?: string;

  /** Associated tool name */
  toolName?: string;

  /** Session identifier */
  sessionId: string;

  /** Task identifier */
  taskId?: string;

  /** Custom tags */
  tags: string[];

  /** Parent entry ID (for threaded content) */
  parentId?: string;

  /** Priority override (higher = more important) */
  priorityBoost?: number;
}

export interface RelevanceScore {
  /** Overall relevance (0-1) */
  overall: number;

  /** Component scores */
  components: RelevanceComponents;

  /** Last scored timestamp */
  scoredAt: number;

  /** Score confidence (0-1) */
  confidence: number;
}

export interface RelevanceComponents {
  /** Time-based score (decays with age) */
  recency: number;

  /** Access frequency score */
  frequency: number;

  /** Semantic relevance to current task */
  semantic: number;

  /** Attention weight from flash/hyperbolic attention */
  attention: number;

  /** MoE expert score */
  expert: number;
}

export type TemporalTier = 'hot' | 'warm' | 'cold' | 'archived';

export interface CompressedEntry {
  /** Compression method used */
  method: CompressionMethod;

  /** Compressed summary (for summary method) */
  summary?: string;

  /** Token count after compression */
  compressedTokens: number;

  /** Compression ratio achieved */
  ratio: number;

  /** Original token count */
  originalTokens: number;

  /** Compression timestamp */
  compressedAt: number;
}

export type CompressionMethod = 'summary' | 'embedding' | 'quantized';

// =============================================================================
// SCORING & DECISION TYPES
// =============================================================================

export interface ScoringContext {
  /** Current user query/task */
  currentQuery: string;

  /** Active file paths */
  activeFiles: string[];

  /** Active tool names */
  activeTools: string[];

  /** Current session ID */
  sessionId: string;

  /** Current task ID */
  taskId?: string;

  /** Scoring timestamp */
  timestamp: number;
}

export interface PruningDecision {
  /** Entries to prune (by ID) */
  toPrune: string[];

  /** Entries to compress (by ID) */
  toCompress: string[];

  /** Entries to promote to hotter tier (by ID) */
  toPromote: string[];

  /** Entries to demote to colder tier (by ID) */
  toDemote: string[];

  /** Tokens that will be freed */
  tokensToFree: number;

  /** Current utilization before pruning */
  currentUtilization: number;

  /** Projected utilization after pruning */
  projectedUtilization: number;

  /** Pruning urgency level */
  urgency: PruningUrgency;

  /** Decision timestamp */
  decidedAt: number;
}

export type PruningUrgency = 'none' | 'soft' | 'hard' | 'emergency';

export interface PruningResult {
  /** Number of entries pruned */
  prunedCount: number;

  /** Number of entries compressed */
  compressedCount: number;

  /** Number of entries promoted */
  promotedCount: number;

  /** Number of entries demoted */
  demotedCount: number;

  /** Tokens freed */
  tokensFreed: number;

  /** New utilization */
  newUtilization: number;

  /** Duration in milliseconds */
  durationMs: number;

  /** Success status */
  success: boolean;

  /** Error if failed */
  error?: string;
}

export interface TierTransitionResult {
  /** Entries moved hot -> warm */
  hotToWarm: number;

  /** Entries moved warm -> cold */
  warmToCold: number;

  /** Entries moved cold -> archived */
  coldToArchived: number;

  /** Entries promoted (accessed) */
  promoted: number;

  /** Tokens saved via compression */
  tokensSaved: number;

  /** Duration in milliseconds */
  durationMs: number;
}

// =============================================================================
// HOOK TYPES
// =============================================================================

export interface HookResult {
  /** Hook execution success */
  success: boolean;

  /** Actions taken */
  actions: HookAction[];

  /** Duration in milliseconds */
  durationMs: number;

  /** Compaction prevented */
  compactionPrevented: boolean;

  /** Tokens freed (if any) */
  tokensFreed: number;

  /** New utilization */
  newUtilization: number;

  /** Error if failed */
  error?: string;
}

export interface HookAction {
  type: HookActionType;
  entryId?: string;
  details: string;
}

export type HookActionType =
  | 'prune'
  | 'compress'
  | 'promote'
  | 'demote'
  | 'score_update'
  | 'emergency_prune'
  | 'block_compaction';

// =============================================================================
// METRICS & TELEMETRY TYPES
// =============================================================================

export interface CacheMetrics {
  /** Current token count */
  currentTokens: number;

  /** Context window size */
  contextWindowSize: number;

  /** Current utilization (0-1) */
  utilization: number;

  /** Entries by tier */
  entriesByTier: Record<TemporalTier, number>;

  /** Tokens by tier */
  tokensByTier: Record<TemporalTier, number>;

  /** Entries by type */
  entriesByType: Record<CacheEntryType, number>;

  /** Total entries */
  totalEntries: number;

  /** Compaction events prevented */
  compactionsPrevented: number;

  /** Total pruning operations */
  pruningOperations: number;

  /** Total compressions */
  compressions: number;

  /** Average relevance score */
  averageRelevance: number;

  /** Cache hit rate */
  hitRate: number;

  /** Uptime in milliseconds */
  uptimeMs: number;
}

export interface LatencyMetrics {
  /** Score calculation latency (p50, p95, p99) */
  scoring: PercentileMetrics;

  /** Pruning latency */
  pruning: PercentileMetrics;

  /** Compression latency */
  compression: PercentileMetrics;

  /** Hook execution latency */
  hooks: PercentileMetrics;

  /** HNSW search latency */
  vectorSearch: PercentileMetrics;
}

export interface PercentileMetrics {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_CONFIG: CacheOptimizerConfig = {
  targetUtilization: 0.75,
  contextWindowSize: 200000,

  pruning: {
    softThreshold: 0.60,
    hardThreshold: 0.75,
    emergencyThreshold: 0.85,
    minRelevanceScore: 0.3,
    strategy: 'adaptive',
    preservePatterns: [
      'system_prompt',
      'claude_md',
    ],
    preserveRecentCount: 10,
  },

  temporal: {
    tiers: {
      hot: {
        maxAge: 5 * 60 * 1000, // 5 minutes
        compressionRatio: 1.0,
      },
      warm: {
        maxAge: 30 * 60 * 1000, // 30 minutes
        compressionRatio: 0.3,
      },
      cold: {
        maxAge: Infinity,
        compressionRatio: 0.05,
      },
    },
    compressionStrategy: 'hybrid',
    promoteOnAccess: true,
    decayRate: 0.1,
  },

  intelligence: {
    attention: {
      enabled: true,
      type: 'flash',
      flash: {
        blockSize: 256,
        causal: true,
      },
      hyperbolic: {
        curvature: -1.0,
        dimension: 128,
      },
    },
    sona: {
      enabled: true,
      learningRate: 0.05,
      trajectoryWindow: 100,
      ewc: {
        lambda: 0.5,
        fisherSamples: 200,
      },
      lora: {
        rank: 8,
        alpha: 16,
      },
    },
    moe: {
      enabled: true,
      numExperts: 4,
      topK: 2,
      experts: ['code', 'tool', 'conversation', 'system'],
    },
  },

  storage: {
    vector: {
      backend: 'hnsw',
      hnsw: {
        m: 16,
        efConstruction: 200,
        efSearch: 50,
      },
      dimensions: 384,
    },
    memory: {
      backend: 'memory',
      maxSize: 10000,
    },
    cache: {
      maxSize: 1000,
      ttl: 5 * 60 * 1000, // 5 minutes
    },
  },

  benchmarks: {
    enabled: true,
    sampleRate: 0.1,
    metrics: {
      tokenUsage: true,
      latency: true,
      compressionRatio: true,
      hitRate: true,
      compactionPrevention: true,
    },
    export: {
      format: 'json',
      interval: 60000,
    },
  },

  hooks: {
    timeouts: {
      userPromptSubmit: 3000,
      preToolUse: 2000,
      postToolUse: 3000,
      preCompact: 5000,
    },
    async: {
      enabled: true,
      queueSize: 100,
    },
  },
};
