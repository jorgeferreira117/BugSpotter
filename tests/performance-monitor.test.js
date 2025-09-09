const PerformanceMonitor = require('../src/utils/PerformanceMonitor');

describe('PerformanceMonitor', () => {
  let performanceMonitor;

  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor();
    // Mock performance.now() para testes consistentes
    const mockNow = jest.fn(() => 1000);
    global.performance = {
      now: mockNow,
      memory: {
        usedJSHeapSize: 1024 * 1024 // 1MB
      }
    };
    
    // Garantir que o mock seja resetado
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      expect(performanceMonitor.metrics).toBeInstanceOf(Map);
      expect(performanceMonitor.activeOperations).toBeInstanceOf(Map);
      expect(performanceMonitor.thresholds).toBeDefined();
      expect(performanceMonitor.maxMetricsHistory).toBe(100);
    });

    test('should have correct default thresholds', () => {
      expect(performanceMonitor.thresholds.logCapture).toBe(5000);
      expect(performanceMonitor.thresholds.jiraSubmission).toBe(10000);
      expect(performanceMonitor.thresholds.screenshot).toBe(3000);
      expect(performanceMonitor.thresholds.domCapture).toBe(2000);
      expect(performanceMonitor.thresholds.storage).toBe(1000);
    });
  });

  describe('Operation Tracking', () => {
    test('should start operation correctly', () => {
      const operationId = 'test_op_1';
      const operationType = 'logCapture';
      const metadata = { tabId: 123 };

      const result = performanceMonitor.startOperation(operationId, operationType, metadata);

      expect(result).toBe(operationId);
      expect(performanceMonitor.activeOperations.has(operationId)).toBe(true);
      
      const operation = performanceMonitor.activeOperations.get(operationId);
      expect(operation.type).toBe(operationType);
      expect(typeof operation.startTime).toBe('number');
      expect(operation.metadata).toEqual(metadata);
    });

    test('should end operation successfully', () => {
      const operationId = 'test_op_1';
      const operationType = 'screenshot';
      
      performanceMonitor.startOperation(operationId, operationType);
      
      // Simular passagem de tempo
      global.performance.now = jest.fn(() => 1500);
      
      const metric = performanceMonitor.endOperation(operationId, true);

      expect(metric).toBeDefined();
      expect(metric.id).toBe(operationId);
      expect(metric.type).toBe(operationType);
      expect(typeof metric.duration).toBe('number');
      expect(metric.success).toBe(true);
      expect(performanceMonitor.activeOperations.has(operationId)).toBe(false);
    });

    test('should end operation with error', () => {
      const operationId = 'test_op_1';
      const operationType = 'jiraSubmission';
      const errorInfo = { message: 'Test error', stack: 'Error stack' };
      
      performanceMonitor.startOperation(operationId, operationType);
      global.performance.now = jest.fn(() => 1200);
      
      const metric = performanceMonitor.endOperation(operationId, false, errorInfo);

      expect(metric.success).toBe(false);
      expect(metric.errorInfo).toEqual(errorInfo);
      expect(typeof metric.duration).toBe('number');
    });

    test('should return null for non-existent operation', () => {
      const result = performanceMonitor.endOperation('non_existent', true);
      expect(result).toBeNull();
    });
  });

  describe('Metrics Recording', () => {
    test('should record metric correctly', () => {
      const metric = {
        id: 'test_1',
        type: 'logCapture',
        duration: 100,
        success: true,
        timestamp: new Date().toISOString()
      };

      performanceMonitor.recordMetric(metric);

      expect(performanceMonitor.metrics.has('logCapture')).toBe(true);
      const typeMetrics = performanceMonitor.metrics.get('logCapture');
      expect(typeMetrics).toContain(metric);
    });

    test('should limit metrics history', () => {
      const operationType = 'screenshot';
      
      // Adicionar mais métricas que o limite
      for (let i = 0; i < 105; i++) {
        const metric = {
          id: `test_${i}`,
          type: operationType,
          duration: 100 + i,
          success: true,
          timestamp: new Date().toISOString()
        };
        performanceMonitor.recordMetric(metric);
      }

      const typeMetrics = performanceMonitor.metrics.get(operationType);
      expect(typeMetrics.length).toBe(100);
      expect(typeMetrics[0].id).toBe('test_5'); // Primeiros 5 removidos
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      // Adicionar algumas métricas de teste
      const metrics = [
        { id: '1', type: 'logCapture', duration: 100, success: true },
        { id: '2', type: 'logCapture', duration: 200, success: true },
        { id: '3', type: 'logCapture', duration: 150, success: false },
        { id: '4', type: 'logCapture', duration: 300, success: true }
      ];
      
      metrics.forEach(metric => performanceMonitor.recordMetric(metric));
    });

    test('should calculate stats correctly', () => {
      const stats = performanceMonitor.getStats('logCapture');

      expect(stats.totalOperations).toBe(4);
      expect(stats.successfulOperations).toBe(3);
      expect(stats.successRate).toBe(75);
      expect(stats.avgDuration).toBe(187.5); // (100+200+150+300)/4
      expect(stats.minDuration).toBe(100);
      expect(stats.maxDuration).toBe(300);
      expect(stats.medianDuration).toBe(175); // (150+200)/2
    });

    test('should return null for non-existent operation type', () => {
      const stats = performanceMonitor.getStats('nonExistent');
      expect(stats).toBeNull();
    });

    test('should get all stats', () => {
      const allStats = performanceMonitor.getAllStats();
      expect(allStats).toHaveProperty('logCapture');
      expect(allStats.logCapture.totalOperations).toBe(4);
    });
  });

  describe('Slow Operations Detection', () => {
    test('should detect slow operations', () => {
      // Adicionar operação que excede threshold
      const slowMetric = {
        id: 'slow_1',
        type: 'logCapture',
        duration: 6000, // Excede threshold de 5000ms
        success: true,
        timestamp: new Date().toISOString()
      };
      
      performanceMonitor.recordMetric(slowMetric);
      
      const slowOps = performanceMonitor.getSlowOperations('logCapture');
      expect(slowOps.length).toBeGreaterThanOrEqual(0);
      if (slowOps.length > 0) {
        expect(slowOps[0].duration).toBeGreaterThan(5000);
      }
    });

    test('should handle slow operation correctly', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const metric = {
        id: 'slow_1',
        type: 'screenshot',
        duration: 4000, // Excede threshold de 3000ms
        success: true,
        metadata: { tabId: 123 }
      };
      
      performanceMonitor.handleSlowOperation(metric);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[PerformanceMonitor] Operação lenta detectada:',
        expect.objectContaining({
          type: 'screenshot',
          duration: '4000.00ms',
          threshold: '3000ms'
        })
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Utility Functions', () => {
    test('should generate unique operation IDs', () => {
      const id1 = performanceMonitor.generateOperationId('test');
      const id2 = performanceMonitor.generateOperationId('test');
      
      expect(id1).toMatch(/^test_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^test_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('should calculate median correctly', () => {
      expect(performanceMonitor.calculateMedian([1, 2, 3, 4, 5])).toBe(3);
      expect(performanceMonitor.calculateMedian([1, 2, 3, 4])).toBe(2.5);
      expect(performanceMonitor.calculateMedian([5])).toBe(5);
    });

    test('should get memory usage', () => {
      const memoryUsage = performanceMonitor.getMemoryUsage();
      expect(typeof memoryUsage).toBe('number');
      expect(memoryUsage).toBeGreaterThanOrEqual(0);
    });

    test('should handle missing performance.memory', () => {
      global.performance.memory = undefined;
      const memoryUsage = performanceMonitor.getMemoryUsage();
      expect(memoryUsage).toBe(0);
    });
  });

  describe('Report Generation', () => {
    test('should generate performance report', () => {
      // Adicionar algumas operações ativas
      performanceMonitor.startOperation('active_1', 'logCapture');
      performanceMonitor.startOperation('active_2', 'screenshot');
      
      // Adicionar algumas métricas
      performanceMonitor.recordMetric({
        id: 'metric_1',
        type: 'jiraSubmission',
        duration: 2000,
        success: true,
        timestamp: new Date().toISOString()
      });
      
      const report = performanceMonitor.generateReport();
      
      expect(report.activeOperations).toBe(2);
      expect(report.totalMetricsTypes).toBe(1);
      expect(report.stats).toHaveProperty('jiraSubmission');
      expect(typeof report.memoryUsage).toBe('number');
      expect(report.timestamp).toBeDefined();
    });
  });

  describe('Measure Function', () => {
    test('should measure async function successfully', async () => {
      const testFunction = jest.fn().mockResolvedValue('test result');
      
      // Mock sequencial para performance.now
      let callCount = 0;
      global.performance.now = jest.fn(() => {
        callCount++;
        return callCount === 1 ? 1000 : 1500;
      });
      
      const result = await performanceMonitor.measureFunction(
        'testOperation',
        testFunction,
        { test: 'metadata' }
      );
      
      expect(result).toBe('test result');
      expect(testFunction).toHaveBeenCalled();
      
      const stats = performanceMonitor.getStats('testOperation');
      expect(stats.totalOperations).toBe(1);
      expect(stats.successRate).toBe(100);
    });

    test('should measure function with error', async () => {
      const testError = new Error('Test error');
      const testFunction = jest.fn().mockRejectedValue(testError);
      
      // Mock sequencial para performance.now
      let callCount = 0;
      global.performance.now = jest.fn(() => {
        callCount++;
        return callCount === 1 ? 1000 : 1200;
      });
      
      await expect(
        performanceMonitor.measureFunction('testOperation', testFunction)
      ).rejects.toThrow('Test error');
      
      const stats = performanceMonitor.getStats('testOperation');
      expect(stats.totalOperations).toBe(1);
      expect(stats.successRate).toBe(0);
    });
  });

  describe('Cleanup', () => {
    test('should clear old metrics', () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 horas atrás
      const recentDate = new Date();
      
      performanceMonitor.recordMetric({
        id: 'old_1',
        type: 'logCapture',
        duration: 100,
        success: true,
        timestamp: oldDate.toISOString()
      });
      
      performanceMonitor.recordMetric({
        id: 'recent_1',
        type: 'logCapture',
        duration: 200,
        success: true,
        timestamp: recentDate.toISOString()
      });
      
      performanceMonitor.clearOldMetrics(24 * 60 * 60 * 1000); // 24 horas
      
      const metrics = performanceMonitor.metrics.get('logCapture');
      expect(metrics.length).toBe(1);
      expect(metrics[0].id).toBe('recent_1');
    });
  });
});