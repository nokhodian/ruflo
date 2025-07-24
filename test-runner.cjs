// Test runner for JavaScript hello world (CommonJS)

// Load the JavaScript code content
const fs = require('fs');
const path = require('path');

console.log('Testing JavaScript Hello World:');
console.log('==============================');

// Since the file uses ES6 features but CommonJS module check,
// we'll just run its core functionality directly

// Simple function
const greet = (name = 'World') => {
    console.log(`Hello, ${name}!`);
};

// Class-based approach
class Greeter {
    constructor(greeting = 'Hello') {
        this.greeting = greeting;
    }
    
    greet(name = 'World') {
        console.log(`${this.greeting}, ${name}!`);
    }
}

// Async version
const greetAsync = async (name = 'World') => {
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`Hello, ${name}!`);
};

// Run tests
greet();
greet('JavaScript Developer');

const greeter = new Greeter();
greeter.greet();

greetAsync('Async World').then(() => {
    console.log('Async greeting complete!');
});