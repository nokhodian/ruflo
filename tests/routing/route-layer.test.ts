import { RouteLayer } from '../../v3/@claude-flow/routing/src/route-layer.js';
import { coreRoutes } from '../../v3/@claude-flow/routing/src/routes/core.route.js';
import { securityRoutes } from '../../v3/@claude-flow/routing/src/routes/security.route.js';
import { engineeringRoutes } from '../../v3/@claude-flow/routing/src/routes/engineering.route.js';
import { ALL_ROUTES } from '../../v3/@claude-flow/routing/src/routes/index.js';

describe('RouteLayer', () => {
  let layer: RouteLayer;

  beforeEach(() => {
    layer = new RouteLayer({
      routes: [...coreRoutes, ...securityRoutes],
      debug: true,
    });
  });

  describe('route()', () => {
    it('returns a RouteResult with required fields', async () => {
      const result = await layer.route('implement the login endpoint');
      expect(result).toHaveProperty('agentSlug');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('method');
      expect(result).toHaveProperty('routeName');
    });

    it('routes implementation task to coder', async () => {
      const result = await layer.route('implement the password reset functionality');
      expect(result.agentSlug).toBe('coder');
    });

    it('routes security task to security-engineer', async () => {
      const result = await layer.route('audit the JWT token handling for vulnerabilities');
      expect(result.agentSlug).toBe('engineering-security-engineer');
    });

    it('routes review task to reviewer', async () => {
      const result = await layer.route('review this pull request for code quality issues');
      expect(result.agentSlug).toBe('reviewer');
    });

    it('routes testing task to tester', async () => {
      const result = await layer.route('write unit tests for the authentication module');
      expect(result.agentSlug).toBe('tester');
    });

    it('routes research task to researcher', async () => {
      const result = await layer.route('investigate the root cause of the performance regression');
      expect(result.agentSlug).toBe('researcher');
    });

    it('returns all scores when debug=true', async () => {
      const result = await layer.route('write tests for the API');
      expect(result.allScores).toBeDefined();
      expect(result.allScores!.length).toBeGreaterThan(0);
    });

    it('returns confidence in [0, 1]', async () => {
      const result = await layer.route('some random task');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('marks low-confidence results as llm_fallback when threshold is very high', async () => {
      const strictLayer = new RouteLayer({
        routes: coreRoutes.map(r => ({ ...r, threshold: 0.999 })),
      });
      const result = await strictLayer.route('do something vague');
      expect(result.method).toBe('llm_fallback');
    });

    it('returns semantic method for confident matches', async () => {
      const lowThresholdLayer = new RouteLayer({
        routes: coreRoutes.map(r => ({ ...r, threshold: 0.0 })),
      });
      const result = await lowThresholdLayer.route('implement the feature');
      expect(result.method).toBe('semantic');
    });
  });

  describe('addRoute()', () => {
    it('adds a new route and can match it', async () => {
      await layer.addRoute({
        name: 'test-custom',
        agentSlug: 'testing-api-tester',
        threshold: 0.5,
        fallbackToLLM: false,
        utterances: [
          'run API endpoint tests against the staging environment',
          'execute integration tests for the REST API',
          'test the HTTP endpoints for correct status codes',
          'validate API responses match the expected schema',
          'check the REST API returns correct error codes',
        ],
      });
      const result = await layer.route('run API endpoint tests against staging');
      expect(result.agentSlug).toBe('testing-api-tester');
    });
  });

  describe('initialize()', () => {
    it('is idempotent — calling twice does not duplicate centroids', async () => {
      await layer.initialize();
      const countBefore = layer['centroids'].length;
      await layer.initialize();
      expect(layer['centroids'].length).toBe(countBefore);
    });
  });

  describe('ALL_ROUTES coverage', () => {
    it('ALL_ROUTES contains routes from all categories', () => {
      expect(ALL_ROUTES.length).toBeGreaterThan(20);
    });

    it('every route has at least 8 utterances', () => {
      for (const route of ALL_ROUTES) {
        expect(route.utterances.length).toBeGreaterThanOrEqual(8);
      }
    });

    it('every route has a unique name', () => {
      const names = ALL_ROUTES.map(r => r.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it('every route has a non-empty agentSlug', () => {
      for (const route of ALL_ROUTES) {
        expect(route.agentSlug.length).toBeGreaterThan(0);
      }
    });

    it('all thresholds are between 0 and 1', () => {
      for (const route of ALL_ROUTES) {
        expect(route.threshold).toBeGreaterThan(0);
        expect(route.threshold).toBeLessThan(1);
      }
    });
  });

  describe('RouteLayer with all routes', () => {
    let fullLayer: RouteLayer;

    beforeAll(async () => {
      fullLayer = new RouteLayer({ routes: ALL_ROUTES });
      await fullLayer.initialize();
    });

    it('initializes without error with all routes', () => {
      expect(fullLayer['initialized']).toBe(true);
    });

    it('routes security task correctly in full route set', async () => {
      const result = await fullLayer.route('audit the smart contract for reentrancy vulnerabilities');
      expect(['blockchain-security-auditor', 'engineering-security-engineer']).toContain(result.agentSlug);
    });

    it('routes game dev task correctly in full route set', async () => {
      const result = await fullLayer.route('design the core gameplay loop for the action RPG');
      expect(result.agentSlug).toBe('game-designer');
    });

    it('routes UI design task correctly', async () => {
      const result = await fullLayer.route('design the UI for the user profile dashboard');
      expect(['design-ui-designer', 'design-ux-architect']).toContain(result.agentSlug);
    });

    it('completes 50 routings in under 5 seconds', async () => {
      const tasks = Array.from({ length: 50 }, (_, i) => `task description number ${i}`);
      const start = Date.now();
      await Promise.all(tasks.map(t => fullLayer.route(t)));
      expect(Date.now() - start).toBeLessThan(5000);
    });
  });
});
