#!/bin/bash

# Run all Hello World programs
# This script executes hello world in all supported languages

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Base directory
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANGUAGES_DIR="$BASE_DIR/languages"

echo -e "${BLUE}🌍 Running Hello World Collection${NC}"
echo "=================================="

# Track results
SUCCESS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

# Function to run a hello world program
run_hello() {
    local lang=$1
    local cmd=$2
    local dir="$LANGUAGES_DIR/$lang"
    
    if [ ! -d "$dir" ]; then
        echo -e "${YELLOW}⚠️  $lang: Directory not found${NC}"
        return
    fi
    
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    
    echo -e "\n${BLUE}Running $lang...${NC}"
    
    if cd "$dir" && eval "$cmd" 2>/dev/null; then
        echo -e "${GREEN}✅ $lang: Success${NC}"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo -e "${RED}❌ $lang: Failed${NC}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

# Language configurations
declare -A LANGUAGES=(
    ["javascript"]="node hello.js"
    ["python"]="python hello.py"
    ["typescript"]="ts-node hello.ts 2>/dev/null || (tsc hello.ts && node hello.js)"
    ["java"]="javac Hello.java && java Hello"
    ["cpp"]="g++ hello.cpp -o hello && ./hello"
    ["c"]="gcc hello.c -o hello && ./hello"
    ["go"]="go run hello.go"
    ["rust"]="rustc hello.rs && ./hello"
    ["ruby"]="ruby hello.rb"
    ["php"]="php hello.php"
    ["csharp"]="dotnet run 2>/dev/null || (mcs hello.cs && mono hello.exe)"
    ["swift"]="swift hello.swift"
    ["kotlin"]="kotlinc hello.kt -include-runtime -d hello.jar && java -jar hello.jar"
    ["scala"]="scala hello.scala"
    ["perl"]="perl hello.pl"
    ["lua"]="lua hello.lua"
    ["r"]="Rscript hello.R"
    ["julia"]="julia hello.jl"
    ["haskell"]="runhaskell hello.hs"
    ["elixir"]="elixir hello.exs"
    ["clojure"]="clojure hello.clj"
)

# Run all languages
for lang in "${!LANGUAGES[@]}"; do
    run_hello "$lang" "${LANGUAGES[$lang]}"
done

# Summary
echo -e "\n=================================="
echo -e "${BLUE}📊 Summary:${NC}"
echo -e "Total: $TOTAL_COUNT"
echo -e "${GREEN}Success: $SUCCESS_COUNT${NC}"
echo -e "${RED}Failed: $FAIL_COUNT${NC}"

# Exit with error if any failed
if [ $FAIL_COUNT -gt 0 ]; then
    exit 1
fi

echo -e "\n${GREEN}🎉 All programs executed successfully!${NC}"