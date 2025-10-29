/**
 * Utilitários de validação unificados para o BugSpotter
 * Consolida toda a lógica de validação em um local centralizado
 */

class ValidationUtils {
  /**
   * Valida dados de entrada baseado em um schema
   * @param {Object} data - Dados a serem validados
   * @param {Object} schema - Schema de validação
   * @param {string} context - Contexto da validação (opcional)
   * @returns {Object} { isValid: boolean, errors: Array }
   */
  static validateInput(data, schema, context = '') {
    const errors = [];
    
    if (!data || typeof data !== 'object') {
      return {
        isValid: false,
        errors: [{ field: 'root', message: 'Invalid data provided' }]
      };
    }

    // Validar cada campo do schema
    for (const [fieldName, rules] of Object.entries(schema)) {
      const value = data[fieldName];
      const fieldErrors = this._validateField(fieldName, value, rules, context);
      errors.push(...fieldErrors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida um campo específico
   * @private
   */
  static _validateField(fieldName, value, rules, context) {
    const errors = [];
    const fieldContext = context ? `${context}.${fieldName}` : fieldName;

    // Verificar se é obrigatório
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('REQUIRED', fieldName),
        context: fieldContext
      });
      return errors; // Se obrigatório e vazio, não validar outras regras
    }

    // Se não é obrigatório e está vazio, pular outras validações
    if (!rules.required && (value === undefined || value === null || value === '')) {
      return errors;
    }

    // Validar tipo
    if (rules.type && !this._validateType(value, rules.type)) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('INVALID_TYPE', fieldName, rules.type),
        context: fieldContext
      });
    }

    // Validar comprimento mínimo
    if (rules.minLength && value.length < rules.minLength) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('MIN_LENGTH', fieldName, rules.minLength),
        context: fieldContext
      });
    }

    // Validar comprimento máximo
    if (rules.maxLength && value.length > rules.maxLength) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('MAX_LENGTH', fieldName, rules.maxLength),
        context: fieldContext
      });
    }

    // Validar valor mínimo (para números)
    if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('MIN_VALUE', fieldName, rules.min),
        context: fieldContext
      });
    }

    // Validar valor máximo (para números)
    if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('MAX_VALUE', fieldName, rules.max),
        context: fieldContext
      });
    }

    // Validar padrão regex
    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('INVALID_FORMAT', fieldName),
        context: fieldContext
      });
    }

    // Validar valores permitidos
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push({
        field: fieldName,
        message: this._getErrorMessage('INVALID_ENUM', fieldName, rules.enum.join(', ')),
        context: fieldContext
      });
    }

    return errors;
  }

  /**
   * Valida o tipo de um valor
   * @private
   */
  static _validateType(value, expectedType) {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'email':
        return typeof value === 'string' && this._isValidEmail(value);
      case 'url':
        return typeof value === 'string' && this._isValidUrl(value);
      default:
        return true;
    }
  }

  /**
   * Valida se é um email válido
   * @private
   */
  static _isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Valida se é uma URL válida
   * @private
   */
  static _isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Obtém mensagem de erro padronizada
   * @private
   */
  static _getErrorMessage(type, field, param) {
    const messages = {
      REQUIRED: `${field} é obrigatório`,
      INVALID_TYPE: `${field} deve ser do tipo ${param}`,
      MIN_LENGTH: `${field} deve ter pelo menos ${param} caracteres`,
      MAX_LENGTH: `${field} deve ter no máximo ${param} caracteres`,
      MIN_VALUE: `${field} deve ser pelo menos ${param}`,
      MAX_VALUE: `${field} deve ser no máximo ${param}`,
      INVALID_FORMAT: `${field} não atende ao formato esperado`,
      INVALID_ENUM: `${field} deve ser um dos seguintes valores: ${param}`
    };

    return messages[type] || `Validation error in ${field}`;
  }

  /**
   * Cria um schema de validação para formulários comuns
   * @param {string} type - Tipo do schema (bug-report, settings, etc.)
   * @returns {Object} Schema de validação
   */
  static createValidationSchema(type) {
    const schemas = {
      'bug-report': {
        title: { 
          required: true, 
          type: 'string', 
          minLength: 5, 
          maxLength: 200 
        },
        description: { 
          required: true, 
          type: 'string', 
          minLength: 10, 
          maxLength: 2000 
        },
        priority: { 
          required: false, 
          type: 'string', 
          enum: ['low', 'medium', 'high', 'critical'] 
        },
        tags: { 
          required: false, 
          type: 'array' 
        }
      },
      'jira-settings': {
        jiraUrl: { 
          required: true, 
          type: 'url' 
        },
        username: { 
          required: true, 
          type: 'string', 
          minLength: 2 
        },
        apiToken: { 
          required: true, 
          type: 'string', 
          minLength: 10 
        },
        projectKey: { 
          required: true, 
          type: 'string', 
          minLength: 2, 
          maxLength: 10 
        }
      },
      'capture-settings': {
        screenshotFormat: { 
          required: true, 
          type: 'string', 
          enum: ['png', 'jpeg'] 
        },
        maxVideoLength: { 
          required: true, 
          type: 'number', 
          min: 10, 
          max: 300 
        },
        captureConsole: { 
          required: false, 
          type: 'boolean' 
        },
        captureNetwork: { 
          required: false, 
          type: 'boolean' 
        }
      },
      'ai-settings': {
        provider: { 
          required: true, 
          type: 'string', 
          enum: ['openai', 'anthropic', 'google'] 
        },
        apiKey: { 
          required: true, 
          type: 'string', 
          minLength: 20 
        },
        model: { 
          required: false, 
          type: 'string' 
        },
        maxTokens: { 
          required: false, 
          type: 'number', 
          min: 100, 
          max: 4000 
        }
      }
    };

    return schemas[type] || {};
  }

  /**
   * Formata erros de validação para exibição
   * @param {Array} errors - Array de erros
   * @param {string} format - Formato de saída ('list', 'object', 'string')
   * @returns {string|Object|Array} Erros formatados
   */
  static formatValidationErrors(errors, format = 'list') {
    if (!errors || errors.length === 0) {
      return format === 'string' ? '' : [];
    }

    switch (format) {
      case 'string':
        return errors.map(error => error.message).join('; ');
      
      case 'object':
        const errorObj = {};
        errors.forEach(error => {
          if (!errorObj[error.field]) {
            errorObj[error.field] = [];
          }
          errorObj[error.field].push(error.message);
        });
        return errorObj;
      
      case 'list':
      default:
        return errors.map(error => ({
          field: error.field,
          message: error.message,
          context: error.context
        }));
    }
  }

  /**
   * Valida dados de forma assíncrona (para validações que requerem API calls)
   * @param {Object} data - Dados a serem validados
   * @param {Object} schema - Schema de validação
   * @param {Object} asyncValidators - Validadores assíncronos opcionais
   * @returns {Promise<Object>} Resultado da validação
   */
  static async validateInputAsync(data, schema, asyncValidators = {}) {
    // Validação síncrona primeiro
    const syncResult = this.validateInput(data, schema);
    
    if (!syncResult.isValid) {
      return syncResult;
    }

    // Validações assíncronas
    const asyncErrors = [];
    
    for (const [field, validator] of Object.entries(asyncValidators)) {
      if (data[field] !== undefined) {
        try {
          const isValid = await validator(data[field]);
          if (!isValid) {
            asyncErrors.push({
              field,
              message: `${field} failed asynchronous validation`,
              context: field
            });
          }
        } catch (error) {
          asyncErrors.push({
            field,
            message: `Validation error for ${field}: ${error.message}`,
            context: field
          });
        }
      }
    }

    return {
      isValid: asyncErrors.length === 0,
      errors: [...syncResult.errors, ...asyncErrors]
    };
  }
}

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ValidationUtils;
} else if (typeof window !== 'undefined') {
  window.ValidationUtils = ValidationUtils;
}