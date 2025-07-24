# Hello World App - Claude Flow Swarm Project

## Overview

This is a simple "Hello World" web application created by the Claude Flow Swarm - a coordinated team of AI agents working together. The project demonstrates how multiple specialized agents can collaborate to build a complete full-stack application.

## 🐝 Swarm Contributors

This project was developed by the following AI agents:
- **👨‍💼 Project Lead** - Overall project coordination and management
- **🏗️ System Designer** - Application architecture and design decisions
- **💻 Backend Dev** - Node.js/Express server implementation
- **🎨 Frontend Dev** - HTML/CSS/JavaScript user interface
- **🧪 QA Engineer** - Test suite and quality assurance

## 🚀 Features

- RESTful API with Express.js
- Interactive web interface
- Personalized greeting endpoint
- Comprehensive test suite
- CORS enabled for cross-origin requests
- Static file serving for frontend

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

## 🛠️ Installation

1. Clone the repository or navigate to the project directory:
   ```bash
   cd hello-world-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## 🏃‍♂️ Running the Application

### Development Mode
```bash
npm run dev
```
This will start the server with automatic restart on file changes (using nodemon).

### Production Mode
```bash
npm start
```
This will start the server normally.

The application will be available at `http://localhost:3000`

## 🧪 Running Tests

Execute the test suite:
```bash
npm test
```

## 📡 API Endpoints

### GET /api/hello
Returns a basic hello world message with swarm information.

**Response:**
```json
{
  "message": "Hello World from the Claude Flow Swarm!",
  "timestamp": "2025-07-24T21:28:00.000Z",
  "agents": ["Project Lead", "System Designer", "Backend Dev", "Frontend Dev", "QA Engineer"]
}
```

### GET /api/greeting/:name
Returns a personalized greeting message.

**Parameters:**
- `name` (string): The name to include in the greeting

**Example:** `/api/greeting/Claude`

**Response:**
```json
{
  "message": "Hello Claude, welcome to the Claude Flow Swarm!",
  "timestamp": "2025-07-24T21:28:00.000Z"
}
```

## 📁 Project Structure

```
hello-world-app/
├── node_modules/       # Dependencies
├── public/            # Static frontend files
│   ├── index.html     # Main HTML page
│   ├── styles.css     # Styling
│   └── script.js      # Frontend JavaScript
├── src/               # Server source code
│   └── server.js      # Express server implementation
├── tests/             # Test suite
│   └── server.test.js # API tests
├── package.json       # Project configuration
├── package-lock.json  # Dependency lock file
└── README.md         # This file
```

## 🎨 Frontend Interface

The web interface includes:
- Real-time swarm status display
- List of contributing AI agents
- Interactive greeting form
- API endpoint documentation
- Responsive design with modern styling

## 🔧 Configuration

The server port can be configured using the `PORT` environment variable:
```bash
PORT=8080 npm start
```

Default port is 3000.

## 🤝 Contributing

This project was created as a demonstration of the Claude Flow Swarm capabilities. Feel free to extend it with additional features or use it as a template for your own projects.

## 📜 License

MIT License - See package.json for details

## 🙏 Acknowledgments

Created by the Claude Flow Swarm - demonstrating the power of coordinated AI agent collaboration in software development.

---

**Note:** This project showcases how multiple AI agents can work together to create a complete application, from backend to frontend, including tests and documentation.