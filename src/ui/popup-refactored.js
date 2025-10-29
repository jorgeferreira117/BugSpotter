/**
 * BugSpotter Popup - Versão Refatorada
 * Utiliza os novos módulos utilitários para eliminar duplicações
 */

// Importar utilitários (se disponíveis)
if (typeof ValidationUtils === 'undefined') {
  // Fallback se os utilitários não estiverem carregados
  console.warn('ValidationUtils não encontrado, usando validação básica');
}

class BugSpotter {
  constructor() {
    this.attachments = [];
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.reportStatusTimeout = null;
    this.captureStatusTimeout = null;
    this.cachedSettings = null;
    this.errorHandler = new ErrorHandler();
    
    // Timer para gravação usando TimeUtils
    this.recordingTimer = null;
  }
  
  async init() {
    // Notificar background que popup foi aberto (para limpar badge)
    try {
      console.log('[Popup] Enviando mensagem POPUP_OPENED para limpar badge...');
      const response = await chrome.runtime.sendMessage({ action: 'POPUP_OPENED' });
      console.log('[Popup] Resposta do background:', response);
    } catch (error) {
      console.error('[Popup] Error sending POPUP_OPENED message:', error);
    }
    
    // Verificar se há gravação em andamento
    await this.checkRecordingState();
    
    // Carregar configurações no cache
    this.cachedSettings = await this.getSettings();
    await this.loadBugHistory();
    await this.loadPriorityOptions();
    this.setupEventListeners();
    
    // Listener para mensagens do background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleBackgroundMessage(message, sender, sendResponse);
    });
    
    // Listener para mudanças nas configurações
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.settings) {
        this.loadPriorityOptions();
        this.cachedSettings = changes.settings.newValue;
      }
    });
  }

  setupEventListeners() {
    // Usar DOMUtils para binding de eventos do formulário
    if (typeof DOMUtils !== 'undefined') {
      DOMUtils.bindFormEvents('bugForm', {
        onSubmit: (e, formData) => this.submitBug(e),
        onChange: (e, fieldName, value) => this.handleFormChange(fieldName, value),
        onInput: (e, fieldName, value) => this.handleFormInput(fieldName, value)
      }, {
        preventDefault: true,
        validateOnChange: true,
        validator: (fieldName, value) => this.validateField(fieldName, value)
      });
    } else {
      // Fallback para event listeners tradicionais
      document.getElementById('bugForm').addEventListener('submit', (e) => this.submitBug(e));
    }

    // Event listeners para botões principais
    const buttonHandlers = {
      'captureScreenshot': () => this.captureScreenshot(),
      'captureLogs': () => this.captureLogs(),
      'captureDOM': () => this.captureDOM(),
      'startRecording': () => this.startRecording(),
      'clearHistory': () => this.clearHistory(),
      'openSettings': () => this.openSettings()
    };

    Object.entries(buttonHandlers).forEach(([id, handler]) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('click', handler);
      }
    });
    
    // Event listener para remoção de anexos e botões do histórico
    document.addEventListener('click', (e) => {
      // Remoção de anexos
      if (e.target.closest('.remove-attachment')) {
        const index = e.target.closest('.remove-attachment').dataset.index;
        this.removeAttachment(parseInt(index));
      }
      
      // Botões de envio do histórico
      if (e.target.closest('.send-btn')) {
        const indexStr = e.target.closest('.send-btn').dataset.index;
        const index = parseInt(indexStr);
        if (isNaN(index) || indexStr === undefined || indexStr === null) {
          console.error('Invalid index for send button:', indexStr);
          return;
        }
        
        const historyItem = e.target.closest('.history-item');
        if (historyItem && historyItem.classList.contains('ai-report-item')) {
          this.handleAIReportSend(index);
        } else {
          this.retryJiraSubmission(index);
        }
      }
      
      // Outros botões do histórico
      this.handleHistoryButtons(e);
    });
  }

  /**
   * Manipula mudanças nos campos do formulário
   */
  handleFormChange(fieldName, value) {
    // Lógica específica para mudanças de campo
    console.log(`Campo ${fieldName} alterado para:`, value);
  }

  /**
   * Manipula entrada de dados nos campos do formulário
   */
  handleFormInput(fieldName, value) {
    // Lógica específica para entrada de dados
    // Pode incluir auto-save, validação em tempo real, etc.
  }

  /**
   * Valida campo individual usando ValidationUtils
   */
  validateField(fieldName, value) {
    if (typeof ValidationUtils === 'undefined') {
      return { isValid: true }; // Fallback
    }

    const schema = ValidationUtils.createValidationSchema('bug-report');
    const fieldSchema = { [fieldName]: schema[fieldName] };
    const fieldData = { [fieldName]: value };
    
    const result = ValidationUtils.validateInput(fieldData, fieldSchema);
    return {
      isValid: result.isValid,
      message: result.errors.length > 0 ? result.errors[0].message : null
    };
  }

  /**
   * Manipula envio de relatórios AI
   */
  async handleAIReportSend(index) {
    try {
      const aiReports = await this.loadAIReports();
      const report = aiReports[index];
      if (report) {
        await this.sendAIReportToJira(index, report);
      } else {
        console.error('AI report not found at index:', index);
        this.showStatus('AI report not found', 'error');
      }
    } catch (error) {
      console.error('Error sending AI report to Jira:', error);
      this.showStatus(`Error sending to Jira: ${error.message}`, 'error');
    }
  }

  /**
   * Manipula outros botões do histórico
   */
  handleHistoryButtons(e) {
    const actions = {
      '.view-btn': (index) => this.viewReport(index),
      '.delete-btn': (index) => this.deleteReport(index),
      '.view-ai-btn': (index) => this.viewAIReport(index),
      '.delete-ai-btn': (index) => this.deleteAIReport(index)
    };

    Object.entries(actions).forEach(([selector, handler]) => {
      if (e.target.closest(selector)) {
        const index = parseInt(e.target.closest(selector).dataset.index);
        if (!isNaN(index)) {
          handler(index);
        }
      }
    });
  }

  /**
   * Exibe status usando DOMUtils ou fallback
   */
  showStatus(message, type = 'info', containerId = null, duration = 5000) {
    if (typeof DOMUtils !== 'undefined') {
      return DOMUtils.showStatus(message, type, containerId, duration);
    } else {
      // Fallback para método original
      this.updateReportStatus(message, type);
    }
  }

  /**
   * Atualiza status de captura usando utilitários
   */
  updateCaptureStatus(message, type = 'info') {
    this.showStatus(message, type, 'captureStatus', 3000);
  }

  /**
   * Atualiza status de relatório usando utilitários
   */
  updateReportStatus(message, type = 'info') {
    const statusElement = document.getElementById('reportStatus');
    if (!statusElement) return;

    // Limpar timeout anterior
    if (this.reportStatusTimeout) {
      clearTimeout(this.reportStatusTimeout);
    }

    // Aplicar classes de status
    statusElement.className = `status-message status-${type}`;
    statusElement.textContent = message;
    statusElement.style.display = 'block';

    // Auto-ocultar após 5 segundos para mensagens de sucesso/info
    if (type === 'success' || type === 'info') {
      this.reportStatusTimeout = setTimeout(() => {
        statusElement.style.display = 'none';
      }, 5000);
    }
  }

  /**
   * Atualiza timer de gravação usando TimeUtils
   */
  updateRecordingTimer(maxDuration, startElapsed = 0) {
    if (typeof TimeUtils !== 'undefined') {
      // Usar TimeUtils para criar countdown
      const remainingSeconds = Math.floor((maxDuration - startElapsed) / 1000);
      
      this.recordingTimer = TimeUtils.createCountdown(
        remainingSeconds,
        (remaining) => {
          const timeStr = TimeUtils.formatDuration(remaining);
          this.updateCaptureStatus(`Recording... (${timeStr} remaining)`, 'loading');
        },
        () => {
          // Timer finalizado
          this.recordingTimer = null;
        }
      );
      
      this.recordingTimer.start();
    } else {
      // Fallback para implementação original
      let elapsed = startElapsed;
      this.recordingTimerInterval = setInterval(() => {
        elapsed += 1000;
        const remaining = Math.max(0, (maxDuration - elapsed) / 1000);
        
        if (remaining > 0) {
          const minutes = Math.floor(remaining / 60);
          const seconds = Math.round(remaining % 60);
          this.updateCaptureStatus(`Recording... (${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} remaining)`, 'loading');
        }
        
        if (elapsed >= maxDuration) {
          clearInterval(this.recordingTimerInterval);
          this.recordingTimerInterval = null;
        }
      }, 1000);
    }
  }

  /**
   * Para o timer de gravação
   */
  stopRecordingTimer() {
    if (this.recordingTimer && typeof this.recordingTimer.stop === 'function') {
      this.recordingTimer.stop();
      this.recordingTimer = null;
    } else if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
      this.recordingTimerInterval = null;
    }
  }

  /**
   * Submete bug usando ValidationUtils
   */
  async submitBug(event) {
    event.preventDefault();
    
    // Proteção contra múltiplos cliques
    const submitBtn = event.target.querySelector('.submit-btn');
    if (submitBtn.disabled) {
      return;
    }

    // Obter dados do formulário usando DOMUtils ou fallback
    let bugData;
    if (typeof DOMUtils !== 'undefined') {
      bugData = DOMUtils.getFormData('bugForm');
    } else {
      // Fallback para FormData tradicional
      const formData = new FormData(event.target);
      bugData = {
        title: formData.get('title'),
        description: formData.get('description'),
        steps: formData.get('steps'),
        expectedBehavior: formData.get('expectedBehavior'),
        actualBehavior: formData.get('actualBehavior'),
        priority: formData.get('priority'),
        environment: formData.get('environment'),
        component: formData.get('component')
      };
    }

    // Validar dados usando ValidationUtils
    let validationResult;
    if (typeof ValidationUtils !== 'undefined') {
      const schema = ValidationUtils.createValidationSchema('bug-report');
      validationResult = ValidationUtils.validateInput(bugData, schema, 'Bug Report');
      
      if (!validationResult.isValid) {
        const errorMessage = ValidationUtils.formatValidationErrors(validationResult.errors, 'string');
        this.showStatus(`❌ ${errorMessage}`, 'error');
        return;
      }
    } else {
      // Fallback para validação via ErrorHandler
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'VALIDATE_INPUT',
          data: bugData,
          schema: {
            title: { required: true, type: 'string', minLength: 5, maxLength: 200 },
            description: { required: true, type: 'string', minLength: 10, maxLength: 2000 },
            priority: { required: true, type: 'string' },
            environment: { required: true, type: 'string' }
          },
          context: 'Bug Report'
        });
        
        if (!response.success) {
          this.showStatus(`❌ ${response.errors.join(', ')}`, 'error');
          return;
        }
      } catch (error) {
        console.error('Validation error:', error);
        this.showStatus('❌ Validation failed', 'error');
        return;
      }
    }

    // Criar estado de loading usando DOMUtils
    let removeLoading;
    if (typeof DOMUtils !== 'undefined') {
      removeLoading = DOMUtils.createLoadingState(submitBtn, 'Sending...');
    } else {
      // Fallback para loading manual
      submitBtn.disabled = true;
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = `
        <span class="material-icons">hourglass_empty</span>
        Sending...
      `;
      submitBtn.classList.add('loading');
      
      removeLoading = () => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        submitBtn.classList.remove('loading');
      };
    }

    this.showStatus('Processing report...', 'loading');
    
    // Completar dados do bug
    bugData.url = await this.getCurrentTabUrl();
    bugData.attachments = this.attachments;
    bugData.timestamp = new Date().toISOString();
    bugData.jiraAttempted = false;
    bugData.status = 'open';
  
    try {
      // Tentar enviar para Jira se configurado
      const settings = await this.getSettings();
      if (settings.jira && settings.jira.enabled) {
        try {
          bugData.jiraAttempted = true;
          const jiraResponse = await this.sendToJira(bugData);
          const ticketKey = jiraResponse?.key || jiraResponse?.issueKey;
          
          if (ticketKey) {
            bugData.jiraKey = ticketKey;
            bugData.jiraSuccess = true;
            bugData.jiraSentAt = new Date().toISOString();
            
            this.showStatus(`✅ Bug sent to Jira: ${ticketKey}`, 'success');
          }
        } catch (jiraError) {
          console.error('Jira submission failed:', jiraError);
          bugData.jiraSuccess = false;
          bugData.jiraError = jiraError.message;
          
          this.showStatus(`⚠️ Saved locally. Jira error: ${jiraError.message}`, 'warning');
        }
      }
      
      // Salvar relatório localmente
      await this.saveBugReport(bugData);
      
      // Limpar formulário e anexos
      event.target.reset();
      this.attachments = [];
      this.updateAttachmentsList();
      
      // Recarregar histórico
      await this.loadBugHistory();
      
      if (!bugData.jiraAttempted) {
        this.showStatus('✅ Bug report saved locally', 'success');
      }
      
    } catch (error) {
      console.error('Error submitting bug:', error);
      this.showStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
      // Remover estado de loading
      if (removeLoading) {
        removeLoading();
      }
    }
  }

  /**
   * Formata tamanho de arquivo usando utilitários consolidados
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Calcula tamanho de Data URL
   */
  calculateDataUrlSize(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    return Math.round((base64.length * 3) / 4);
  }

  // ... resto dos métodos permanecem iguais por enquanto ...
  // (captureScreenshot, captureLogs, startRecording, etc.)
  
  // Métodos que não foram alterados ainda mantêm a implementação original
  async captureScreenshot() {
    // Implementação original mantida
    this.updateCaptureStatus('Capturing screenshot...', 'loading');
    
    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }
      
      const response = await chrome.runtime.sendMessage({
        action: 'CAPTURE_SCREENSHOT',
        tabId: tabs[0].id
      });
      
      if (response.success && response.screenshot) {
        const attachment = {
          type: 'screenshot',
          name: `screenshot_${Date.now()}.png`,
          data: response.screenshot,
          size: this.calculateDataUrlSize(response.screenshot)
        };
        
        if (this.addAttachment(attachment)) {
          this.updateCaptureStatus('✅ Screenshot captured', 'success');
        }
      } else {
        throw new Error(response.error || 'Failed to capture screenshot');
      }
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      this.updateCaptureStatus(`❌ Screenshot failed: ${error.message}`, 'error');
    }
  }

  // ... outros métodos mantidos iguais por enquanto ...
}

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
  const bugSpotter = new BugSpotter();
  await bugSpotter.init();
  window.bugSpotter = bugSpotter;
});

// Error handling global
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in popup:', event.reason);
  event.preventDefault();
});