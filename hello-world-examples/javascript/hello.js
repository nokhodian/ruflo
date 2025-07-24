/**
 * Hello World in JavaScript - Modern ES6+ Implementation
 * Demonstrates various JavaScript patterns
 */

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

// Async version (useful for real applications)
const greetAsync = async (name = 'World') => {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`Hello, ${name}!`);
};

// Module exports (Node.js)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { greet, Greeter, greetAsync };
}

// Example usage
if (require.main === module) {
    greet();
    greet('JavaScript Developer');
    
    const greeter = new Greeter();
    greeter.greet();
    
    greetAsync('Async World').then(() => {
        console.log('Async greeting complete!');
    });
}