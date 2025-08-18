#!/bin/bash

# Instalar dependências
npm install

# Executar todos os testes
echo "Running all tests..."
npm test

# Executar testes com coverage
echo "Running tests with coverage..."
npm run test:coverage

# Executar testes específicos
echo "Running popup tests..."
npx jest tests/popup.test.js

echo "Running settings tests..."
npx jest tests/settings.test.js

echo "Running background tests..."
npx jest tests/background.test.js

echo "Running integration tests..."
npx jest tests/integration.test.js