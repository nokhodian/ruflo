# Hello World Project Structure

## Directory Layout

```
hello/
├── README.md                 # Main project documentation
├── STRUCTURE.md             # This file - project structure documentation
├── package.json             # Node.js project configuration
├── languages/               # Language-specific implementations
│   ├── cpp/
│   │   ├── hello.cpp       # C++ source code
│   │   ├── hello           # Compiled binary
│   │   └── Makefile        # Build configuration
│   ├── csharp/
│   │   ├── Hello.cs        # C# source code (TO BE CREATED)
│   │   └── Hello.csproj    # C# project file (TO BE CREATED)
│   ├── go/
│   │   ├── hello.go        # Go source code
│   │   └── go.mod          # Go module file (TO BE CREATED)
│   ├── java/
│   │   ├── Hello.java      # Java source code
│   │   └── Hello.class     # Compiled bytecode (TO BE CREATED)
│   ├── javascript/
│   │   └── hello.js        # JavaScript/Node.js code
│   ├── php/
│   │   └── hello.php       # PHP source code (TO BE CREATED)
│   ├── python/
│   │   └── hello.py        # Python source code
│   ├── ruby/
│   │   └── hello.rb        # Ruby source code (TO BE CREATED)
│   ├── rust/
│   │   ├── hello.rs        # Rust source code
│   │   └── Cargo.toml      # Rust project file (TO BE CREATED)
│   └── typescript/
│       ├── hello.ts        # TypeScript source code (TO BE CREATED)
│       └── tsconfig.json   # TypeScript configuration (TO BE CREATED)
├── benchmarks/              # Performance testing
│   ├── run-benchmarks.sh    # Benchmark runner script
│   └── results/            # Benchmark results storage
├── build/                   # Build artifacts
│   └── .gitkeep            # Keep directory in git
├── configs/                 # Configuration files
│   └── languages.json      # Language configuration metadata
├── containers/              # Docker/container files
│   ├── Dockerfile.multi    # Multi-language container
│   └── docker-compose.yml  # Container orchestration
├── docs/                    # Documentation
│   ├── api/                # API documentation
│   ├── examples/           # Usage examples
│   └── guides/             # Implementation guides
├── examples/                # Extended examples
│   └── advanced/           # Advanced usage patterns
├── scripts/                 # Utility scripts
│   ├── run-all.sh          # Run all implementations
│   ├── build-all.sh        # Build all compiled languages (TO BE CREATED)
│   └── test-all.sh         # Test all implementations (TO BE CREATED)
├── shared/                  # Shared resources
│   ├── configs/            # Shared configurations
│   ├── scripts/            # Shared scripts
│   ├── templates/          # Templates
│   │   └── LANGUAGE_README_TEMPLATE.md
│   └── utilities/          # Utility functions
├── src/                     # Source for tooling/utilities
│   └── .gitkeep
├── tests/                   # Test suites
│   ├── e2e/                # End-to-end tests
│   ├── integration/        # Integration tests
│   └── unit/               # Unit tests
├── tools/                   # Development tools
│   └── .gitkeep
└── web/                     # Web interface
    └── index.html          # Web UI for running examples (TO BE CREATED)
```

## Naming Conventions

### Source Files
- **Pattern**: `hello.<extension>` (lowercase)
- **Exception**: Java uses `Hello.java` (PascalCase per Java convention)
- **Exception**: C# uses `Hello.cs` (PascalCase per C# convention)

### Compiled Outputs
- **C++**: `hello` (no extension, executable)
- **Java**: `Hello.class` (bytecode)
- **Rust**: `hello` (no extension, executable)
- **C#**: `Hello.exe` or `Hello.dll` (depending on target)
- **Go**: `hello` (no extension, executable)

### Project Files
- **Rust**: `Cargo.toml`
- **C#**: `Hello.csproj`
- **Go**: `go.mod`
- **TypeScript**: `tsconfig.json`
- **Node.js**: `package.json` (in language directory if needed)

## File Organization Principles

1. **Language Isolation**: Each language has its own directory
2. **Self-Contained**: Each language directory contains all files needed to run
3. **Consistent Structure**: Similar file layout across languages
4. **Build Artifacts**: Compiled outputs stay in language directories
5. **Shared Resources**: Common utilities in `/shared`
6. **Documentation**: Language-specific docs in language directories
7. **Tests**: Language-specific tests within each language directory

## Missing Implementations

The following need to be created:
- C# implementation (`csharp/Hello.cs`)
- PHP implementation (`php/hello.php`)
- Ruby implementation (`ruby/hello.rb`)
- TypeScript implementation (`typescript/hello.ts`)
- Various project/build files as noted above

## Build and Run Strategy

Each language directory should be independently executable:
- Interpreted languages: Direct execution
- Compiled languages: Build step + execution
- Container support: Each can run in isolation
- Unified runner: `scripts/run-all.sh` executes all