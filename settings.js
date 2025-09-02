class BugSpotterSettings {
  constructor() {
    this.defaultSettings = {
      jira: {
        enabled: false,
        baseUrl: 'https://jorgealijo.atlassian.net',
        email: 'jorge.alijo@gmail.com',
        apiToken: '', // Token será inserido pelo usuário
        projectKey: 'BUG',
        issueTypeId: '10035'
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

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      this.settings = { ...this.defaultSettings, ...result.settings };
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
      this.settings = this.defaultSettings;
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
  }

  async saveJiraSettings(event) {
    event.preventDefault();
    
    const submitButton = event.target.querySelector('button[type="submit"]');
    const originalHTML = submitButton.innerHTML; // Usar innerHTML em vez de textContent
    
    // Validação dos campos obrigatórios
    const jiraEnabled = document.getElementById('jiraEnabled').checked;
    
    if (jiraEnabled) {
      const requiredFields = {
        'jiraUrl': 'Jira URL',
        'jiraEmail': 'Email',
        'jiraApiToken': 'API Token',
        'jiraProjectKey': 'Project Key', // Traduzido
        'jiraIssueType': 'Issue Type ID' // Traduzido
      };
      
      for (const [fieldId, fieldName] of Object.entries(requiredFields)) {
        const value = document.getElementById(fieldId).value.trim();
        if (!value) {
          this.showStatus(`❌ Required field: ${fieldName}`, 'error'); // Traduzido
          return;
        }
      }
      
      // Validar formato da URL
      const urlValue = document.getElementById('jiraUrl').value.trim();
      try {
        new URL(urlValue);
      } catch {
        this.showStatus('❌ Invalid Jira URL', 'error'); // Traduzido
        return;
      }
      
      // Validar formato do email
      const emailValue = document.getElementById('jiraEmail').value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailValue)) {
        this.showStatus('❌ Invalid email', 'error'); // Traduzido
        return;
      }
    }
    
    try {
      // Feedback visual - preservar estrutura HTML
      submitButton.innerHTML = '<span class="material-icons">save</span>Saving...'; // Traduzido
      submitButton.disabled = true;
      
      this.settings.jira = {
        enabled: jiraEnabled,
        baseUrl: document.getElementById('jiraUrl').value.trim(),
        email: document.getElementById('jiraEmail').value.trim(),
        apiToken: document.getElementById('jiraApiToken').value.trim(),
        projectKey: document.getElementById('jiraProjectKey').value.trim(),
        issueTypeId: document.getElementById('jiraIssueType').value.trim()
      };

      await this.saveSettings();
      this.showStatus('✅ Jira settings saved successfully!', 'success'); // Traduzido
      
    } catch (error) {
      console.error('Error saving Jira settings:', error); // Traduzido
      this.showStatus('❌ Error saving Jira settings', 'error'); // Traduzido
    } finally {
      // Restaurar HTML original completo
      setTimeout(() => {
        submitButton.innerHTML = originalHTML; // Usar innerHTML
        submitButton.disabled = false;
      }, 1000);
    }
  }

  async saveCaptureSettings() {
    try {
      this.settings.capture = {
        autoCaptureLogs: document.getElementById('autoCaptureLogs').checked,
        screenshotFormat: document.getElementById('screenshotFormat').value,
        maxVideoLength: parseInt(document.getElementById('maxVideoLength').value),
        screenshotQuality: parseInt(document.getElementById('screenshotQuality').value)
      };

      await this.saveSettings();
      this.showStatus('✅ Configurações de captura salvas!', 'success');
    } catch (error) {
      console.error('Erro ao salvar configurações de captura:', error);
      this.showStatus('❌ Erro ao salvar configurações de captura', 'error');
    }
  }

  async saveSecuritySettings() {
    try {
      this.settings.security = {
        encryptData: document.getElementById('encryptData').checked,
        autoDelete: document.getElementById('autoDelete').checked,
        maxLocalBugs: parseInt(document.getElementById('maxLocalBugs').value)
      };

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
    
    // Remove classes anteriores
    statusElement.className = 'status-message';
    statusElement.textContent = message;
    
    // 🆕 CORREÇÃO: Garantir que o elemento seja visível
    statusElement.style.display = 'block';
    
    // Força um reflow para garantir que a animação funcione
    statusElement.offsetHeight;
    
    // Adiciona as novas classes
    statusElement.className = `status-message ${type} show`;
    
    // Auto-hide após 5 segundos com animação suave
    setTimeout(() => {
      statusElement.classList.remove('show');
      
      // Remove completamente após a animação
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 300);
    }, 5000);
  }
}

// Inicializa as configurações
new BugSpotterSettings();