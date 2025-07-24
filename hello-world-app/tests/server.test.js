const request = require('supertest');
const app = require('../src/server');

describe('Hello World API', () => {
    // Existing tests
    describe('GET /api/hello', () => {
        it('should return hello world message with swarm info', async () => {
            const response = await request(app)
                .get('/api/hello')
                .expect(200);

            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toBe('Hello World from the Claude Flow Swarm!');
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('agents');
            expect(Array.isArray(response.body.agents)).toBe(true);
            expect(response.body.agents.length).toBe(5);
        });

        // New test: Validate timestamp format
        it('should return valid ISO timestamp', async () => {
            const response = await request(app)
                .get('/api/hello')
                .expect(200);

            const timestamp = response.body.timestamp;
            expect(new Date(timestamp).toISOString()).toBe(timestamp);
        });

        // New test: Agent list validation
        it('should return correct agent names', async () => {
            const response = await request(app)
                .get('/api/hello')
                .expect(200);

            const expectedAgents = ['Project Lead', 'System Designer', 'Backend Dev', 'Frontend Dev', 'QA Engineer'];
            expect(response.body.agents).toEqual(expectedAgents);
        });
    });

    describe('GET /api/greeting/:name', () => {
        it('should return personalized greeting', async () => {
            const name = 'Claude';
            const response = await request(app)
                .get(`/api/greeting/${name}`)
                .expect(200);

            expect(response.body).toHaveProperty('message');
            expect(response.body.message).toBe(`Hello ${name}, welcome to the Claude Flow Swarm!`);
            expect(response.body).toHaveProperty('timestamp');
        });

        it('should handle special characters in name', async () => {
            const name = 'Test User 123!';
            const response = await request(app)
                .get(`/api/greeting/${encodeURIComponent(name)}`)
                .expect(200);

            expect(response.body.message).toBe(`Hello ${name}, welcome to the Claude Flow Swarm!`);
        });

        // New test: Empty name handling
        it('should handle empty name parameter', async () => {
            const response = await request(app)
                .get('/api/greeting/')
                .expect(404); // Express will return 404 for empty param
        });

        // New test: Unicode characters
        it('should handle unicode characters in name', async () => {
            const name = '世界🌍';
            const response = await request(app)
                .get(`/api/greeting/${encodeURIComponent(name)}`)
                .expect(200);

            expect(response.body.message).toBe(`Hello ${name}, welcome to the Claude Flow Swarm!`);
        });

        // New test: Very long names
        it('should handle very long names', async () => {
            const name = 'A'.repeat(1000);
            const response = await request(app)
                .get(`/api/greeting/${encodeURIComponent(name)}`)
                .expect(200);

            expect(response.body.message).toBe(`Hello ${name}, welcome to the Claude Flow Swarm!`);
        });
    });

    describe('GET /', () => {
        it('should serve the index.html file', async () => {
            const response = await request(app)
                .get('/')
                .expect(200)
                .expect('Content-Type', /html/);
        });
    });

    // New test suite: Error handling
    describe('Error Handling', () => {
        it('should return 404 for unknown routes', async () => {
            const response = await request(app)
                .get('/api/unknown')
                .expect(404);
        });

        it('should handle malformed URLs gracefully', async () => {
            const response = await request(app)
                .get('/api/greeting/%')
                .expect(400);
        });
    });

    // New test suite: CORS validation
    describe('CORS Configuration', () => {
        it('should include CORS headers', async () => {
            const response = await request(app)
                .get('/api/hello')
                .expect(200);

            expect(response.headers['access-control-allow-origin']).toBeDefined();
        });

        it('should handle preflight requests', async () => {
            const response = await request(app)
                .options('/api/hello')
                .set('Origin', 'http://localhost:3000')
                .set('Access-Control-Request-Method', 'GET')
                .expect(204);
        });
    });

    // New test suite: Content-Type validation
    describe('Content Type', () => {
        it('should return JSON content type for API endpoints', async () => {
            const response = await request(app)
                .get('/api/hello')
                .expect(200)
                .expect('Content-Type', /application\/json/);
        });
    });

    // New test suite: Performance tests
    describe('Performance Tests', () => {
        it('should respond within acceptable time', async () => {
            const start = Date.now();
            await request(app)
                .get('/api/hello')
                .expect(200);
            const duration = Date.now() - start;
            
            expect(duration).toBeLessThan(100); // Should respond within 100ms
        });

        it('should handle concurrent requests', async () => {
            const requests = Array.from({ length: 10 }, () => 
                request(app).get('/api/hello')
            );
            
            const responses = await Promise.all(requests);
            responses.forEach(response => {
                expect(response.status).toBe(200);
            });
        });
    });
});