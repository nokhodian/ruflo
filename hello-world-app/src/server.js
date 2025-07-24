const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/api/hello', (req, res) => {
  res.json({ 
    message: 'Hello World from the Claude Flow Swarm!',
    timestamp: new Date().toISOString(),
    agents: ['Project Lead', 'System Designer', 'Backend Dev', 'Frontend Dev', 'QA Engineer']
  });
});

app.get('/api/greeting/:name', (req, res) => {
  const { name } = req.params;
  res.json({ 
    message: `Hello ${name}, welcome to the Claude Flow Swarm!`,
    timestamp: new Date().toISOString()
  });
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Hello World server running on http://localhost:${PORT}`);
  console.log(`🐝 Swarm initialized with 5 agents ready to collaborate!`);
});

module.exports = app;