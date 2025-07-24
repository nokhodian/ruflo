// Hello World in Go - Idiomatic Implementation
// Demonstrates Go best practices and error handling

package main

import (
    "errors"
    "fmt"
    "io"
    "os"
)

// Greeter interface defines greeting behavior
type Greeter interface {
    Greet(name string) (string, error)
}

// SimpleGreeter implements the Greeter interface
type SimpleGreeter struct {
    greeting string
}

// NewGreeter creates a new SimpleGreeter with validation
func NewGreeter(greeting string) (*SimpleGreeter, error) {
    if greeting == "" {
        return nil, errors.New("greeting cannot be empty")
    }
    return &SimpleGreeter{greeting: greeting}, nil
}

// Greet implements the Greeter interface
func (g *SimpleGreeter) Greet(name string) (string, error) {
    if name == "" {
        return "", errors.New("name cannot be empty")
    }
    return fmt.Sprintf("%s, %s!", g.greeting, name), nil
}

// greetToWriter writes greeting to any io.Writer (testable)
func greetToWriter(w io.Writer, greeter Greeter, name string) error {
    message, err := greeter.Greet(name)
    if err != nil {
        return fmt.Errorf("failed to create greeting: %w", err)
    }
    
    _, err = fmt.Fprintln(w, message)
    if err != nil {
        return fmt.Errorf("failed to write greeting: %w", err)
    }
    
    return nil
}

func main() {
    // Simple version
    fmt.Println("Hello, World!")
    
    // Using the struct with error handling
    greeter, err := NewGreeter("Hello")
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error creating greeter: %v\n", err)
        os.Exit(1)
    }
    
    // Greet with error handling
    if err := greetToWriter(os.Stdout, greeter, "World"); err != nil {
        fmt.Fprintf(os.Stderr, "Error: %v\n", err)
        os.Exit(1)
    }
    
    // Custom greeting
    customGreeter, _ := NewGreeter("Greetings")
    if err := greetToWriter(os.Stdout, customGreeter, "Go Developer"); err != nil {
        fmt.Fprintf(os.Stderr, "Error: %v\n", err)
        os.Exit(1)
    }
    
    // Demonstrate error case
    if _, err := greeter.Greet(""); err != nil {
        fmt.Printf("Expected error: %v\n", err)
    }
}