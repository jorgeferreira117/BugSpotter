/**
 * Módulo de tratamento de erros
 */
class ErrorHandler {
  constructor() {
    this.errorQueue = [];
    this.maxQueueSize = 100;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
  }

  handleError(error, context = '', severity = 'medium') {
    const errorInfo = {
      message: error.message || 'Erro desconhecido',
      stack: error.stack,
      context,
      severity,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: 'background'
    };

    console.error(`[${severity.toUpperCase()}] ${context}:`, error);
    this.addToErrorQueue(errorInfo);

    if (severity === 'critical') {
      this.notifyUser(errorInfo);
    }

    return errorInfo;
  }

  addToErrorQueue(errorInfo) {
    this.errorQueue.push(errorInfo);
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
  }

  async safeExecute(operation, context = '', defaultValue = null) {
    try {
      return await operation();
    } catch (error) {
      this.handleError(error, context);
      return defaultValue;
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

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  validateInput(data, schema, context = '') {
    try {
      const errors = [];
      
      if (!schema || typeof schema !== 'object') {
        return { isValid: true, errors: [] };
      }

      for (const [field, rules] of Object.entries(schema)) {
        const value = data[field];
        
        if (rules.required && (value === undefined || value === null || value === '')) {
          errors.push(`${field} é obrigatório`);
          continue;
        }
        
        if (value !== undefined && value !== null && value !== '') {
          if (rules.type && typeof value !== rules.type) {
            errors.push(`${field} deve ser do tipo ${rules.type}`);
          }
          
          if (rules.minLength && value.length < rules.minLength) {
            errors.push(`${field} deve ter pelo menos ${rules.minLength} caracteres`);
          }
          
          if (rules.maxLength && value.length > rules.maxLength) {
            errors.push(`${field} deve ter no máximo ${rules.maxLength} caracteres`);
          }
          
          if (rules.pattern && !rules.pattern.test(value)) {
            errors.push(`${field} não atende ao formato esperado`);
          }
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    } catch (error) {
      console.error('Erro na validação:', error);
      return { isValid: false, errors: ['Erro interno de validação'] };
    }
  }

  notifyUser(errorInfo) {
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'BugSpotter - Erro Crítico',
        message: `Erro em ${errorInfo.context}: ${errorInfo.message}`
      });
    }
  }
}

// Export para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ErrorHandler;
} else if (typeof window !== 'undefined') {
  window.ErrorHandler = ErrorHandler;
}