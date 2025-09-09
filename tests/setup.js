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

// Mock do crypto para testes de segurança
const cryptoMock = {
  subtle: {
    generateKey: jest.fn(),
    importKey: jest.fn(),
    exportKey: jest.fn(),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    deriveBits: jest.fn(),
    deriveKey: jest.fn(),
    sign: jest.fn(),
    verify: jest.fn(),
    digest: jest.fn()
  },
  getRandomValues: jest.fn((array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  })
};

// Definir crypto tanto para global quanto para window
global.crypto = cryptoMock;
if (typeof window !== 'undefined') {
  window.crypto = cryptoMock;
}

// Para ambientes jsdom, definir window.crypto
Object.defineProperty(global, 'window', {
  value: {
    ...global.window,
    crypto: cryptoMock
  },
  writable: true
});