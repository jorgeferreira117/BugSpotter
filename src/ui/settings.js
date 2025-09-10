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
      }
    };
    
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.bindEvents();
    this.updateUI();
  }

  bindEvents() {
    // Jira form
    document.getElementById('jiraForm').addEventListener('submit', (e) => this.saveJiraSettings(e));
    document.getElementById('jiraEnabled').addEventListener('change', () => this.toggleJiraConfig());
    document.getElementById('testJiraConnection').addEventListener('click', () => this.testJiraConnection());
    
    // 🆕 Monitorar mudanças nos campos do Jira para atualizar estado das prioridades
    ['jiraUrl', 'jiraEmail', 'jiraApiToken', 'jiraProjectKey'].forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        field.addEventListener('input', () => {
          // Pequeno delay para permitir que o usuário termine de digitar
          clearTimeout(this.jiraFieldsTimeout);
          this.jiraFieldsTimeout = setTimeout(() => {
            this.updatePriorityFieldsState();
          }, 500);
        });
      }
    });
  
    // Priority management - REMOVER AUTO-SAVE
    document.getElementById('addPriority').addEventListener('click', () => this.addPriorityLevel());
    document.getElementById('resetPriorities').addEventListener('click', () => this.resetPriorities());
    
    // REMOVER: Salvamento automático das prioridades
    // document.addEventListener('input', (e) => {
    //   if (e.target.closest('.priority-item input')) {
    //     this.savePrioritySettings();
    //   }
    // });
    
    this.bindPriorityRemoveButtons();
  
    // Capture settings - salvar automaticamente quando houver mudanças
    document.getElementById('captureForm').addEventListener('change', () => this.saveCaptureSettings());
    document.getElementById('screenshotQuality').addEventListener('input', (e) => {
      document.getElementById('qualityValue').textContent = e.target.value + '%';
      // Salvar automaticamente quando o slider for alterado
      this.saveCaptureSettings();
    });
  
    // Security settings - salvar automaticamente quando houver mudanças
    document.getElementById('securityForm').addEventListener('change', () => this.saveSecuritySettings());
  
    // Data management
    document.getElementById('exportData').addEventListener('click', () => this.exportData());
    document.getElementById('importData').addEventListener('click', () => this.importData());
    document.getElementById('clearData').addEventListener('click', () => this.clearData());
  }

  deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    return result;
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      console.log('🔍 Carregando configurações do storage:', result.settings?.jira?.priorities);
      
      if (result.settings) {
        // CORREÇÃO: Fazer merge dos padrões primeiro, depois sobrescrever com as configurações salvas
        this.settings = this.deepMerge(this.defaultSettings, result.settings);
        console.log('✅ Configurações carregadas:', this.settings.jira.priorities);
      } else {
        this.settings = { ...this.defaultSettings };
        console.log('📝 Usando configurações padrão');
      }
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
      this.settings = { ...this.defaultSettings };
    }
  }

  updateUI() {
    // Jira settings
    document.getElementById('jiraEnabled').checked = this.settings.jira.enabled;
    document.getElementById('jiraUrl').value = this.settings.jira.baseUrl;
    document.getElementById('jiraEmail').value = this.settings.jira.email;
    document.getElementById('jiraApiToken').value = this.settings.jira.apiToken;
    document.getElementById('jiraProjectKey').value = this.settings.jira.projectKey;
    document.getElementById('jiraIssueType').value = this.settings.jira.issueTypeId;

    // Load priority settings
    this.loadPriorityUI();

    // Capture settings
    document.getElementById('autoCaptureLogs').checked = this.settings.capture.autoCaptureLogs;
    document.getElementById('screenshotFormat').value = this.settings.capture.screenshotFormat;
    document.getElementById('maxVideoLength').value = this.settings.capture.maxVideoLength;
    document.getElementById('screenshotQuality').value = this.settings.capture.screenshotQuality;
    document.getElementById('qualityValue').textContent = this.settings.capture.screenshotQuality + '%';

    // Security settings
    document.getElementById('encryptData').checked = this.settings.security.encryptData;
    document.getElementById('autoDelete').checked = this.settings.security.autoDelete;
    document.getElementById('maxLocalBugs').value = this.settings.security.maxLocalBugs;

    this.toggleJiraConfig();
  }

  toggleJiraConfig() {
    const enabled = document.getElementById('jiraEnabled').checked;
    const config = document.getElementById('jiraConfig');
    
    if (enabled) {
      config.classList.remove('disabled');
    } else {
      config.classList.add('disabled');
    }
    
    // Atualizar estado dos campos de prioridade quando Jira integration é alterado
    this.updatePriorityFieldsState();
  }

  async saveJiraSettings(event) {
    event.preventDefault();
    
    const button = event.target.querySelector('.btn-save-config');
    const originalHTML = button.innerHTML;
    
    // Validar dados de entrada
    const formData = {
      enabled: document.getElementById('jiraEnabled').checked,
      baseUrl: document.getElementById('jiraUrl').value.trim(),
      email: document.getElementById('jiraEmail').value.trim(),
      apiToken: document.getElementById('jiraApiToken').value.trim(),
      projectKey: document.getElementById('jiraProjectKey').value.trim(),
      issueTypeId: document.getElementById('jiraIssueType').value.trim()
    };
    
    // Schema de validação
    const validationSchema = {
      baseUrl: {
        required: formData.enabled,
        type: 'string',
        minLength: 8,
        pattern: /^https?:\/\/.+/
      },
      email: {
        required: formData.enabled,
        type: 'string',
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      },
      apiToken: {
        required: formData.enabled,
        type: 'string',
        minLength: 10
      },
      projectKey: {
        required: formData.enabled,
        type: 'string',
        minLength: 2,
        maxLength: 10,
        pattern: /^[A-Z][A-Z0-9]*$/
      }
    };
    
    // Usar ErrorHandler para validação se disponível
    if (typeof ErrorHandler !== 'undefined') {
      const errorHandler = new ErrorHandler();
      const validation = errorHandler.validateInput(formData, validationSchema, 'Jira Settings');
      
      if (!validation.isValid) {
        this.showStatus(`❌ ${validation.errors.join(', ')}`, 'error');
        return;
      }
    } else {
      // Validação básica como fallback
      if (formData.enabled) {
        if (!formData.baseUrl || !formData.baseUrl.match(/^https?:\/\/.+/)) {
          this.showStatus('❌ URL do Jira deve ser uma URL válida (http/https)', 'error');
          return;
        }
        if (!formData.email || !formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
          this.showStatus('❌ Email deve ter um formato válido', 'error');
          return;
        }
        if (!formData.apiToken || formData.apiToken.length < 10) {
          this.showStatus('❌ API Token deve ter pelo menos 10 caracteres', 'error');
          return;
        }
        if (!formData.projectKey || !formData.projectKey.match(/^[A-Z][A-Z0-9]*$/)) {
          this.showStatus('❌ Project Key deve começar com letra maiúscula e conter apenas letras e números', 'error');
          return;
        }
      }
    }
    
    button.innerHTML = '<span class="material-icons">sync</span>Saving...';
    button.disabled = true;
    
    try {
      this.settings.jira = {
        ...formData,
        priorities: this.settings.jira.priorities // Manter prioridades existentes
      };
      
      // Salvar prioridades junto com as configurações do Jira
      await this.savePrioritySettings(false); // Não mostrar mensagem individual
      
      await this.saveSettings();
      
      // Mostrar mensagem de sucesso geral
      this.showStatus('✅ Jira settings saved successfully!', 'success');
      
    } catch (error) {
      console.error('Erro ao salvar configurações do Jira:', error);
      this.showStatus('❌ Error saving Jira settings', 'error');
    } finally {
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 1000);
    }
  }

  async saveCaptureSettings() {
    try {
      const captureData = {
        autoCaptureLogs: document.getElementById('autoCaptureLogs').checked,
        screenshotFormat: document.getElementById('screenshotFormat').value,
        maxVideoLength: parseInt(document.getElementById('maxVideoLength').value),
        screenshotQuality: parseInt(document.getElementById('screenshotQuality').value)
      };
      
      // Schema de validação
      const validationSchema = {
        screenshotFormat: {
          required: true,
          type: 'string',
          pattern: /^(png|jpeg)$/
        },
        maxVideoLength: {
          required: true,
          type: 'number',
          min: 10,
          max: 60
        },
        screenshotQuality: {
          required: true,
          type: 'number',
          min: 50,
          max: 100
        }
      };
      
      // Validar dados
      if (typeof ErrorHandler !== 'undefined') {
        const errorHandler = new ErrorHandler();
        const validation = errorHandler.validateInput(captureData, validationSchema, 'Capture Settings');
        
        if (!validation.isValid) {
          this.showStatus(`❌ ${validation.errors.join(', ')}`, 'error');
          return;
        }
      } else {
        // Validação básica
        if (captureData.maxVideoLength < 10 || captureData.maxVideoLength > 60) {
          this.showStatus('❌ Video duration must be between 10 and 60 seconds', 'error');
          return;
        }
        if (captureData.screenshotQuality < 50 || captureData.screenshotQuality > 100) {
          this.showStatus('❌ Image quality must be between 50% and 100%', 'error');
          return;
        }
      }
      
      this.settings.capture = captureData;
      await this.saveSettings();
      this.showStatus('✅ Configurações de captura salvas!', 'success');
    } catch (error) {
      console.error('Erro ao salvar configurações de captura:', error);
      this.showStatus('❌ Erro ao salvar configurações de captura', 'error');
    }
  }

  async saveSecuritySettings() {
    try {
      const securityData = {
        encryptData: document.getElementById('encryptData').checked,
        autoDelete: document.getElementById('autoDelete').checked,
        maxLocalBugs: parseInt(document.getElementById('maxLocalBugs').value)
      };
      
      // Schema de validação
      const validationSchema = {
        maxLocalBugs: {
          required: true,
          type: 'number',
          min: 10,
          max: 1000
        }
      };
      
      // Validar dados
      if (typeof ErrorHandler !== 'undefined') {
        const errorHandler = new ErrorHandler();
        const validation = errorHandler.validateInput(securityData, validationSchema, 'Security Settings');
        
        if (!validation.isValid) {
          this.showStatus(`❌ ${validation.errors.join(', ')}`, 'error');
          return;
        }
      } else {
        // Validação básica
        if (securityData.maxLocalBugs < 10 || securityData.maxLocalBugs > 1000) {
          this.showStatus('❌ Maximum local bugs must be between 10 and 1000', 'error');
          return;
        }
      }
      
      this.settings.security = securityData;
      await this.saveSettings();
      this.showStatus('✅ Configurações de segurança salvas!', 'success');
    } catch (error) {
      console.error('Erro ao salvar configurações de segurança:', error);
      this.showStatus('❌ Erro ao salvar configurações de segurança', 'error');
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.local.set({ settings: this.settings });
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      throw error; // Re-throw para ser capturado pelos métodos específicos
    }
  }

  async testJiraConnection() {
    const button = document.getElementById('testJiraConnection');
    const originalHTML = button.innerHTML;
    
    // Validar campos antes de testar
    const requiredFields = {
      'jiraUrl': 'Jira URL',
      'jiraEmail': 'Email',
      'jiraApiToken': 'API Token',
      'jiraProjectKey': 'Project Key'
    };
    
    for (const [fieldId, fieldName] of Object.entries(requiredFields)) {
      const value = document.getElementById(fieldId).value.trim();
      if (!value) {
        this.showStatus(`❌ Please fill in the field: ${fieldName}`, 'error');
        return;
      }
    }
    
    button.innerHTML = '<span class="material-icons">sync</span>Testing connection...';
    button.disabled = true;
  
    try {
      const jiraConfig = {
        baseUrl: document.getElementById('jiraUrl').value.trim(),
        email: document.getElementById('jiraEmail').value.trim(),
        apiToken: document.getElementById('jiraApiToken').value.trim(),
        projectKey: document.getElementById('jiraProjectKey').value.trim()
      };
  
      // 🆕 Usar background script - ESTA É A CORREÇÃO!
      const response = await chrome.runtime.sendMessage({
        action: 'TEST_JIRA_CONNECTION',
        config: jiraConfig
      });
  
      if (response.success) {
        this.showStatus(`✅ ${response.data.message}`, 'success');
        
        // 🆕 Atualizar prioridades automaticamente se disponíveis
        if (response.data.priorities && response.data.priorities.mapped) {
          await this.updatePrioritiesFromJira(response.data.priorities.mapped);
          this.showStatus(`✅ Connection successful! Priorities updated automatically.`, 'success');
        }
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('Connection test error:', error);
      this.showStatus(`❌ Connection error: ${error.message}`, 'error');
    } finally {
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 1000);
    }
  }

  // Método exportData
  async exportData() {
    const button = document.getElementById('exportData');
    const originalText = button.textContent;
    
    try {
      button.textContent = '📤 Exporting...';
      button.disabled = true;
      
      const data = await chrome.storage.local.get(null);
      const exportData = {
        settings: data.settings,
        bugs: data.bugs,
        exportDate: new Date().toISOString(),
        version: '1.0.0'
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bugspotter-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showStatus('✅ Data exported successfully!', 'success');
    } catch (error) {
      console.error('Erro ao exportar dados:', error);
      this.showStatus('❌ Error exporting data', 'error');
    }
  }

  // Método importData
  async importData() {
    const button = document.getElementById('importData');
    const originalText = button.textContent;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        button.textContent = '📥 Importing...';
        button.disabled = true;
        
        const text = await file.text();
        const importData = JSON.parse(text);
        
        // Validar estrutura do arquivo
        if (!importData.version) {
          throw new Error('Invalid backup file: version not found');
        }

        if (importData.settings) {
          await chrome.storage.local.set({ settings: importData.settings });
        }
        
        if (importData.bugs) {
          await chrome.storage.local.set({ bugs: importData.bugs });
        }

        await this.loadSettings();
        this.updateUI();
        this.showStatus('✅ Data imported successfully!', 'success');
      } catch (error) {
        console.error('Erro ao importar dados:', error);
        if (error instanceof SyntaxError) {
          this.showStatus('❌ Invalid JSON file', 'error');
        } else {
          this.showStatus(`❌ Import error: ${error.message}`, 'error');
        }
      } finally {
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1000);
      }
    };

    input.click();
  }

  // Método clearData
  async clearData() {
    const button = document.getElementById('clearData');
    const originalText = button.textContent;
    
    if (confirm('⚠️ Are you sure you want to clear all data?\n\nThis action will remove:\n• All settings\n• Bug history\n• Cache data\n\nThis action cannot be undone.')) {
      try {
        button.textContent = '🗑️ Clearing...';
        button.disabled = true;
        
        await chrome.storage.local.clear();
        await this.loadSettings();
        this.updateUI();
        this.showStatus('✅ All data has been cleared!', 'info');
      } catch (error) {
        console.error('Erro ao limpar dados:', error);
        this.showStatus('❌ Error clearing data', 'error');
      } finally {
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1000);
      }
    }
  }

  showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    if (!statusElement) {
      console.error('Status element not found');
      return;
    }
    
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    statusElement.style.display = 'block';
    statusElement.style.opacity = '1';
    
    // Log para debug
    console.log(`Status: ${message} (${type})`);
    
    setTimeout(() => {
      statusElement.style.opacity = '0';
      setTimeout(() => {
        statusElement.textContent = '';
        statusElement.className = 'status-message';
        statusElement.style.display = 'none';
      }, 300);
    }, 3000);
  }

  // Novos métodos para gerenciar prioridades
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
    
    const priorityItem = document.createElement('div');
    priorityItem.className = 'priority-item';
    priorityItem.setAttribute('data-priority', newKey);
    
    priorityItem.innerHTML = `
      <input type="text" id="priority${newKey}" placeholder="New Priority" value="New Priority">
      <button type="button" class="btn-remove-priority" title="Remove priority">
        <span class="material-icons">remove_circle</span>
      </button>
    `;
    
    priorityList.appendChild(priorityItem);
    
    // Bind event listeners para o novo botão
    this.bindPriorityRemoveButtons();
    
    // Salvar sem mostrar mensagem
    this.savePrioritySettings(false);
    
    // Remover qualquer mensagem automática se existir
  }

  removePriorityLevel(priorityItem) {
    const priorityList = document.querySelector('.priority-list');
    
    // Don't allow removal if only 2 priorities remain
    if (priorityList.children.length <= 2) {
      this.showStatus('There must be at least 2 priority levels', 'error');
      return;
    }
    
    priorityItem.remove();
    
    // Salvar sem mostrar mensagem
    this.savePrioritySettings(false);
    
    // Remover esta linha para não mostrar mensagem automática
    // this.showStatus('Prioridade removida', 'success');
  }

  resetPriorities() {
    const priorityList = document.querySelector('.priority-list');
    
    priorityList.innerHTML = `
      <div class="priority-item" data-priority="highest">
        <input type="text" id="priorityHighest" placeholder="Highest" value="Highest">
        <button type="button" class="btn-remove-priority" title="Remove priority">
          <span class="material-icons">remove_circle</span>
        </button>
      </div>
      <div class="priority-item" data-priority="high">
        <input type="text" id="priorityHigh" placeholder="High" value="High">
        <button type="button" class="btn-remove-priority" title="Remove priority">
          <span class="material-icons">remove_circle</span>
        </button>
      </div>
      <div class="priority-item" data-priority="medium">
        <input type="text" id="priorityMedium" placeholder="Medium" value="Medium">
        <button type="button" class="btn-remove-priority" title="Remove priority">
          <span class="material-icons">remove_circle</span>
        </button>
      </div>
      <div class="priority-item" data-priority="low">
        <input type="text" id="priorityLow" placeholder="Low" value="Low">
        <button type="button" class="btn-remove-priority" title="Remove priority">
          <span class="material-icons">remove_circle</span>
        </button>
      </div>
      <div class="priority-item" data-priority="lowest">
        <input type="text" id="priorityLowest" placeholder="Lowest" value="Lowest">
        <button type="button" class="btn-remove-priority" title="Remove priority">
          <span class="material-icons">remove_circle</span>
        </button>
      </div>
    `;
    
    // Bind event listeners
    this.bindPriorityRemoveButtons();
    
    // Salvar sem mostrar mensagem
    this.savePrioritySettings(false);
    
    // Remover qualquer mensagem automática se existir
  }

  async savePrioritySettings(showMessage = false) {
    try {
      const priorities = {};
      console.log('🔍 Iniciando salvamento de prioridades...');
      
      document.querySelectorAll('.priority-item').forEach(item => {
        const key = item.getAttribute('data-priority');
        const input = item.querySelector('input');
        if (input && input.value.trim()) {
          priorities[key] = input.value.trim();
          console.log(`✅ Prioridade ${key}: ${input.value.trim()}`);
        }
      });
      
      console.log('📦 Prioridades coletadas:', priorities);
      console.log('⚙️ Settings antes:', JSON.stringify(this.settings.jira.priorities));
      
      this.settings.jira.priorities = priorities;
      console.log('⚙️ Settings depois:', JSON.stringify(this.settings.jira.priorities));
      
      await this.saveSettings();
      console.log('💾 Configurações salvas no storage');
      
      // Verificar se foi salvo corretamente
      const verification = await chrome.storage.local.get(['settings']);
      console.log('🔍 Verificação do storage:', verification.settings?.jira?.priorities);
      
      // Mostrar mensagem apenas se solicitado
      if (showMessage) {
        this.showStatus('Settings saved successfully', 'success');
      }
      
    } catch (error) {
      console.error('❌ Erro ao salvar configurações de prioridade:', error);
      if (showMessage) {
        this.showStatus('Erro ao salvar configurações de prioridade', 'error');
      }
    }
  }

  async loadPriorityUI() {
    const priorityList = document.querySelector('.priority-list');
    if (!priorityList) return;
    
    // Limpar lista atual
    priorityList.innerHTML = '';
    
    // Carregar prioridades das configurações
    const priorities = this.settings.jira.priorities || this.defaultSettings.jira.priorities;
    
    Object.entries(priorities).forEach(([key, value]) => {
      const priorityItem = this.createPriorityItem(key, value);
      priorityList.appendChild(priorityItem);
    });
    
    // Re-bind eventos dos botões de remoção
    this.bindPriorityRemoveButtons();
    
    // 🆕 Verificar se deve desabilitar campos de prioridade
    this.updatePriorityFieldsState();
  }

  createPriorityItem(key, value) {
    const div = document.createElement('div');
    div.className = 'priority-item';
    div.setAttribute('data-priority', key);
    
    div.innerHTML = `
      <input type="text" value="${value}" placeholder="Priority name">
      <button type="button" class="btn-remove-priority" title="Remove priority">
        <span class="material-icons">remove_circle</span>
      </button>
    `;
    
    return div;
  }

  /**
   * Atualiza as prioridades com dados do Jira
   */
  async updatePrioritiesFromJira(jiraPriorities) {
    try {
      // Atualizar configurações
      this.settings.jira.priorities = jiraPriorities;
      this.settings.jira.prioritiesSource = 'jira'; // Marcar como vindo do Jira
      
      // Salvar configurações
      await this.saveSettings();
      
      // Atualizar interface
      await this.loadPriorityUI();
      
      console.log('✅ Prioridades atualizadas do Jira:', jiraPriorities);
    } catch (error) {
      console.error('Erro ao atualizar prioridades do Jira:', error);
      this.showStatus(`❌ Error updating priorities: ${error.message}`, 'error');
    }
  }

  /**
   * Atualiza o estado dos campos de prioridade (habilitado/desabilitado)
   */
  updatePriorityFieldsState() {
    const hasJiraCredentials = this.hasValidJiraCredentials();
    const prioritiesFromJira = this.settings.jira.prioritiesSource === 'jira';
    
    // Desabilitar campos se as prioridades vieram do Jira
    const priorityInputs = document.querySelectorAll('.priority-item input');
    const removeButtons = document.querySelectorAll('.btn-remove-priority');
    const addButton = document.getElementById('addPriority');
    const resetButton = document.getElementById('resetPriorities');
    
    const shouldDisable = hasJiraCredentials && prioritiesFromJira;
    
    priorityInputs.forEach(input => {
      input.disabled = shouldDisable;
      if (shouldDisable) {
        input.title = 'Priorities are automatically managed from Jira';
      } else {
        input.title = '';
      }
    });
    
    removeButtons.forEach(button => {
      button.disabled = shouldDisable;
      if (shouldDisable) {
        button.title = 'Priorities are automatically managed from Jira';
      } else {
        button.title = 'Remove priority';
      }
    });
    
    if (addButton) {
      addButton.disabled = shouldDisable;
      if (shouldDisable) {
        addButton.title = 'Priorities are automatically managed from Jira';
      } else {
        addButton.title = '';
      }
    }
    
    if (resetButton) {
      resetButton.disabled = shouldDisable;
      if (shouldDisable) {
        resetButton.title = 'Priorities are automatically managed from Jira';
      } else {
        resetButton.title = '';
      }
    }
    
    // Adicionar classe CSS para indicar estado desabilitado
    const priorityConfig = document.querySelector('.priority-config');
    if (priorityConfig) {
      if (shouldDisable) {
        priorityConfig.classList.add('jira-managed');
      } else {
        priorityConfig.classList.remove('jira-managed');
      }
    }
  }

  /**
   * Verifica se há credenciais válidas do Jira
   */
  hasValidJiraCredentials() {
    const jiraUrl = document.getElementById('jiraUrl')?.value?.trim();
    const jiraEmail = document.getElementById('jiraEmail')?.value?.trim();
    const jiraApiToken = document.getElementById('jiraApiToken')?.value?.trim();
    const jiraProjectKey = document.getElementById('jiraProjectKey')?.value?.trim();
    
    return jiraUrl && jiraEmail && jiraApiToken && jiraProjectKey;
  }
}

// Inicializa as configurações
new BugSpotterSettings();