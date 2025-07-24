/**
 * Hello World in C++ - Modern C++17/20 Implementation
 * Demonstrates modern C++ best practices
 */

#include <iostream>
#include <string>
#include <string_view>
#include <optional>
#include <vector>

class Greeter {
private:
    std::string greeting_;
    
public:
    // Constructor with default parameter
    explicit Greeter(std::string_view greeting = "Hello") 
        : greeting_(greeting) {}
    
    // Const method - doesn't modify object state
    [[nodiscard]] std::string greet(std::string_view name = "World") const {
        return greeting_ + ", " + std::string(name) + "!";
    }
    
    // Modern C++ with optional return
    [[nodiscard]] std::optional<std::string> greetMultiple(
        const std::vector<std::string>& names) const {
        if (names.empty()) {
            return std::nullopt;
        }
        
        std::string result;
        for (const auto& name : names) {
            result += greet(name) + "\n";
        }
        return result;
    }
};

// Template function for generic greeting
template<typename T>
void printGreeting(const T& message) {
    std::cout << message << '\n';
}

int main() {
    // Simple version
    std::cout << "Hello, World!\n";
    
    // Using the class
    const Greeter greeter;
    printGreeting(greeter.greet());
    
    // Custom greeting
    const Greeter customGreeter("Greetings");
    printGreeting(customGreeter.greet("C++ Developer"));
    
    // Modern C++ with structured bindings and optional
    const std::vector<std::string> names{"Alice", "Bob", "Charlie"};
    if (auto messages = greeter.greetMultiple(names); messages.has_value()) {
        std::cout << messages.value();
    }
    
    return 0;
}