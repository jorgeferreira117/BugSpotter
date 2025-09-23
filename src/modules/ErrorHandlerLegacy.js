/**
 * Módulo centralizado de tratamento de erros
 */
class ErrorHandler {
  constructor() {
    this.errorQueue = [];
    this.maxQueueSize = 100;
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 segundo
  }

  /**
   * Trata erros de forma centralizada
   */
  handleError(error, context = '', severity = 'medium') {
    const errorInfo = {
      message: error.message || 'Erro desconhecido',
      stack: error.stack,
      context,
      severity,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location?.href || 'background'
    };

    // Log do erro
    console.error(`[${severity.toUpperCase()}] ${context}:`, error);

    // Adicionar à fila de erros
    this.addToErrorQueue(errorInfo);

    // Notificar usuário se for erro crítico
    if (severity === 'critical') {
      this.notifyUser(errorInfo);
    }

    // Salvar erro no storage para análise posterior
    this.saveErrorToStorage(errorInfo);

    return errorInfo;
  }

  /**
   * Adiciona erro à fila
   */
  addToErrorQueue(errorInfo) {
    this.errorQueue.push(errorInfo);
    
    // Manter apenas os últimos erros
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
  }

  /**
   * Executa operação com retry automático
   */
  async executeWithRetry(operation, context = '', maxRetries = this.retryAttempts) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) {
          this.handleError(error, `${context} (falhou após ${maxRetries} tentativas)`, 'high');
          throw error;
        }
        
        // Log da tentativa
        console.warn(`Tentativa ${attempt}/${maxRetries} falhou para ${context}:`, error.message);
        
        // Aguardar antes da próxima tentativa
        await this.delay(this.retryDelay * attempt);
      }
    }
    
    throw lastError;
  }

  /**
   * Wrapper para operações assíncronas com tratamento de erro
   */
  async safeExecute(operation, context = '', defaultValue = null) {
    try {
      return await operation();
    } catch (error) {
      this.handleError(error, context, 'medium');
      return defaultValue;
    }
  }

  /**
   * Wrapper para operações síncronas com tratamento de erro
   */
  safeExecuteSync(operation, context = '', defaultValue = null) {
    try {
      return operation();
    } catch (error) {
      this.handleError(error, context, 'medium');
      return defaultValue;
    }
  }

  /**
   * Valida dados de entrada
   */
  validateInput(data, schema, context = '') {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      
      // Verificar se é obrigatório
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`Campo '${field}' é obrigatório`);
        continue;
      }
      
      // Verificar tipo
      if (value !== undefined && rules.type && typeof value !== rules.type) {
        errors.push(`Campo '${field}' deve ser do tipo ${rules.type}`);
      }
      
      // Verificar tamanho mínimo
      if (value && rules.minLength && value.length < rules.minLength) {
        errors.push(`Campo '${field}' deve ter pelo menos ${rules.minLength} caracteres`);
      }
      
      // Verificar tamanho máximo
      if (value && rules.maxLength && value.length > rules.maxLength) {
        errors.push(`Campo '${field}' deve ter no máximo ${rules.maxLength} caracteres`);
      }
      
      // Verificar padrão regex
      if (value && rules.pattern && !rules.pattern.test(value)) {
        errors.push(`Campo '${field}' não atende ao formato esperado`);
      }
    }
    
    if (errors.length > 0) {
      const error = new Error(`Validação falhou: ${errors.join(', ')}`);
      this.handleError(error, `Validação de entrada - ${context}`, 'medium');
      return { isValid: false, errors };
    }
    
    return { isValid: true, errors: [] };
  }

  /**
   * Notifica o usuário sobre erros críticos
   */
  notifyUser(errorInfo) {
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon48.png'),
        title: 'BugSpotter - Erro Crítico',
        message: `Ocorreu um erro crítico: ${errorInfo.message.substring(0, 100)}...`
      });
    }
  }

  /**
   * Salva erro no storage
   */
  async saveErrorToStorage(errorInfo) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(['error_logs']);
        const errorLogs = result.error_logs || [];
        
        errorLogs.push(errorInfo);
        
        // Manter apenas os últimos 50 erros
        if (errorLogs.length > 50) {
          errorLogs.splice(0, errorLogs.length - 50);
        }
        
        await chrome.storage.local.set({ error_logs: errorLogs });
      }
    } catch (error) {
      console.error('Falha ao salvar erro no storage:', error);
    }
  }

  /**
   * Recupera logs de erro do storage
   */
  async getErrorLogs() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(['error_logs']);
        return result.error_logs || [];
      }
      return [];
    } catch (error) {
      console.error('Falha ao recuperar logs de erro:', error);
      return [];
    }
  }

  /**
   * Limpa logs de erro antigos
   */
  async clearOldErrorLogs(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 dias
    try {
      const errorLogs = await this.getErrorLogs();
      const now = Date.now();
      
      const filteredLogs = errorLogs.filter(log => {
        const logTime = new Date(log.timestamp).getTime();
        return (now - logTime) < maxAge;
      });
      
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ error_logs: filteredLogs });
      }
      
      return filteredLogs.length;
    } catch (error) {
      console.error('Falha ao limpar logs antigos:', error);
      return 0;
    }
  }

  /**
   * Utilitário para delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gera relatório de erros
   */
  async generateErrorReport() {
    const errorLogs = await this.getErrorLogs();
    const now = new Date();
    
    const report = {
      generatedAt: now.toISOString(),
      totalErrors: errorLogs.length,
      errorsBySeverity: {
        critical: errorLogs.filter(e => e.severity === 'critical').length,
        high: errorLogs.filter(e => e.severity === 'high').length,
        medium: errorLogs.filter(e => e.severity === 'medium').length,
        low: errorLogs.filter(e => e.severity === 'low').length
      },
      errorsByContext: {},
      recentErrors: errorLogs.slice(-10)
    };
    
    // Agrupar por contexto
    errorLogs.forEach(error => {
      const context = error.context || 'unknown';
      report.errorsByContext[context] = (report.errorsByContext[context] || 0) + 1;
    });
    
    return report;
  }
}

// Instância global do tratador de erros
const errorHandler = new ErrorHandler();

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorHandler;
}