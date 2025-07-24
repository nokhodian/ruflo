# Language-Specific Hello World Patterns

## Python Implementation

### Basic Structure
```python
#!/usr/bin/env python3
"""Hello World program in Python."""

def main():
    """Main function."""
    print("Hello, World!")

if __name__ == "__main__":
    main()
```

### Project Structure
```
python-hello-world/
├── src/
│   └── hello.py
├── tests/
│   └── test_hello.py
├── requirements.txt
├── setup.py
├── README.md
└── .gitignore
```

### Testing Example
```python
# tests/test_hello.py
import unittest
from io import StringIO
from contextlib import redirect_stdout
from src.hello import main

class TestHello(unittest.TestCase):
    def test_hello_world_output(self):
        with StringIO() as buf, redirect_stdout(buf):
            main()
            self.assertEqual(buf.getvalue().strip(), "Hello, World!")
```

## JavaScript/Node.js Implementation

### Basic Structure
```javascript
// src/hello.js
'use strict';

/**
 * Prints Hello World message
 */
function sayHello() {
  console.log('Hello, World!');
}

// Export for testing
module.exports = { sayHello };

// Run if called directly
if (require.main === module) {
  sayHello();
}
```

### Project Structure
```
js-hello-world/
├── src/
│   └── hello.js
├── test/
│   └── hello.test.js
├── package.json
├── package-lock.json
├── .eslintrc.json
├── README.md
└── .gitignore
```

### Testing Example
```javascript
// test/hello.test.js
const { sayHello } = require('../src/hello');

describe('Hello World', () => {
  it('should print Hello, World!', () => {
    const consoleSpy = jest.spyOn(console, 'log');
    sayHello();
    expect(consoleSpy).toHaveBeenCalledWith('Hello, World!');
    consoleSpy.mockRestore();
  });
});
```

## Go Implementation

### Basic Structure
```go
// cmd/hello/main.go
package main

import (
    "fmt"
    "github.com/username/hello-world/internal/greeting"
)

func main() {
    fmt.Println(greeting.GetMessage())
}
```

```go
// internal/greeting/greeting.go
package greeting

// GetMessage returns the hello world message
func GetMessage() string {
    return "Hello, World!"
}
```

### Project Structure
```
go-hello-world/
├── cmd/
│   └── hello/
│       └── main.go
├── internal/
│   └── greeting/
│       ├── greeting.go
│       └── greeting_test.go
├── go.mod
├── go.sum
├── Makefile
├── README.md
└── .gitignore
```

### Testing Example
```go
// internal/greeting/greeting_test.go
package greeting

import "testing"

func TestGetMessage(t *testing.T) {
    expected := "Hello, World!"
    actual := GetMessage()
    
    if actual != expected {
        t.Errorf("GetMessage() = %q, want %q", actual, expected)
    }
}
```

## Rust Implementation

### Basic Structure
```rust
// src/main.rs
//! Hello World program in Rust

/// Entry point of the application
fn main() {
    println!("{}", get_greeting());
}

/// Returns the greeting message
fn get_greeting() -> &'static str {
    "Hello, World!"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_greeting() {
        assert_eq!(get_greeting(), "Hello, World!");
    }
}
```

### Project Structure
```
rust-hello-world/
├── src/
│   ├── main.rs
│   └── lib.rs
├── tests/
│   └── integration_test.rs
├── Cargo.toml
├── Cargo.lock
├── README.md
└── .gitignore
```

### Cargo.toml Example
```toml
[package]
name = "hello-world"
version = "0.1.0"
edition = "2021"
authors = ["Your Name <you@example.com>"]
description = "A simple Hello World program"
license = "MIT"

[dependencies]

[dev-dependencies]
assert_cmd = "2.0"
```

## Java Implementation

### Basic Structure
```java
// src/main/java/com/example/HelloWorld.java
package com.example;

/**
 * Hello World application
 */
public class HelloWorld {
    
    /**
     * Returns the greeting message
     * @return String containing the greeting
     */
    public String getGreeting() {
        return "Hello, World!";
    }
    
    /**
     * Main entry point
     * @param args Command line arguments
     */
    public static void main(String[] args) {
        HelloWorld app = new HelloWorld();
        System.out.println(app.getGreeting());
    }
}
```

### Project Structure (Maven)
```
java-hello-world/
├── src/
│   ├── main/
│   │   └── java/
│   │       └── com/
│   │           └── example/
│   │               └── HelloWorld.java
│   └── test/
│       └── java/
│           └── com/
│               └── example/
│                   └── HelloWorldTest.java
├── pom.xml
├── README.md
└── .gitignore
```

### Testing Example
```java
// src/test/java/com/example/HelloWorldTest.java
package com.example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class HelloWorldTest {
    
    @Test
    public void testGetGreeting() {
        HelloWorld app = new HelloWorld();
        assertEquals("Hello, World!", app.getGreeting());
    }
}
```

## Common Patterns Across Languages

### 1. Entry Point Patterns
- **Script Languages** (Python, JavaScript): Check if file is run directly
- **Compiled Languages** (Go, Rust, Java): Dedicated main function/method

### 2. Module/Package Organization
- Separate concerns: main entry vs. business logic
- Testable functions/methods separate from I/O operations

### 3. Testing Patterns
- Unit tests in separate directory
- Mock/capture console output for testing
- Test function naming conventions

### 4. Documentation Patterns
- File-level documentation
- Function/method documentation
- Inline comments for complex logic

### 5. Build/Package Management
- **Python**: pip/setuptools
- **JavaScript**: npm/yarn
- **Go**: go modules
- **Rust**: Cargo
- **Java**: Maven/Gradle

## Best Practices Summary

1. **Separation of Concerns**: Keep I/O separate from logic
2. **Testability**: Design with testing in mind
3. **Documentation**: Document at multiple levels
4. **Consistency**: Follow language idioms
5. **Tooling**: Use language-specific tools (linters, formatters)
6. **Version Control**: Include appropriate ignore patterns
7. **CI/CD Ready**: Structure supports automation