/**
 * @jest-environment jsdom
 */

// Mock das APIs do Chrome antes de importar
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
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  }
};

// Mock do fetch
global.fetch = jest.fn();

// Mock do console
const originalConsole = global.console;
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

// Importar a classe ErrorHandler do arquivo real
const ErrorHandler = require('../error-handler.js');

// Definir globalmente para os testes
global.ErrorHandler = ErrorHandler;

describe('ErrorHandler', () => {
  let errorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.console = originalConsole;
  });

  describe('handleError', () => {
    it('should handle error with context', () => {
      const error = new Error('Test error');
      const context = 'test-context';
      
      errorHandler.handleError(error, context);
      
      expect(console.error).toHaveBeenCalledWith(
        `[MEDIUM] ${context}:`,
        error
      );
    });

    it('should handle error without context', () => {
      const error = new Error('Test error');
      
      errorHandler.handleError(error);
      
      expect(console.error).toHaveBeenCalledWith(
        '[MEDIUM] :',
        error
      );
    });

    it('should handle string errors', () => {
      const errorMessage = 'String error message';
      
      errorHandler.handleError(errorMessage, 'test');
      
      expect(console.error).toHaveBeenCalledWith(
        '[MEDIUM] test:',
        errorMessage
      );
    });
  });

  describe('safeExecute', () => {
    it('should execute function successfully', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await errorHandler.safeExecute(mockFn, 'test-context');
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should handle async function errors', async () => {
      const error = new Error('Async function failed');
      const mockFn = jest.fn().mockRejectedValue(error);
      
      const result = await errorHandler.safeExecute(mockFn, 'test-context');
      
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[MEDIUM] test-context:',
        error
      );
    });

    it('should handle synchronous function errors', () => {
      const error = new Error('Sync function failed');
      const mockFn = jest.fn().mockImplementation(() => {
        throw error;
      });
      
      const result = errorHandler.safeExecuteSync(mockFn, 'test-context');
      
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[MEDIUM] test-context:',
        error
      );
    });
  });

  describe('validateInput', () => {
    it('should return valid result for valid input', () => {
      const schema = { field: { required: true, type: 'string' } };
      const data = { field: 'valid input' };
      const result = errorHandler.validateInput(data, schema);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle null input gracefully', () => {
      const schema = { field: { required: true, type: 'string' } };
      const result = errorHandler.validateInput({}, schema);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Campo 'field' é obrigatório");
    });

    it('should handle empty object input', () => {
      const schema = { field: { required: false, type: 'string' } };
      const result = errorHandler.validateInput({}, schema);
      expect(result.isValid).toBe(true);
    });

    it('should validate string type correctly', () => {
      const schema = { field: { type: 'string' } };
      expect(errorHandler.validateInput({ field: 'test' }, schema).isValid).toBe(true);
      expect(errorHandler.validateInput({ field: 123 }, schema).isValid).toBe(false);
    });

    it('should validate number type correctly', () => {
      const schema = { field: { type: 'number' } };
      expect(errorHandler.validateInput({ field: 123 }, schema).isValid).toBe(true);
      expect(errorHandler.validateInput({ field: 'test' }, schema).isValid).toBe(false);
    });

    it('should validate boolean type correctly', () => {
      const schema = { field: { type: 'boolean' } };
      expect(errorHandler.validateInput({ field: true }, schema).isValid).toBe(true);
      expect(errorHandler.validateInput({ field: 'test' }, schema).isValid).toBe(false);
    });

    it('should validate object type correctly', () => {
      const schema = { field: { type: 'object' } };
      expect(errorHandler.validateInput({ field: {} }, schema).isValid).toBe(true);
      expect(errorHandler.validateInput({ field: 'test' }, schema).isValid).toBe(false);
    });
  });

  describe('executeWithRetry', () => {
    it('should execute function successfully on first try', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await errorHandler.executeWithRetry(mockFn, 3, 100);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockFn = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success');
      
      const result = await errorHandler.executeWithRetry(mockFn, 3, 10);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      const error = new Error('Persistent failure');
      const mockFn = jest.fn().mockRejectedValue(error);
      
      await expect(errorHandler.executeWithRetry(mockFn, 'test context', 2))
        .rejects.toThrow('Persistent failure');
      
      expect(mockFn).toHaveBeenCalledTimes(2); // maxRetries = 2
    }, 5000);

    it('should use default parameters', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await errorHandler.executeWithRetry(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('delay', () => {
    it('should resolve after specified time', async () => {
      const start = Date.now();
      await errorHandler.delay(50);
      const end = Date.now();
      
      expect(end - start).toBeGreaterThanOrEqual(45); // Allow some tolerance
    });
  });
});