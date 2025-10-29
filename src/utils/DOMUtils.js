/**
 * Utilitários de manipulação do DOM unificados para o BugSpotter
 * Consolida toda a lógica de manipulação de elementos, eventos e UI
 */

class DOMUtils {
  /**
   * Vincula eventos de formulário de forma padronizada
   * @param {string} formId - ID do formulário
   * @param {Object} handlers - Objeto com handlers de eventos
   * @param {Object} options - Opções adicionais
   */
  static bindFormEvents(formId, handlers = {}, options = {}) {
    const form = document.getElementById(formId);
    if (!form) {
      console.warn(`Formulário com ID '${formId}' não encontrado`);
      return;
    }

    const {
      onSubmit,
      onChange,
      onInput,
      onReset,
      onFocus,
      onBlur
    } = handlers;

    const {
      preventDefault = true,
      autoSave = false,
      autoSaveDelay = 1000,
      validateOnChange = false
    } = options;

    // Handler de submit
    if (onSubmit) {
      form.addEventListener('submit', (e) => {
        if (preventDefault) {
          e.preventDefault();
        }
        onSubmit(e, this.getFormData(form));
      });
    }

    // Handler de reset
    if (onReset) {
      form.addEventListener('reset', (e) => {
        onReset(e);
      });
    }

    // Handlers para campos individuais
    const inputs = form.querySelectorAll('input, select, textarea');
    
    inputs.forEach(input => {
      // Change events
      if (onChange) {
        input.addEventListener('change', (e) => {
          onChange(e, e.target.name, e.target.value, this.getFormData(form));
          
          if (validateOnChange && options.validator) {
            this.validateField(input, options.validator);
          }
        });
      }

      // Input events (para auto-save)
      if (onInput || autoSave) {
        const inputHandler = (e) => {
          if (onInput) {
            onInput(e, e.target.name, e.target.value, this.getFormData(form));
          }
        };

        if (autoSave) {
          const debouncedHandler = this._debounce(inputHandler, autoSaveDelay);
          input.addEventListener('input', debouncedHandler);
        } else {
          input.addEventListener('input', inputHandler);
        }
      }

      // Focus events
      if (onFocus) {
        input.addEventListener('focus', (e) => {
          onFocus(e, e.target.name);
        });
      }

      // Blur events
      if (onBlur) {
        input.addEventListener('blur', (e) => {
          onBlur(e, e.target.name, e.target.value);
          
          if (validateOnChange && options.validator) {
            this.validateField(input, options.validator);
          }
        });
      }
    });
  }

  /**
   * Obtém dados do formulário como objeto
   * @param {HTMLFormElement|string} form - Elemento do formulário ou ID
   * @returns {Object} Dados do formulário
   */
  static getFormData(form) {
    const formElement = typeof form === 'string' ? document.getElementById(form) : form;
    if (!formElement) return {};

    const formData = new FormData(formElement);
    const data = {};

    // Processar campos normais
    for (const [key, value] of formData.entries()) {
      if (data[key]) {
        // Se já existe, converter para array
        if (Array.isArray(data[key])) {
          data[key].push(value);
        } else {
          data[key] = [data[key], value];
        }
      } else {
        data[key] = value;
      }
    }

    // Processar checkboxes não marcados
    const checkboxes = formElement.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      if (!checkbox.checked && !data.hasOwnProperty(checkbox.name)) {
        data[checkbox.name] = false;
      } else if (checkbox.checked && data[checkbox.name] !== false) {
        data[checkbox.name] = true;
      }
    });

    return data;
  }

  /**
   * Preenche formulário com dados
   * @param {HTMLFormElement|string} form - Elemento do formulário ou ID
   * @param {Object} data - Dados para preencher
   */
  static setFormData(form, data) {
    const formElement = typeof form === 'string' ? document.getElementById(form) : form;
    if (!formElement || !data) return;

    Object.entries(data).forEach(([key, value]) => {
      const elements = formElement.querySelectorAll(`[name="${key}"]`);
      
      elements.forEach(element => {
        switch (element.type) {
          case 'checkbox':
            element.checked = Boolean(value);
            break;
          case 'radio':
            element.checked = element.value === value;
            break;
          case 'select-multiple':
            if (Array.isArray(value)) {
              Array.from(element.options).forEach(option => {
                option.selected = value.includes(option.value);
              });
            }
            break;
          default:
            element.value = value || '';
        }
      });
    });
  }

  /**
   * Exibe mensagem de status padronizada
   * @param {string} message - Mensagem a ser exibida
   * @param {string} type - Tipo da mensagem ('success', 'error', 'warning', 'info')
   * @param {string} containerId - ID do container (opcional)
   * @param {number} duration - Duração em ms (0 = permanente)
   */
  static showStatus(message, type = 'info', containerId = null, duration = 5000) {
    const container = containerId ? document.getElementById(containerId) : document.body;
    if (!container) return;

    // Remover status anterior se existir
    const existingStatus = container.querySelector('.status-message');
    if (existingStatus) {
      existingStatus.remove();
    }

    // Criar elemento de status
    const statusElement = document.createElement('div');
    statusElement.className = `status-message status-${type}`;
    statusElement.innerHTML = `
      <span class="status-icon">${this._getStatusIcon(type)}</span>
      <span class="status-text">${message}</span>
      <button class="status-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    // Aplicar estilos
    this._applyStatusStyles(statusElement, type);

    // Adicionar ao container
    if (containerId) {
      container.appendChild(statusElement);
    } else {
      container.insertBefore(statusElement, container.firstChild);
    }

    // Auto-remover após duração especificada
    if (duration > 0) {
      setTimeout(() => {
        if (statusElement.parentNode) {
          statusElement.remove();
        }
      }, duration);
    }

    return statusElement;
  }

  /**
   * Cria estado de loading para um elemento
   * @param {HTMLElement|string} element - Elemento ou ID
   * @param {string} message - Mensagem de loading
   * @returns {Function} Função para remover o loading
   */
  static createLoadingState(element, message = 'Carregando...') {
    const targetElement = typeof element === 'string' ? document.getElementById(element) : element;
    if (!targetElement) return () => {};

    // Salvar estado original
    const originalContent = targetElement.innerHTML;
    const originalDisabled = targetElement.disabled;

    // Criar overlay de loading
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-message">${message}</div>
    `;

    // Aplicar estilos de loading
    this._applyLoadingStyles(loadingOverlay);

    // Configurar elemento
    targetElement.style.position = 'relative';
    targetElement.appendChild(loadingOverlay);
    
    if (targetElement.disabled !== undefined) {
      targetElement.disabled = true;
    }

    // Retornar função para remover loading
    return () => {
      if (loadingOverlay.parentNode) {
        loadingOverlay.remove();
      }
      if (targetElement.disabled !== undefined) {
        targetElement.disabled = originalDisabled;
      }
    };
  }

  /**
   * Valida campo individual e exibe feedback visual
   * @param {HTMLElement} field - Campo a ser validado
   * @param {Function} validator - Função de validação
   */
  static validateField(field, validator) {
    if (!field || !validator) return;

    const result = validator(field.name, field.value);
    
    // Remover classes de validação anteriores
    field.classList.remove('field-valid', 'field-invalid');
    
    // Remover mensagem de erro anterior
    const existingError = field.parentNode.querySelector('.field-error');
    if (existingError) {
      existingError.remove();
    }

    if (result.isValid) {
      field.classList.add('field-valid');
    } else {
      field.classList.add('field-invalid');
      
      // Adicionar mensagem de erro
      const errorElement = document.createElement('div');
      errorElement.className = 'field-error';
      errorElement.textContent = result.message || 'Invalid field';
      field.parentNode.appendChild(errorElement);
    }
  }

  /**
   * Cria modal simples
   * @param {Object} options - Opções do modal
   * @returns {Object} Objeto com métodos show, hide, destroy
   */
  static createModal(options = {}) {
    const {
      title = '',
      content = '',
      buttons = [],
      closable = true,
      backdrop = true
    } = options;

    // Criar estrutura do modal
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    
    const modalContainer = document.createElement('div');
    modalContainer.className = 'modal-container';
    
    modalContainer.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        ${closable ? '<button class="modal-close">&times;</button>' : ''}
      </div>
      <div class="modal-content">${content}</div>
      <div class="modal-footer">
        ${buttons.map(btn => `
          <button class="modal-btn modal-btn-${btn.type || 'default'}" data-action="${btn.action || ''}">
            ${btn.text}
          </button>
        `).join('')}
      </div>
    `;

    modalOverlay.appendChild(modalContainer);
    
    // Aplicar estilos
    this._applyModalStyles(modalOverlay, modalContainer);

    // Event listeners
    if (closable) {
      const closeBtn = modalContainer.querySelector('.modal-close');
      closeBtn.addEventListener('click', () => modal.hide());
    }

    if (backdrop) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          modal.hide();
        }
      });
    }

    // Buttons
    const buttonElements = modalContainer.querySelectorAll('.modal-btn');
    buttonElements.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action && options.onButtonClick) {
          options.onButtonClick(action, modal);
        }
      });
    });

    const modal = {
      show() {
        document.body.appendChild(modalOverlay);
        document.body.style.overflow = 'hidden';
        if (options.onShow) options.onShow(modal);
      },
      
      hide() {
        if (modalOverlay.parentNode) {
          modalOverlay.remove();
          document.body.style.overflow = '';
        }
        if (options.onHide) options.onHide(modal);
      },
      
      destroy() {
        this.hide();
      },
      
      updateContent(newContent) {
        const contentElement = modalContainer.querySelector('.modal-content');
        if (contentElement) {
          contentElement.innerHTML = newContent;
        }
      }
    };

    return modal;
  }

  /**
   * Utilitário para debounce (privado)
   * @private
   */
  static _debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Obtém ícone para tipo de status
   * @private
   */
  static _getStatusIcon(type) {
    const icons = {
      success: '✓',
      error: '✗',
      warning: '⚠',
      info: 'ℹ'
    };
    return icons[type] || icons.info;
  }

  /**
   * Aplica estilos para mensagens de status
   * @private
   */
  static _applyStatusStyles(element, type) {
    const baseStyles = {
      display: 'flex',
      alignItems: 'center',
      padding: '12px 16px',
      margin: '8px 0',
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      position: 'relative',
      animation: 'slideIn 0.3s ease-out'
    };

    const typeStyles = {
      success: {
        backgroundColor: '#d4edda',
        color: '#155724',
        borderLeft: '4px solid #28a745'
      },
      error: {
        backgroundColor: '#f8d7da',
        color: '#721c24',
        borderLeft: '4px solid #dc3545'
      },
      warning: {
        backgroundColor: '#fff3cd',
        color: '#856404',
        borderLeft: '4px solid #ffc107'
      },
      info: {
        backgroundColor: '#d1ecf1',
        color: '#0c5460',
        borderLeft: '4px solid #17a2b8'
      }
    };

    Object.assign(element.style, baseStyles, typeStyles[type] || typeStyles.info);

    // Estilos para elementos internos
    const icon = element.querySelector('.status-icon');
    if (icon) {
      Object.assign(icon.style, {
        marginRight: '8px',
        fontWeight: 'bold'
      });
    }

    const closeBtn = element.querySelector('.status-close');
    if (closeBtn) {
      Object.assign(closeBtn.style, {
        position: 'absolute',
        right: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'none',
        border: 'none',
        fontSize: '18px',
        cursor: 'pointer',
        opacity: '0.7'
      });
    }
  }

  /**
   * Aplica estilos para loading overlay
   * @private
   */
  static _applyLoadingStyles(overlay) {
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '1000'
    });

    const spinner = overlay.querySelector('.loading-spinner');
    if (spinner) {
      Object.assign(spinner.style, {
        width: '32px',
        height: '32px',
        border: '3px solid #f3f3f3',
        borderTop: '3px solid #007bff',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      });
    }

    const message = overlay.querySelector('.loading-message');
    if (message) {
      Object.assign(message.style, {
        marginTop: '12px',
        fontSize: '14px',
        color: '#666'
      });
    }
  }

  /**
   * Aplica estilos para modal
   * @private
   */
  static _applyModalStyles(overlay, container) {
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10000'
    });

    Object.assign(container.style, {
      backgroundColor: 'white',
      borderRadius: '8px',
      minWidth: '300px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
    });
  }
}

// Adicionar CSS animations se não existirem
if (typeof document !== 'undefined' && !document.getElementById('dom-utils-styles')) {
  const style = document.createElement('style');
  style.id = 'dom-utils-styles';
  style.textContent = `
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .field-valid {
      border-color: #28a745 !important;
      box-shadow: 0 0 0 0.2rem rgba(40, 167, 69, 0.25) !important;
    }
    .field-invalid {
      border-color: #dc3545 !important;
      box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.25) !important;
    }
    .field-error {
      color: #dc3545;
      font-size: 12px;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);
}

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMUtils;
} else if (typeof window !== 'undefined') {
  window.DOMUtils = DOMUtils;
}