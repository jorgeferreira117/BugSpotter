/**
 * Monitor de Performance para BugSpotter
 * Monitora operações críticas e coleta métricas de performance
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.activeOperations = new Map();
    this.thresholds = {
      logCapture: 5000, // 5 segundos
      jiraSubmission: 10000, // 10 segundos
      screenshot: 3000, // 3 segundos
      domCapture: 2000, // 2 segundos
      storage: 1000 // 1 segundo
    };
    this.maxMetricsHistory = 100;
  }

  /**
   * Inicia o monitoramento de uma operação
   */
  startOperation(operationId, operationType, metadata = {}) {
    const startTime = performance.now();
    const memoryBefore = this.getMemoryUsage();
    
    this.activeOperations.set(operationId, {
      type: operationType,
      startTime,
      memoryBefore,
      metadata
    });

    console.debug(`[PerformanceMonitor] Iniciando operação: ${operationType} (${operationId})`);
    return operationId;
  }

  /**
   * Finaliza o monitoramento de uma operação
   */
  endOperation(operationId, success = true, errorInfo = null) {
    const endTime = performance.now();
    const memoryAfter = this.getMemoryUsage();
    
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      console.warn(`[PerformanceMonitor] Operação não encontrada: ${operationId}`);
      return null;
    }

    const duration = endTime - operation.startTime;
    const memoryDelta = memoryAfter - operation.memoryBefore;
    
    const metric = {
      id: operationId,
      type: operation.type,
      duration,
      memoryDelta,
      memoryBefore: operation.memoryBefore,
      memoryAfter,
      success,
      errorInfo,
      timestamp: new Date().toISOString(),
      metadata: operation.metadata
    };

    this.recordMetric(metric);
    this.activeOperations.delete(operationId);

    // Verificar se excedeu threshold
    const threshold = this.thresholds[operation.type];
    if (threshold && duration > threshold) {
      console.warn(`[PerformanceMonitor] Operação ${operation.type} excedeu threshold: ${duration}ms > ${threshold}ms`);
      this.handleSlowOperation(metric);
    }

    console.debug(`[PerformanceMonitor] Operação finalizada: ${operation.type} (${duration.toFixed(2)}ms)`);
    return metric;
  }

  /**
   * Registra uma métrica no histórico
   */
  recordMetric(metric) {
    if (!this.metrics.has(metric.type)) {
      this.metrics.set(metric.type, []);
    }

    const typeMetrics = this.metrics.get(metric.type);
    typeMetrics.push(metric);

    // Manter apenas as últimas N métricas
    if (typeMetrics.length > this.maxMetricsHistory) {
      typeMetrics.shift();
    }
  }

  /**
   * Obtém estatísticas de performance para um tipo de operação
   */
  getStats(operationType) {
    const typeMetrics = this.metrics.get(operationType) || [];
    
    if (typeMetrics.length === 0) {
      return null;
    }

    const durations = typeMetrics.map(m => m.duration);
    const successfulOps = typeMetrics.filter(m => m.success);
    
    return {
      type: operationType,
      totalOperations: typeMetrics.length,
      successfulOperations: successfulOps.length,
      successRate: (successfulOps.length / typeMetrics.length) * 100,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      medianDuration: this.calculateMedian(durations),
      threshold: this.thresholds[operationType] || null,
      slowOperations: typeMetrics.filter(m => {
        const threshold = this.thresholds[operationType];
        return threshold && m.duration > threshold;
      }).length
    };
  }

  /**
   * Obtém todas as estatísticas
   */
  getAllStats() {
    const stats = {};
    for (const operationType of this.metrics.keys()) {
      stats[operationType] = this.getStats(operationType);
    }
    return stats;
  }

  /**
   * Obtém métricas recentes para um tipo de operação
   */
  getRecentMetrics(operationType, limit = 10) {
    const typeMetrics = this.metrics.get(operationType) || [];
    return typeMetrics.slice(-limit);
  }

  /**
   * Identifica operações lentas
   */
  getSlowOperations(operationType = null, thresholdMultiplier = 1.5) {
    const slowOps = [];
    
    const typesToCheck = operationType ? [operationType] : Array.from(this.metrics.keys());
    
    for (const type of typesToCheck) {
      const threshold = this.thresholds[type];
      if (!threshold) continue;
      
      const typeMetrics = this.metrics.get(type) || [];
      const slowTypeOps = typeMetrics.filter(m => 
        m.duration > (threshold * thresholdMultiplier)
      );
      
      slowOps.push(...slowTypeOps);
    }
    
    return slowOps.sort((a, b) => b.duration - a.duration);
  }

  /**
   * Lida com operações que excederam o threshold
   */
  handleSlowOperation(metric) {
    // Registrar no console para debug
    console.warn('[PerformanceMonitor] Operação lenta detectada:', {
      type: metric.type,
      duration: `${metric.duration.toFixed(2)}ms`,
      threshold: `${this.thresholds[metric.type]}ms`,
      metadata: metric.metadata
    });

    // Aqui poderia enviar para analytics ou sistema de monitoramento
    // this.sendToAnalytics(metric);
  }

  /**
   * Obtém uso de memória atual
   */
  getMemoryUsage() {
    if (typeof performance !== 'undefined' && performance.memory) {
      return performance.memory.usedJSHeapSize;
    }
    return 0;
  }

  /**
   * Calcula a mediana de um array de números
   */
  calculateMedian(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
  }

  /**
   * Gera um ID único para operação
   */
  generateOperationId(operationType) {
    return `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Limpa métricas antigas
   */
  clearOldMetrics(maxAge = 24 * 60 * 60 * 1000) { // 24 horas por padrão
    const cutoffTime = new Date(Date.now() - maxAge);
    
    for (const [type, typeMetrics] of this.metrics.entries()) {
      const filteredMetrics = typeMetrics.filter(metric => 
        new Date(metric.timestamp) > cutoffTime
      );
      this.metrics.set(type, filteredMetrics);
    }
  }

  /**
   * Obtém relatório de performance
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      activeOperations: this.activeOperations.size,
      totalMetricsTypes: this.metrics.size,
      stats: this.getAllStats(),
      slowOperations: this.getSlowOperations(),
      memoryUsage: this.getMemoryUsage()
    };

    return report;
  }

  /**
   * Método utilitário para medir uma função
   */
  async measureFunction(operationType, fn, metadata = {}) {
    const operationId = this.generateOperationId(operationType);
    this.startOperation(operationId, operationType, metadata);
    
    try {
      const result = await fn();
      this.endOperation(operationId, true);
      return result;
    } catch (error) {
      this.endOperation(operationId, false, {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Métodos de debug para desenvolvedores
  enableDebugMode() {
    this.debugMode = true;
    console.log('[PerformanceMonitor] Modo debug ativado. Use window.bugSpotterDebug para acessar métricas.');
    
    // Expor métodos de debug no window para desenvolvedores
    if (typeof window !== 'undefined') {
      window.bugSpotterDebug = {
        getStats: (type) => this.getStats(type),
        getAllStats: () => this.getAllStats(),
        getReport: () => this.generateReport(),
        getSlowOps: (type) => this.getSlowOperations(type),
        getRecentMetrics: (type, limit) => this.getRecentMetrics(type, limit),
        clearMetrics: () => {
          this.metrics = [];
          console.log('[PerformanceMonitor] Métricas limpas.');
        },
        help: () => {
          console.log(`
🐛 BugSpotter Debug Console

Comandos disponíveis:
- getStats(type): Estatísticas de um tipo específico
- getAllStats(): Todas as estatísticas
- getReport(): Relatório completo
- getSlowOps(type): Operações lentas
- getRecentMetrics(type, limit): Métricas recentes
- clearMetrics(): Limpar todas as métricas
- help(): Mostrar esta ajuda

Exemplo: bugSpotterDebug.getStats('screenshot')
`);
        }
      };
    }
  }

  disableDebugMode() {
    this.debugMode = false;
    if (typeof window !== 'undefined' && window.bugSpotterDebug) {
      delete window.bugSpotterDebug;
      console.log('[PerformanceMonitor] Modo debug desativado.');
    }
  }
}

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerformanceMonitor;
} else if (typeof window !== 'undefined') {
  window.PerformanceMonitor = PerformanceMonitor;
  
  // Ativar modo debug automaticamente em desenvolvimento
  if (window.location && (window.location.hostname === 'localhost' || window.location.protocol === 'chrome-extension:')) {
    const monitor = new PerformanceMonitor();
    monitor.enableDebugMode();
  }
}