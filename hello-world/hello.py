#!/usr/bin/env python3

"""
Hello World in Python

This is a simple hello world program that demonstrates:
- Basic print statements
- Python 3 syntax
- System information display
"""

import sys
import platform
from datetime import datetime

# Simple hello world
print('Hello, World!')

# Enhanced version with formatting
print('\n🐍 Hello from Python!')
print('=' * 30)
print(f'Time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
print(f'Python version: {sys.version.split()[0]}')
print(f'Platform: {platform.system()}')
print('=' * 30)