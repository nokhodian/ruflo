# Hello World in C#

## Overview
A simple "Hello, World!" program demonstrating the basic syntax of C#.

## Prerequisites
- .NET SDK 6.0 or higher
- dotnet CLI tool

## Installation
```bash
# Install .NET SDK if not already installed
# On Ubuntu/Debian:
wget https://dot.net/v1/dotnet-install.sh
chmod +x dotnet-install.sh
./dotnet-install.sh

# Verify installation
dotnet --version
```

## Running the Program

### Direct Execution
```bash
dotnet run
```

### With Build Step
```bash
# Build
dotnet build

# Execute
dotnet run --no-build
# Or directly:
./bin/Debug/net6.0/Hello
```

## Expected Output
```
Hello, World!
```

## Code Explanation
```csharp
using System;

namespace HelloWorld
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Hello, World!");
        }
    }
}
```

Key points:
- `using System;` imports the System namespace for Console access
- `namespace HelloWorld` organizes code in a namespace
- `static void Main` is the program entry point
- `Console.WriteLine()` prints text to the console

## Testing
```bash
dotnet test
```

## Language Features Demonstrated
- ✅ Basic output/print statement
- ✅ Program entry point
- ✅ Namespace organization
- ✅ Static method declaration

## Variations

### With User Input
```csharp
using System;

class Program
{
    static void Main()
    {
        Console.Write("Enter your name: ");
        string name = Console.ReadLine();
        Console.WriteLine($"Hello, {name}!");
    }
}
```

### With Method
```csharp
using System;

class Program
{
    static void Main()
    {
        PrintGreeting("World");
    }
    
    static void PrintGreeting(string name)
    {
        Console.WriteLine($"Hello, {name}!");
    }
}
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| 'dotnet' command not found | Add .NET to PATH or reinstall |
| Build errors | Check .NET SDK version with `dotnet --version` |

## Resources
- [Official Documentation](https://docs.microsoft.com/en-us/dotnet/csharp/)
- [C# Tutorial](https://docs.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/)
- [.NET Community](https://dotnet.microsoft.com/platform/community)

## Performance
- Execution time: ~50ms
- Memory usage: ~20MB

## Notes
- C# is a modern, object-oriented language
- Runs on the .NET runtime
- Cross-platform support via .NET Core/5+