export interface Route {
  /** Unique name for this route, typically an agent category */
  name: string;
  /** The agent slug from ALLOWED_AGENT_TYPES to dispatch to */
  agentSlug: string;
  /** 10–15 representative task descriptions for this agent */
  utterances: string[];
  /** Minimum cosine similarity required for a confident match (default: 0.72) */
  threshold: number;
  /** If true and confidence < threshold, escalate to LLM classifier */
  fallbackToLLM: boolean;
  /** Human-readable description of what this agent handles */
  description?: string;
}

export interface RouteResult {
  /** The resolved agent slug from ALLOWED_AGENT_TYPES */
  agentSlug: string;
  /** Cosine similarity score (0.0–1.0) */
  confidence: number;
  /** How the routing decision was made */
  method: 'semantic' | 'keyword' | 'llm_fallback';
  /** The route name that matched */
  routeName: string;
  /** All routes with their scores, for debugging */
  allScores?: Array<{ routeName: string; agentSlug: string; score: number }>;
}

export interface RouteLayerConfig {
  routes: Route[];
  /** Encoder type to use for embeddings */
  encoder?: 'hnsw' | 'local';
  /** If true, include all route scores in RouteResult */
  debug?: boolean;
  /** Global minimum threshold override */
  globalThreshold?: number;
}

export interface AgentCapability {
  slug: string;
  description: string;
  taskTypes: string[];
  expertise: string[];
}
