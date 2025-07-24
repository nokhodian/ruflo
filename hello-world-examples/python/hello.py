#!/usr/bin/env python3
"""
Hello World in Python - Idiomatic Implementation
Demonstrates best practices for Python scripts
"""

def greet(name="World"):
    """
    Print a greeting message.
    
    Args:
        name (str): Name to greet (default: "World")
    """
    print(f"Hello, {name}!")

def main():
    """Main entry point for the script."""
    # Simple greeting
    greet()
    
    # Personalized greeting
    greet("Python Developer")

if __name__ == "__main__":
    main()