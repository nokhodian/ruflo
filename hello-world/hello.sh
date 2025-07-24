#!/bin/bash

# Hello World in Bash
# 
# This is a simple hello world script that demonstrates:
# - Basic echo commands
# - Bash scripting
# - System information display

# Simple hello world
echo "Hello, World!"

# Enhanced version with formatting
echo
echo "🐚 Hello from Bash!"
echo "=============================="
echo "Time: $(date)"
echo "Shell: $SHELL"
echo "Bash version: ${BASH_VERSION}"
echo "OS: $(uname -s)"
echo "=============================="