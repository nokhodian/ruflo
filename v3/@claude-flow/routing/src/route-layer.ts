import { Route, RouteResult, RouteLayerConfig } from './types.js';
import { cosineSimilarity, computeCentroid } from './cosine.js';
import { LocalEncoder, Encoder } from './encoder.js';

interface RouteCentroid {
  route: Route;
  centroid: number[];
}

export class RouteLayer {
  private centroids: RouteCentroid[] = [];
  private encoder: Encoder;
  private config: RouteLayerConfig;
  private initialized = false;

  constructor(config: RouteLayerConfig) {
    this.config = config;
    this.encoder = new LocalEncoder();
  }

  /**
   * Pre-compute centroids for all routes.
   * Idempotent — safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.centroids = await Promise.all(
      this.config.routes.map(async (route) => {
        const vectors = await this.encoder.encodeAll(route.utterances);
        const centroid = computeCentroid(vectors);
        return { route, centroid };
      })
    );
    this.initialized = true;
  }

  /**
   * Route a task description to the most appropriate agent slug.
   * Auto-initializes on first call.
   */
  async route(taskDescription: string): Promise<RouteResult> {
    await this.initialize();

    const taskVector = await this.encoder.encode(taskDescription);
    const threshold = this.config.globalThreshold;

    const scores = this.centroids.map(({ route, centroid }) => ({
      routeName: route.name,
      agentSlug: route.agentSlug,
      score: cosineSimilarity(taskVector, centroid),
      threshold: threshold ?? route.threshold,
      fallbackToLLM: route.fallbackToLLM,
    }));

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];

    const method: RouteResult['method'] =
      best.score < best.threshold ? 'llm_fallback' : 'semantic';

    const result: RouteResult = {
      agentSlug: best.agentSlug,
      confidence: Math.max(0, Math.min(1, (best.score + 1) / 2)), // normalize [-1,1] → [0,1]
      method,
      routeName: best.routeName,
    };

    if (this.config.debug) {
      result.allScores = scores.map(s => ({
        routeName: s.routeName,
        agentSlug: s.agentSlug,
        score: s.score,
      }));
    }

    return result;
  }

  /**
   * Register an additional route at runtime without re-initializing all centroids.
   */
  async addRoute(route: Route): Promise<void> {
    const vectors = await this.encoder.encodeAll(route.utterances);
    const centroid = computeCentroid(vectors);
    this.centroids.push({ route, centroid });
    this.config.routes.push(route);
    if (!this.initialized) this.initialized = true;
  }
}
