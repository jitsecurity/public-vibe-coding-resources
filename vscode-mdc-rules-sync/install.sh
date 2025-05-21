#!/bin/bash

# Install dependencies
echo "Installing dependencies..."
npm install

# Install type declarations
echo "Installing type declarations..."
npm install --save-dev @types/node

# Build the extension
echo "Building extension..."
npm run compile

# Compile tests
echo "Compiling tests..."
npm run compile-tests

# Run tests
echo "Running tests..."
npm run test

# Package the extension
echo "Packaging extension..."
npm run package

echo "Installation complete! You can now run the extension by pressing F5 in VSCode." 