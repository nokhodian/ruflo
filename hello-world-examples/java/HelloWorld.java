/**
 * Hello World in Java - Enterprise-ready Implementation
 * Demonstrates Java best practices and OOP principles
 */
package com.example.hello;

public class HelloWorld {
    private static final String DEFAULT_GREETING = "Hello";
    private static final String DEFAULT_NAME = "World";
    
    private final String greeting;
    
    /**
     * Constructor with custom greeting
     * @param greeting The greeting to use
     */
    public HelloWorld(String greeting) {
        this.greeting = greeting;
    }
    
    /**
     * Default constructor
     */
    public HelloWorld() {
        this(DEFAULT_GREETING);
    }
    
    /**
     * Greet with a specific name
     * @param name The name to greet
     * @return The greeting message
     */
    public String greet(String name) {
        return String.format("%s, %s!", greeting, name);
    }
    
    /**
     * Greet with default name
     * @return The greeting message
     */
    public String greet() {
        return greet(DEFAULT_NAME);
    }
    
    /**
     * Main entry point
     * @param args Command line arguments
     */
    public static void main(String[] args) {
        HelloWorld hw = new HelloWorld();
        System.out.println(hw.greet());
        
        // Custom greeting
        HelloWorld customHw = new HelloWorld("Greetings");
        System.out.println(customHw.greet("Java Developer"));
        
        // Using command line argument if provided
        if (args.length > 0) {
            System.out.println(hw.greet(args[0]));
        }
    }
}