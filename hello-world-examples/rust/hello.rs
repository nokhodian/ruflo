/// Hello World in Rust - Idiomatic Implementation
/// Demonstrates Rust best practices, error handling, and ownership

use std::error::Error;
use std::fmt;
use std::io::{self, Write};

/// Custom error type for greeting operations
#[derive(Debug)]
enum GreetError {
    EmptyName,
    EmptyGreeting,
    IoError(io::Error),
}

impl fmt::Display for GreetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GreetError::EmptyName => write!(f, "Name cannot be empty"),
            GreetError::EmptyGreeting => write!(f, "Greeting cannot be empty"),
            GreetError::IoError(e) => write!(f, "IO error: {}", e),
        }
    }
}

impl Error for GreetError {}

impl From<io::Error> for GreetError {
    fn from(error: io::Error) -> Self {
        GreetError::IoError(error)
    }
}

/// A struct to hold greeting configuration
#[derive(Debug, Clone)]
struct Greeter {
    greeting: String,
}

impl Greeter {
    /// Creates a new Greeter with validation
    fn new(greeting: impl Into<String>) -> Result<Self, GreetError> {
        let greeting = greeting.into();
        if greeting.is_empty() {
            return Err(GreetError::EmptyGreeting);
        }
        Ok(Self { greeting })
    }
    
    /// Creates a greeting message
    fn greet(&self, name: &str) -> Result<String, GreetError> {
        if name.is_empty() {
            return Err(GreetError::EmptyName);
        }
        Ok(format!("{}, {}!", self.greeting, name))
    }
    
    /// Writes greeting to a writer (for testability)
    fn greet_to_writer<W: Write>(
        &self,
        writer: &mut W,
        name: &str,
    ) -> Result<(), GreetError> {
        let message = self.greet(name)?;
        writeln!(writer, "{}", message)?;
        Ok(())
    }
}

impl Default for Greeter {
    fn default() -> Self {
        Self {
            greeting: "Hello".to_string(),
        }
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    // Simple version
    println!("Hello, World!");
    
    // Using the struct
    let greeter = Greeter::default();
    greeter.greet_to_writer(&mut io::stdout(), "World")?;
    
    // Custom greeting with error handling
    let custom_greeter = Greeter::new("Greetings")?;
    custom_greeter.greet_to_writer(&mut io::stdout(), "Rust Developer")?;
    
    // Using iterator and functional style
    let names = vec!["Alice", "Bob", "Charlie"];
    names
        .iter()
        .map(|name| greeter.greet(name))
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .for_each(|msg| println!("{}", msg));
    
    // Demonstrate error handling
    match greeter.greet("") {
        Ok(_) => println!("This shouldn't happen"),
        Err(e) => println!("Expected error: {}", e),
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_greet_success() {
        let greeter = Greeter::default();
        assert_eq!(greeter.greet("Test").unwrap(), "Hello, Test!");
    }
    
    #[test]
    fn test_greet_empty_name() {
        let greeter = Greeter::default();
        assert!(matches!(greeter.greet(""), Err(GreetError::EmptyName)));
    }
}