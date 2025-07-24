# Hello World Collection 🌍

A comprehensive collection of "Hello, World!" programs in multiple programming languages, showcasing different programming paradigms and execution methods.

## 🚀 Quick Start

```bash
# Run a specific language
cd languages/javascript && node hello.js
cd languages/python && python hello.py
cd languages/go && go run hello.go

# Run all examples
./scripts/run-all.sh

# Run benchmarks
./scripts/benchmark.sh
```

## 📚 Supported Languages

| Language | Directory | Command | Status |
|----------|-----------|---------|---------|
| JavaScript | `languages/javascript` | `node hello.js` | ✅ |
| Python | `languages/python` | `python hello.py` | ✅ |
| TypeScript | `languages/typescript` | `ts-node hello.ts` | 🚧 |
| Java | `languages/java` | `javac Hello.java && java Hello` | 🚧 |
| C++ | `languages/cpp` | `g++ hello.cpp -o hello && ./hello` | 🚧 |
| Go | `languages/go` | `go run hello.go` | 🚧 |
| Rust | `languages/rust` | `rustc hello.rs && ./hello` | 🚧 |
| Ruby | `languages/ruby` | `ruby hello.rb` | 🚧 |
| PHP | `languages/php` | `php hello.php` | 🚧 |
| C# | `languages/csharp` | `dotnet run` | 🚧 |

## 🗂️ Project Structure

```
hello/
├── languages/           # Language implementations
│   ├── javascript/     # Node.js implementation
│   ├── python/         # Python implementation
│   ├── java/           # Java implementation
│   └── ...            # Other languages
├── shared/             # Shared resources
│   ├── templates/      # README and test templates
│   ├── scripts/        # Common utilities
│   └── configs/        # Shared configurations
├── examples/           # Advanced variations
│   ├── web/           # Web-based examples
│   ├── cli/           # CLI applications
│   ├── gui/           # GUI examples
│   └── api/           # REST API examples
├── scripts/            # Automation scripts
│   ├── run-all.sh     # Execute all programs
│   ├── test-all.sh    # Run all tests
│   └── benchmark.sh   # Performance comparison
├── docs/              # Documentation
└── tests/             # Test suites
```

## 📝 Language README Format

Each language directory contains:
- `hello.[ext]` - The main program
- `README.md` - Language-specific instructions
- `test.[ext]` - Test file (where applicable)
- `Makefile` - Build instructions (where applicable)
- `.gitignore` - Language-specific ignores

### Example README Structure
```markdown
# Hello World in [Language]

## Prerequisites
- [Language] version X.X or higher
- [Any required tools]

## Running
\`\`\`bash
[command to run]
\`\`\`

## Output
\`\`\`
Hello, World!
\`\`\`

## Notes
- [Any language-specific notes]
```

## 🧪 Testing

```bash
# Test all implementations
./scripts/test-all.sh

# Test specific language
cd languages/javascript && npm test
```

## 📊 Performance Benchmarks

Run performance comparisons:
```bash
./scripts/benchmark.sh
```

Results are saved in `benchmarks/results.json`

## 🤝 Contributing

To add a new language:

1. Create directory: `languages/[language-name]/`
2. Add implementation: `hello.[ext]`
3. Add README with execution instructions
4. Update this README's language table
5. Run `./scripts/add-language.sh [language-name]`

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed guidelines.

## 📄 License

MIT License - See LICENSE file for details