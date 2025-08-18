// Mock das APIs do Chrome
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  tabs: {
    captureVisibleTab: jest.fn(),
    query: jest.fn()
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  }
};

// Mock do fetch para testes de API
global.fetch = jest.fn();

// Mock do DOM
Object.defineProperty(window, 'location', {
  value: {
    href: 'chrome-extension://test/popup.html'
  }
});

// Mock de console para testes mais limpos
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

// Mock Material Icons
Object.defineProperty(document, 'fonts', {
  value: {
    ready: Promise.resolve()
  }
});