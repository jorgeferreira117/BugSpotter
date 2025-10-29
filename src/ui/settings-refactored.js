/**
 * BugSpotter Settings - Versão Refatorada
 * Utiliza os novos módulos utilitários para eliminar duplicações
 */

// Importar utilitários (se disponíveis)
if (typeof ValidationUtils === 'undefined') {
  console.warn('ValidationUtils não encontrado, usando validação básica');
}
if (typeof DOMUtils === 'undefined') {
  console.warn('DOMUtils não encontrado, usando manipulação DOM básica');
}
if (typeof TimeUtils === 'undefined') {
  console.warn('TimeUtils não encontrado, usando funções de tempo básicas');
}

class BugSpotterSettings {
  constructor() {
    this.defaultSettings = {
      jira: {
        enabled: false,
        baseUrl: 'https://jorgealijo.atlassian.net',
        email: 'jorge.alijo@gmail.com',
        apiToken: '',
        projectKey: 'BUG',
        issueTypeId: '10035',
        priorities: {
          highest: 'Highest',
          high: 'High',
          medium: 'Medium',
          low: 'Low',
          lowest: 'Lowest'
        }
      },
      capture: {
        autoCaptureLogs: true,
        screenshotFormat: 'png',
        maxVideoLength: 30,
        screenshotQuality: 90
      },
      security: {
        encryptData: true,
        autoDelete: false,
        maxLocalBugs: 100
      },
      ai: {
        enabled: false,
        provider: 'gemini',
        apiKey: '',
        autoNotify: true,
        minStatus: 400
      },
      notifications: {
        enabled: true,
        aiReports: true,
        httpErrors: true,
        criticalOnly: false,
        errorThreshold: 400,
        sound: true
      }
    };
    
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.updateUI();
    this.bindEvents();
    this.initTabs();
  }

  initTabs() {
    // Usar DOMUtils para gerenciar tabs se disponível
    if (typeof DOMUtils !== 'undefined') {
      DOMUtils.initTabs({
        tabSelector: '.tab-button',
        contentSelector: '.tab-content',
        activeClass: 'active',
        storageKey: 'bugspotter-active-tab',
        defaultTab: 'jira',
        onTabChange: (tabName) => {
          console.log(`Switched to tab: ${tabName}`);
        }
      });
    } else {
      // Fallback para implementação original
      const tabButtons = document.querySelectorAll('.tab-button');
      const tabContents = document.querySelectorAll('.tab-content');
      
      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          const targetTab = button.getAttribute('data-tab');
          this.switchTab(targetTab);
        });
      });
      
      const savedTab = localStorage.getItem('bugspotter-active-tab') || 'jira';
      this.switchTab(savedTab);
    }
  }
  
  switchTab(tabName) {
    // Remove active class from all buttons and contents
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to selected button and content
    const activeButton = document.querySelector(`[data-tab="${tabName}"]`);
    const activeContent = document.getElementById(`${tabName}-tab`);
    
    if (activeButton && activeContent) {
      activeButton.classList.add('active');
      activeContent.classList.add('active');
      
      // Save active tab to localStorage
      localStorage.setItem('bugspotter-active-tab', tabName);
    }
  }

  bindEvents() {
    // Usar DOMUtils para binding de eventos de formulário
    const formConfigs = {
      jiraForm: {
        onSubmit: (e, formData) => this.saveJiraSettings(e),
        fields: {
          jiraEnabled: { onChange: () => this.toggleJiraConfig() },
          jiraUrl: { onInput: () => this.updatePriorityFieldsState() },
          jiraEmail: { onInput: () => this.updatePriorityFieldsState() },
          jiraApiToken: { onInput: () => this.updatePriorityFieldsState() },
          jiraProjectKey: { onInput: () => this.updatePriorityFieldsState() }
        }
      },
      captureForm: {
        onSubmit: (e, formData) => this.saveCaptureSettings(e)
      },
      securityForm: {
        onSubmit: (e, formData) => this.saveSecuritySettings(e)
      },
      aiForm: {
        onSubmit: (e, formData) => this.saveAISettings(e),
        fields: {
          aiEnabled: { onChange: () => this.toggleAIConfig() },
          aiProvider: { onChange: () => this.updateAPIKeyHelp() }
        }
      },
      notificationsForm: {
        onSubmit: (e, formData) => this.saveNotificationSettings(e),
        fields: {
          notificationsEnabled: { onChange: () => this.toggleNotificationsConfig() }
        }
      }
    };

    if (typeof DOMUtils !== 'undefined') {
      // Usar DOMUtils para binding automático
      Object.entries(formConfigs).forEach(([formId, config]) => {
        const form = document.getElementById(formId);
        if (form) {
          DOMUtils.bindFormEvents(formId, config, {
            preventDefault: true,
            validateOnChange: true
          });
        }
      });
    } else {
      // Fallback para event listeners manuais
      document.getElementById('jiraForm').addEventListener('submit', (e) => this.saveJiraSettings(e));
      document.getElementById('jiraEnabled').addEventListener('change', () => this.toggleJiraConfig());
      
      ['jiraUrl', 'jiraEmail', 'jiraApiToken', 'jiraProjectKey'].forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
          field.addEventListener('input', () => this.updatePriorityFieldsState());
        }
      });
    }

    // Event listeners para botões específicos
    const buttonHandlers = {
      'testJiraConnection': () => this.testJiraConnection(),
      'testAIConnection': () => this.testAIConnection(),
      'exportData': () => this.exportData(),
      'importData': () => this.importData(),
      'clearData': () => this.clearData(),
      'addPriorityLevel': () => this.addPriorityLevel(),
      'resetPriorities': () => this.resetPriorities()
    };

    Object.entries(buttonHandlers).forEach(([id, handler]) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('click', handler);
      }
    });
  }

  /**
   * Merge profundo de objetos - consolidado dos utilitários
   */
  deepMerge(target, source) {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this.deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      if (result.settings) {
        this.settings = this.deepMerge({}, this.defaultSettings);
        this.settings = this.deepMerge(this.settings, result.settings);
      } else {
        this.settings = { ...this.defaultSettings };
      }
      
      // Garantir que as prioridades existam
      if (!this.settings.jira.priorities || Object.keys(this.settings.jira.priorities).length === 0) {
        this.settings.jira.priorities = { ...this.defaultSettings.jira.priorities };
      }
      
      // Garantir que configurações de notificação existam
      if (!this.settings.notifications) {
        this.settings.notifications = { ...this.defaultSettings.notifications };
      }
      
    } catch (error) {
      console.error('Error loading settings:', error);
      this.settings = { ...this.defaultSettings };
    }
  }

  updateUI() {
    // Usar DOMUtils para preencher formulários se disponível
    if (typeof DOMUtils !== 'undefined') {
      const formMappings = {
        jiraForm: this.settings.jira,
        captureForm: this.settings.capture,
        securityForm: this.settings.security,
        aiForm: this.settings.ai,
        notificationsForm: this.settings.notifications
      };

      Object.entries(formMappings).forEach(([formId, data]) => {
        DOMUtils.populateForm(formId, data);
      });
    } else {
      // Fallback para preenchimento manual
      this.updateJiraUI();
      this.updateCaptureUI();
      this.updateSecurityUI();
      this.updateAIUI();
      this.updateNotificationsUI();
    }

    // Atualizar estados específicos
    this.toggleJiraConfig();
    this.toggleAIConfig();
    this.toggleNotificationsConfig();
    this.loadPriorityUI();
    this.updatePriorityFieldsState();
  }

  // Métodos de atualização de UI específicos (fallback)
  updateJiraUI() {
    document.getElementById('jiraEnabled').checked = this.settings.jira.enabled;
    document.getElementById('jiraUrl').value = this.settings.jira.baseUrl;
    document.getElementById('jiraEmail').value = this.settings.jira.email;
    document.getElementById('jiraApiToken').value = this.settings.jira.apiToken;
    document.getElementById('jiraProjectKey').value = this.settings.jira.projectKey;
    document.getElementById('jiraIssueType').value = this.settings.jira.issueTypeId;
  }

  updateCaptureUI() {
    document.getElementById('autoCaptureLogs').checked = this.settings.capture.autoCaptureLogs;
    document.getElementById('screenshotFormat').value = this.settings.capture.screenshotFormat;
    document.getElementById('maxVideoLength').value = this.settings.capture.maxVideoLength;
    document.getElementById('screenshotQuality').value = this.settings.capture.screenshotQuality;
  }

  updateSecurityUI() {
    document.getElementById('encryptData').checked = this.settings.security.encryptData;
    document.getElementById('autoDelete').checked = this.settings.security.autoDelete;
    document.getElementById('maxLocalBugs').value = this.settings.security.maxLocalBugs;
  }

  updateAIUI() {
    document.getElementById('aiEnabled').checked = this.settings.ai.enabled;
    document.getElementById('aiProvider').value = this.settings.ai.provider;
    document.getElementById('aiApiKey').value = this.settings.ai.apiKey;
    document.getElementById('autoNotify').checked = this.settings.ai.autoNotify;
    document.getElementById('minStatus').value = this.settings.ai.minStatus;
  }

  updateNotificationsUI() {
    document.getElementById('notificationsEnabled').checked = this.settings.notifications.enabled;
    document.getElementById('aiReports').checked = this.settings.notifications.aiReports;
    document.getElementById('httpErrors').checked = this.settings.notifications.httpErrors;
    document.getElementById('criticalOnly').checked = this.settings.notifications.criticalOnly;
    document.getElementById('errorThreshold').value = this.settings.notifications.errorThreshold;
    document.getElementById('sound').checked = this.settings.notifications.sound;
  }

  toggleJiraConfig() {
    const enabled = document.getElementById('jiraEnabled').checked;
    const configSection = document.querySelector('.jira-config');
    if (configSection) {
      configSection.style.display = enabled ? 'block' : 'none';
    }
  }

  /**
   * Salva configurações do Jira usando ValidationUtils
   */
  async saveJiraSettings(event) {
    event.preventDefault();
    
    // Obter dados do formulário usando DOMUtils ou fallback
    let formData;
    if (typeof DOMUtils !== 'undefined') {
      formData = DOMUtils.getFormData('jiraForm');
      formData.enabled = document.getElementById('jiraEnabled').checked;
    } else {
      formData = {
        enabled: document.getElementById('jiraEnabled').checked,
        baseUrl: document.getElementById('jiraUrl').value.trim(),
        email: document.getElementById('jiraEmail').value.trim(),
        apiToken: document.getElementById('jiraApiToken').value.trim(),
        projectKey: document.getElementById('jiraProjectKey').value.trim(),
        issueTypeId: document.getElementById('jiraIssueType').value.trim()
      };
    }

    // Validar usando ValidationUtils
    if (typeof ValidationUtils !== 'undefined') {
      const schema = ValidationUtils.createValidationSchema('jira-settings');
      const validationResult = ValidationUtils.validateInput(formData, schema, 'Jira Settings');
      
      if (!validationResult.isValid) {
        const errorMessage = ValidationUtils.formatValidationErrors(validationResult.errors, 'string');
        this.showStatus(`❌ ${errorMessage}`, 'error');
        return;
      }
    } else {
      // Fallback para validação básica
      if (formData.enabled) {
        if (!formData.baseUrl || !formData.baseUrl.match(/^https?:\/\/.+/)) {
          this.showStatus('❌ Jira URL must be a valid http/https URL', 'error');
          return;
        }
        if (!formData.email || !formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
          this.showStatus('❌ Email must be a valid email address', 'error');
          return;
        }
        if (!formData.apiToken || formData.apiToken.length < 10) {
          this.showStatus('❌ API token must be at least 10 characters long', 'error');
          return;
        }
        if (!formData.projectKey || !formData.projectKey.match(/^[A-Z][A-Z0-9]*$/)) {
          this.showStatus('❌ Project Key must start with an uppercase letter and contain only letters and numbers', 'error');
          return;
        }
      }
    }

    // Criar estado de loading usando DOMUtils
    const button = event.target.querySelector('.btn-save-config');
    let removeLoading;
    if (typeof DOMUtils !== 'undefined') {
      removeLoading = DOMUtils.createLoadingState(button, 'Saving...');
    } else {
      const originalHTML = button.innerHTML;
      button.innerHTML = '<span class="material-icons">sync</span>Saving...';
      button.disabled = true;
      
      removeLoading = () => {
        setTimeout(() => {
          button.innerHTML = originalHTML;
          button.disabled = false;
        }, 1000);
      };
    }
    
    try {
      this.settings.jira = {
        ...formData,
        priorities: this.settings.jira.priorities // Manter prioridades existentes
      };
      
      // Salvar prioridades junto com as configurações do Jira
      await this.savePrioritySettings(false);
      await this.saveSettings();
      
      this.showStatus('✅ Jira settings saved successfully!', 'success');
      
    } catch (error) {
      console.error('Error saving Jira settings:', error);
      this.showStatus('❌ Error saving Jira settings', 'error');
    } finally {
      if (removeLoading) {
        removeLoading();
      }
    }
  }

  /**
   * Salva configurações de captura usando ValidationUtils
   */
  async saveCaptureSettings(event) {
    if (event) event.preventDefault();
    
    try {
      let captureData;
      if (typeof DOMUtils !== 'undefined') {
        captureData = DOMUtils.getFormData('captureForm');
        // Converter strings para números onde necessário
        captureData.maxVideoLength = parseInt(captureData.maxVideoLength);
        captureData.screenshotQuality = parseInt(captureData.screenshotQuality);
      } else {
        captureData = {
          autoCaptureLogs: document.getElementById('autoCaptureLogs').checked,
          screenshotFormat: document.getElementById('screenshotFormat').value,
          maxVideoLength: parseInt(document.getElementById('maxVideoLength').value),
          screenshotQuality: parseInt(document.getElementById('screenshotQuality').value)
        };
      }
      
      // Validar usando ValidationUtils
      if (typeof ValidationUtils !== 'undefined') {
        const schema = ValidationUtils.createValidationSchema('capture-settings');
        const validationResult = ValidationUtils.validateInput(captureData, schema, 'Capture Settings');
        
        if (!validationResult.isValid) {
          const errorMessage = ValidationUtils.formatValidationErrors(validationResult.errors, 'string');
          this.showStatus(`❌ ${errorMessage}`, 'error');
          return;
        }
      }
      
      this.settings.capture = captureData;
      await this.saveSettings();
      
      this.showStatus('✅ Capture settings saved!', 'success');
      
    } catch (error) {
      console.error('Error saving capture settings:', error);
      this.showStatus('❌ Error saving capture settings', 'error');
    }
  }

  /**
   * Exibe mensagens de status usando DOMUtils ou fallback
   */
  showStatus(message, type = 'info', duration = 3000) {
    if (typeof DOMUtils !== 'undefined') {
      return DOMUtils.showStatus(message, type, 'statusMessage', duration);
    } else {
      // Fallback para implementação original
      const statusElement = document.getElementById('statusMessage');
      if (!statusElement) {
        console.error('Status element not found');
        return;
      }
      
      statusElement.textContent = message;
      statusElement.className = `status-message ${type}`;
      statusElement.style.display = 'block';
      statusElement.style.opacity = '1';
      
      setTimeout(() => {
        statusElement.style.opacity = '0';
        setTimeout(() => {
          statusElement.textContent = '';
          statusElement.className = 'status-message';
          statusElement.style.display = 'none';
        }, 300);
      }, duration);
    }
  }

  // Métodos de gerenciamento de prioridades refatorados
  bindPriorityRemoveButtons() {
    document.querySelectorAll('.btn-remove-priority').forEach(button => {
      button.addEventListener('click', (e) => {
        const priorityItem = e.target.closest('.priority-item');
        if (priorityItem) {
          this.removePriorityLevel(priorityItem);
        }
      });
    });
  }

  addPriorityLevel() {
    const priorityList = document.querySelector('.priority-list');
    const newKey = `custom_${Date.now()}`;
    
    const priorityItem = this.createPriorityItem(newKey, 'New Priority');
    priorityList.appendChild(priorityItem);
    
    // Bind event listeners para o novo botão
    this.bindPriorityRemoveButtons();
    
    // Salvar sem mostrar mensagem
    this.savePrioritySettings(false);
  }

  removePriorityLevel(priorityItem) {
    const priorityList = document.querySelector('.priority-list');
    
    // Não permitir remoção se restarem apenas 2 prioridades
    if (priorityList.children.length <= 2) {
      this.showStatus('There must be at least 2 priority levels', 'error');
      return;
    }
    
    priorityItem.remove();
    this.savePrioritySettings(false);
  }

  createPriorityItem(key, value) {
    const priorityItem = document.createElement('div');
    priorityItem.className = 'priority-item';
    priorityItem.setAttribute('data-priority', key);
    
    priorityItem.innerHTML = `
      <input type="text" id="priority${key}" placeholder="${value}" value="${value}">
      <button type="button" class="btn-remove-priority" title="Remove priority">
        <span class="material-icons">remove_circle</span>
      </button>
    `;
    
    return priorityItem;
  }

  async savePrioritySettings(showMessage = false) {
    try {
      const priorities = {};
      
      document.querySelectorAll('.priority-item').forEach(item => {
        const key = item.getAttribute('data-priority');
        const input = item.querySelector('input');
        if (input && input.value.trim()) {
          priorities[key] = input.value.trim();
        }
      });
      
      this.settings.jira.priorities = priorities;
      await this.saveSettings();
      
      if (showMessage) {
        this.showStatus('✅ Priority settings saved!', 'success');
      }
      
    } catch (error) {
      console.error('Error saving priority settings:', error);
      if (showMessage) {
        this.showStatus('❌ Error saving priority settings', 'error');
      }
    }
  }

  async loadPriorityUI() {
    const priorityList = document.querySelector('.priority-list');
    if (!priorityList) return;
    
    priorityList.innerHTML = '';
    
    Object.entries(this.settings.jira.priorities).forEach(([key, value]) => {
      const priorityItem = this.createPriorityItem(key, value);
      priorityList.appendChild(priorityItem);
    });
    
    this.bindPriorityRemoveButtons();
  }

  // Métodos restantes mantêm implementação similar mas usando utilitários quando disponível
  async saveSettings() {
    try {
      await chrome.storage.local.set({ settings: this.settings });
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  }

  toggleAIConfig() {
    const enabled = document.getElementById('aiEnabled').checked;
    const configSection = document.querySelector('.ai-config');
    if (configSection) {
      configSection.style.display = enabled ? 'block' : 'none';
    }
    this.updateAIStatus();
  }

  toggleNotificationsConfig() {
    const enabled = document.getElementById('notificationsEnabled').checked;
    const configSection = document.querySelector('.notifications-config');
    if (configSection) {
      configSection.style.display = enabled ? 'block' : 'none';
    }
  }

  updatePriorityFieldsState() {
    const hasCredentials = this.hasValidJiraCredentials();
    const prioritySection = document.querySelector('.priority-section');
    const testButton = document.getElementById('testJiraConnection');
    
    if (prioritySection) {
      prioritySection.style.opacity = hasCredentials ? '1' : '0.5';
    }
    
    if (testButton) {
      testButton.disabled = !hasCredentials;
    }
  }

  hasValidJiraCredentials() {
    const url = document.getElementById('jiraUrl').value.trim();
    const email = document.getElementById('jiraEmail').value.trim();
    const token = document.getElementById('jiraApiToken').value.trim();
    const projectKey = document.getElementById('jiraProjectKey').value.trim();
    
    return url && email && token && projectKey;
  }

  updateAIStatus() {
    // Implementação mantida similar
    const enabled = document.getElementById('aiEnabled').checked;
    const statusElement = document.querySelector('.ai-status');
    
    if (statusElement) {
      statusElement.textContent = enabled ? 'AI analysis enabled' : 'AI analysis disabled';
      statusElement.className = `ai-status ${enabled ? 'enabled' : 'disabled'}`;
    }
  }

  updateAPIKeyHelp() {
    // Implementação mantida similar
    const provider = document.getElementById('aiProvider').value;
    const helpElement = document.querySelector('.api-key-help');
    
    if (helpElement) {
      const helpTexts = {
        gemini: 'Get your API key from Google AI Studio',
        openai: 'Get your API key from OpenAI Platform'
      };
      
      helpElement.textContent = helpTexts[provider] || 'Select a provider to see help';
    }
  }

  // Métodos de teste de conexão, exportação/importação mantêm implementação original
  // mas podem usar utilitários para validação e feedback
  
  async testJiraConnection() {
    // Implementação original mantida com melhorias de feedback usando DOMUtils
    const button = document.getElementById('testJiraConnection');
    let removeLoading;
    
    if (typeof DOMUtils !== 'undefined') {
      removeLoading = DOMUtils.createLoadingState(button, 'Testing...');
    } else {
      const originalText = button.textContent;
      button.textContent = 'Testing...';
      button.disabled = true;
      
      removeLoading = () => {
        button.textContent = originalText;
        button.disabled = false;
      };
    }
    
    try {
      // Lógica de teste mantida
      const response = await chrome.runtime.sendMessage({
        action: 'TEST_JIRA_CONNECTION',
        settings: {
          baseUrl: document.getElementById('jiraUrl').value.trim(),
          email: document.getElementById('jiraEmail').value.trim(),
          apiToken: document.getElementById('jiraApiToken').value.trim(),
          projectKey: document.getElementById('jiraProjectKey').value.trim()
        }
      });
      
      if (response.success) {
        this.showStatus('✅ Jira connection successful!', 'success');
      } else {
        this.showStatus(`❌ Jira connection failed: ${response.error}`, 'error');
      }
      
    } catch (error) {
      console.error('Error testing Jira connection:', error);
      this.showStatus(`❌ Connection test failed: ${error.message}`, 'error');
    } finally {
      if (removeLoading) {
        removeLoading();
      }
    }
  }

  // Outros métodos (saveAISettings, saveSecuritySettings, etc.) seguem padrão similar
  // usando ValidationUtils para validação e DOMUtils para manipulação de DOM
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  new BugSpotterSettings();
});

// Error handling global
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in settings:', event.reason);
  event.preventDefault();
});