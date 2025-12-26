class BugSpotterSettings {
  constructor() {
    this.defaultSettings = {
      jira: {
        enabled: false,
        baseUrl: '',
        email: '',
        apiToken: '',
        projectKey: '',
        issueTypeId: '10035',
        priorities: {
          highest: 'Highest',
          high: 'High',
          medium: 'Medium',
          low: 'Low',
          lowest: 'Lowest'
        }
      },
      // 🆕 Configuração genérica de sincronização Jira
      jiraSync: {
        enabled: false,
        intervalMinutes: 5,
        jql: '',
        fieldId: 'customfield_12345'
      },
      easyvista: {
        enabled: false,
        baseUrl: '',
        apiKey: ''
      },
      capture: {
        autoCaptureLogs: true,
        screenshotFormat: 'png',
        maxVideoLength: 30,
        screenshotQuality: 90,
        recentLogsWindowSeconds: 30,
        recentLogsLimit: 10
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
        minStatus: 400,
        allowedDomains: ['https://pp.daloop.app/']
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
    
    // 🆕 Cache de API Keys para troca rápida na UI
      this.apiKeys = {
        gemini: '',
        openai: '',
        claude: ''
      };

      this.init();
    }

    async init() {
      await this.loadSettings();
      this.updateUI();
      this.bindEvents();
      this.initTabs();
      // Load performance metrics initially
      this.loadPerformanceMetrics();
      
      // Inicializar o estado das keys na UI
      this.updateAPIKeyInputState();
    }

  initTabs() {
    // Initialize tab functionality
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // Add click event listeners to tab buttons
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });
    
    // Load saved active tab or default to first tab
    const savedTab = localStorage.getItem('bugspotter-active-tab') || 'jira';
    this.switchTab(savedTab);
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

      // Load metrics when switching to Metrics tab
      if (tabName === 'metrics') {
        this.loadPerformanceMetrics();
      }
    }
  }

  bindEvents() {
    // Jira form
    document.getElementById('jiraForm').addEventListener('submit', (e) => this.saveJiraSettings(e));
    document.getElementById('jiraEnabled').addEventListener('change', () => this.toggleJiraConfig());
    document.getElementById('testJiraConnection').addEventListener('click', () => this.testJiraConnection());
    // 🆕 Jira Sync
    const jiraSyncEnabledEl = document.getElementById('jiraSyncEnabled');
    if (jiraSyncEnabledEl) jiraSyncEnabledEl.addEventListener('change', () => this.toggleJiraSyncConfig());
    const jiraSyncNowBtn = document.getElementById('jiraSyncNow');
    if (jiraSyncNowBtn) jiraSyncNowBtn.addEventListener('click', () => this.triggerJiraSyncNow());
    const testSyncBtn = document.getElementById('testJiraSyncCredentials');
    if (testSyncBtn) testSyncBtn.addEventListener('click', () => this.testJiraSyncCredentials());
    const saveSyncBtn = document.getElementById('saveJiraSyncSettings');
    if (saveSyncBtn) saveSyncBtn.addEventListener('click', () => this.saveJiraSyncSettings());

    // EasyVista form
    const evForm = document.getElementById('easyvistaForm');
    if (evForm) evForm.addEventListener('submit', (e) => this.saveEasyVistaSettings(e));
    const evEnabled = document.getElementById('easyvistaEnabled');
    if (evEnabled) evEnabled.addEventListener('change', () => this.toggleEasyVistaConfig());
    const evStatusEnable = document.getElementById('easyvistaStatusSyncEnable');
    if (evStatusEnable) evStatusEnable.addEventListener('change', () => this.toggleEasyVistaStatusSyncConfig());
    // Removido: teste de conexão EasyVista
    
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
  
    // AI settings
    document.getElementById('aiForm').addEventListener('submit', (e) => this.saveAISettings(e));
    document.getElementById('aiEnabled').addEventListener('change', () => this.toggleAIConfig());
    document.getElementById('testAiConnection').addEventListener('click', () => this.testAIConnection());
    
    // Gerenciamento inteligente de providers e keys
    const providerSelect = document.getElementById('aiProvider');
    const apiKeyInput = document.getElementById('aiApiKey');

    // Inicializar tracking do provider atual
    this.currentUiProvider = providerSelect.value || 'gemini';

    providerSelect.addEventListener('focus', () => {
        // Armazenar qual era o provider antes da mudança
        this.currentUiProvider = providerSelect.value;
    });

    providerSelect.addEventListener('change', () => {
        this.handleProviderChange();
    });

    // Atualizar cache local quando usuário digita
    apiKeyInput.addEventListener('input', (e) => {
        const provider = document.getElementById('aiProvider').value;
        this.apiKeys[provider] = e.target.value;
    });

    // Performance metrics refresh
    const refreshBtn = document.getElementById('refreshMetrics');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadPerformanceMetrics());
    }
    
    // Notifications settings
    document.getElementById('notificationsForm').addEventListener('change', () => this.saveNotificationSettings());
    document.getElementById('notificationsEnabled').addEventListener('change', () => this.toggleNotificationsConfig());
    
    // Data management
    document.getElementById('exportData').addEventListener('click', () => this.exportData());
    document.getElementById('importData').addEventListener('click', () => this.importData());
    document.getElementById('clearData').addEventListener('click', () => this.clearData());

    // Submission preferences removidas
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
      // Verificar se estamos no contexto da extensão
      if (typeof chrome !== 'undefined' && chrome.storage) {
        // Carregar configurações do storage local e sync
        const [localResult, syncResult] = await Promise.all([
          chrome.storage.local.get(['settings']),
          chrome.storage.sync.get(['aiEnabled', 'aiProvider', 'aiApiKey', 'aiAutoNotify', 'aiMinStatus', 'aiKeys'])
        ]);
        
        // Carregando configurações do storage - silenciado
        
        if (localResult.settings) {
          // CORREÇÃO: Fazer merge dos padrões primeiro, depois sobrescrever com as configurações salvas
          this.settings = this.deepMerge(this.defaultSettings, localResult.settings);
          // Configurações carregadas - silenciado
        } else {
          this.settings = { ...this.defaultSettings };
          // Usando configurações padrão - silenciado
        }
        
        // Carregar cache de keys
        if (syncResult.aiKeys) {
            this.apiKeys = { ...this.apiKeys, ...syncResult.aiKeys };
        }

        // Carregar configurações de AI do sync storage
        if (syncResult.aiEnabled !== undefined) {
          this.settings.ai = {
            ...this.settings.ai,
            enabled: syncResult.aiEnabled,
            provider: syncResult.aiProvider || 'gemini',
            apiKey: syncResult.aiApiKey || '',
            autoNotify: syncResult.aiAutoNotify || false,
            minStatus: syncResult.aiMinStatus || 400
          };

          // Sincronizar a key ativa com o cache se necessário
          const currentProvider = this.settings.ai.provider;
          if (this.settings.ai.apiKey && !this.apiKeys[currentProvider]) {
             this.apiKeys[currentProvider] = this.settings.ai.apiKey;
          }
        }
      } else {
        // Modo de desenvolvimento - usar configurações padrão
        // Modo de desenvolvimento - silenciado
        this.settings = { ...this.defaultSettings };
      }
      
    } catch (error) {
      console.error('Error loading settings:', error);
      this.settings = { ...this.defaultSettings };
    }
  }

  async loadPerformanceMetrics() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        return;
      }
      const res = await chrome.runtime.sendMessage({ action: 'GET_PERFORMANCE_STATS' });
      if (!res || !res.success) {
        return;
      }
      const stats = res.data || {};
      this.renderMetricCard('jira', stats['jiraSubmission']);
      this.renderMetricCard('ev', stats['easyvistaSubmission']);
    } catch (e) {
      // Silenciar erros na UI de métricas
    }
  }

  renderMetricCard(prefix, stat) {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    if (!stat) {
      setText(`${prefix}Count`, '0');
      setText(`${prefix}SuccessRate`, '0%');
      setText(`${prefix}Avg`, '– ms');
      setText(`${prefix}Median`, '– ms');
      return;
    }
    const toMs = (num) => {
      if (typeof num !== 'number' || Number.isNaN(num)) return '– ms';
      return `${num.toFixed(0)} ms`;
    };
    const toPct = (num) => {
      if (typeof num !== 'number' || Number.isNaN(num)) return '–%';
      return `${num.toFixed(0)}%`;
    };
    setText(`${prefix}Count`, String(stat.totalOperations || 0));
    setText(`${prefix}SuccessRate`, toPct(stat.successRate));
    setText(`${prefix}Avg`, toMs(stat.avgDuration));
    setText(`${prefix}Median`, toMs(stat.medianDuration));
  }

  updateUI() {
    // Jira settings
    document.getElementById('jiraEnabled').checked = this.settings.jira.enabled;
    document.getElementById('jiraUrl').value = this.settings.jira.baseUrl;
    document.getElementById('jiraEmail').value = this.settings.jira.email;
    document.getElementById('jiraApiToken').value = this.settings.jira.apiToken;
    document.getElementById('jiraProjectKey').value = this.settings.jira.projectKey;
    document.getElementById('jiraIssueType').value = this.settings.jira.issueTypeId;

    // 🆕 Jira Sync UI
    const syncEnabledEl = document.getElementById('jiraSyncEnabled');
    const syncIntervalEl = document.getElementById('jiraSyncInterval');
    const syncJQLEl = document.getElementById('jiraSyncJQL');
    const syncFieldEl = document.getElementById('jiraSyncFieldId');
    if (syncEnabledEl) syncEnabledEl.checked = !!this.settings.jiraSync?.enabled;
    if (syncIntervalEl) syncIntervalEl.value = this.settings.jiraSync?.intervalMinutes ?? 5;
    if (syncJQLEl) syncJQLEl.value = this.settings.jiraSync?.jql ?? '';
    if (syncFieldEl) syncFieldEl.value = this.settings.jiraSync?.fieldId ?? 'customfield_12345';
    // 🆕 Jira Sync credential overrides
    const syncEmailEl = document.getElementById('jiraSyncEmail');
    if (syncEmailEl) syncEmailEl.value = this.settings.jiraSync?.email || '';
    const syncTokenEl = document.getElementById('jiraSyncApiToken');
    if (syncTokenEl) syncTokenEl.value = this.settings.jiraSync?.apiToken || '';
    const syncProjectEl = document.getElementById('jiraSyncProjectKey');
    if (syncProjectEl) syncProjectEl.value = this.settings.jiraSync?.projectKey || '';
    this.loadJiraSyncStatus();

    // Load priority settings
    this.loadPriorityUI();

    // EasyVista settings
    const evEnabled = document.getElementById('easyvistaEnabled');
    if (evEnabled) evEnabled.checked = this.settings.easyvista.enabled;
    const evUrl = document.getElementById('easyvistaUrl');
    if (evUrl) evUrl.value = this.settings.easyvista.baseUrl || '';
    const evApiKey = document.getElementById('easyvistaApiKey');
    if (evApiKey) evApiKey.value = this.settings.easyvista.apiKey || '';
    // Campo Catalog GUID removido

    // 🆕 EasyVista Status Sync settings
    const evStatusEnableEl = document.getElementById('easyvistaStatusSyncEnable');
    if (evStatusEnableEl) evStatusEnableEl.checked = !!this.settings.easyvista?.statusSync?.enabled;
    const evUpdateTplEl = document.getElementById('easyvistaUpdateUrlTemplate');
    if (evUpdateTplEl) evUpdateTplEl.value = this.settings.easyvista?.statusSync?.updateUrlTemplate || '';
    const evMappingEl = document.getElementById('easyvistaFieldMapping');
    if (evMappingEl) {
      const fm = this.settings.easyvista?.statusSync?.fieldMapping || {};
      try {
        evMappingEl.value = Object.keys(fm).length ? JSON.stringify(fm, null, 2) : '';
      } catch (_) {
        evMappingEl.value = '';
      }
    }

    // Capture settings
    document.getElementById('autoCaptureLogs').checked = this.settings.capture.autoCaptureLogs;
    document.getElementById('screenshotFormat').value = this.settings.capture.screenshotFormat;
    document.getElementById('maxVideoLength').value = this.settings.capture.maxVideoLength;
    document.getElementById('screenshotQuality').value = this.settings.capture.screenshotQuality;
    document.getElementById('qualityValue').textContent = this.settings.capture.screenshotQuality + '%';
    // 🆕 Recent logs parameters
    const winSecondsInput = document.getElementById('recentLogsWindowSeconds');
    const limitInput = document.getElementById('recentLogsLimit');
    if (winSecondsInput) winSecondsInput.value = this.settings.capture.recentLogsWindowSeconds ?? 30;
    if (limitInput) limitInput.value = this.settings.capture.recentLogsLimit ?? 10;

    // Security settings
    document.getElementById('encryptData').checked = this.settings.security.encryptData;
    document.getElementById('autoDelete').checked = this.settings.security.autoDelete;
    document.getElementById('maxLocalBugs').value = this.settings.security.maxLocalBugs;

    // AI settings
    document.getElementById('aiEnabled').checked = this.settings.ai.enabled;
    document.getElementById('aiProvider').value = this.settings.ai.provider;
    document.getElementById('aiApiKey').value = this.settings.ai.apiKey;
    document.getElementById('aiAutoNotify').checked = this.settings.ai.autoNotify;
    document.getElementById('aiMinStatus').value = this.settings.ai.minStatus;
    const aiAllowedDomainsEl = document.getElementById('aiAllowedDomains');
    if (aiAllowedDomainsEl) {
      aiAllowedDomainsEl.value = (this.settings.ai.allowedDomains || []).join('\n');
    }

    // Notifications settings
    document.getElementById('notificationsEnabled').checked = this.settings.notifications.enabled;
    document.getElementById('aiReportsNotifications').checked = this.settings.notifications.aiReports;
    document.getElementById('httpErrorsNotifications').checked = this.settings.notifications.httpErrors;
    document.getElementById('criticalOnlyNotifications').checked = this.settings.notifications.criticalOnly;
    document.getElementById('errorThreshold').value = this.settings.notifications.errorThreshold;
    document.getElementById('notificationSound').checked = this.settings.notifications.sound;

    // Submission preferences removidas

    // Update config visibility
    this.toggleJiraConfig();
    this.toggleJiraSyncConfig();
    this.toggleEasyVistaConfig();
    this.toggleEasyVistaStatusSyncConfig();
    this.toggleAIConfig();
    this.toggleNotificationsConfig();
    this.updateAPIKeyHelp();
    this.updateAIStatus();
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

  toggleEasyVistaConfig() {
    const enabled = document.getElementById('easyvistaEnabled')?.checked;
    const config = document.getElementById('easyvistaConfig');
    if (!config) return;
    if (enabled) {
      config.classList.remove('disabled');
    } else {
      config.classList.add('disabled');
    }
  }

  // 🆕 Mostrar/ocultar configuração de status sync do EasyVista
  toggleEasyVistaStatusSyncConfig() {
    const enabled = document.getElementById('easyvistaStatusSyncEnable')?.checked;
    const config = document.getElementById('easyvistaStatusSyncConfig');
    if (!config) return;
    if (enabled) {
      config.classList.remove('disabled');
    } else {
      config.classList.add('disabled');
    }
  }

  // 🆕 Mostrar/ocultar configuração de sincronização Jira
  toggleJiraSyncConfig() {
    const enabled = document.getElementById('jiraSyncEnabled')?.checked;
    const config = document.getElementById('jiraSyncConfig');
    if (!config) return;
    if (enabled) {
      config.classList.remove('disabled');
    } else {
      config.classList.add('disabled');
    }
  }

  async triggerJiraSyncNow() {
    try {
      const statusEl = document.getElementById('jiraSyncStatus');
      if (statusEl) statusEl.textContent = 'Running sync...';
      const response = await chrome.runtime.sendMessage({ action: 'JIRA_SYNC_NOW' });
      if (response.success) {
        const summary = response.data;
        await chrome.storage.local.set({ jiraSyncLastResult: summary });
        if (statusEl) statusEl.textContent = `Last sync: ${new Date(summary.timestamp).toLocaleString()} • Checked ${summary.checked} • Missing field: ${summary.missingFieldCount}`;
        this.showStatus('✅ Jira sync completed', 'success');
      } else {
        if (statusEl) statusEl.textContent = `Error: ${response.error}`;
        this.showStatus(`❌ Jira sync error: ${response.error}`, 'error');
      }
    } catch (error) {
      const statusEl = document.getElementById('jiraSyncStatus');
      if (statusEl) statusEl.textContent = `Error: ${error.message}`;
      this.showStatus(`❌ Jira sync error: ${error.message}`, 'error');
    }
  }

  async loadJiraSyncStatus() {
    try {
      const data = await chrome.storage.local.get(['jiraSyncLastResult']);
      const statusEl = document.getElementById('jiraSyncStatus');
      const summary = data.jiraSyncLastResult;
      if (statusEl) {
        if (summary) {
          statusEl.textContent = `Last sync: ${new Date(summary.timestamp).toLocaleString()} • Checked ${summary.checked} • Missing field: ${summary.missingFieldCount}`;
        } else {
          statusEl.textContent = '';
        }
      }
    } catch (error) {
      // silenciar
    }
  }

  async saveJiraSyncSettings() {
    const button = document.getElementById('saveJiraSyncSettings');
    const originalHTML = button ? button.innerHTML : '';

    // Coletar dados do Sync
    const jiraSyncData = {
      enabled: document.getElementById('jiraSyncEnabled')?.checked || false,
      intervalMinutes: parseInt(document.getElementById('jiraSyncInterval')?.value || '5', 10),
      jql: document.getElementById('jiraSyncJQL')?.value?.trim() || '',
      fieldId: document.getElementById('jiraSyncFieldId')?.value?.trim() || 'customfield_12345',
      email: document.getElementById('jiraSyncEmail')?.value?.trim() || '',
      apiToken: document.getElementById('jiraSyncApiToken')?.value?.trim() || '',
      projectKey: document.getElementById('jiraSyncProjectKey')?.value?.trim() || ''
    };

    // Validação básica do Sync
    if (jiraSyncData.enabled) {
      if (!Number.isFinite(jiraSyncData.intervalMinutes) || jiraSyncData.intervalMinutes < 1) {
        this.showStatus('❌ Sync interval must be at least 1 minute', 'error');
        return;
      }
      if (!jiraSyncData.fieldId) {
        this.showStatus('❌ Please set a customfield ID for EasyVista link', 'error');
        return;
      }
      const hasAnyOverride = !!(jiraSyncData.email || jiraSyncData.apiToken || jiraSyncData.projectKey);
      const hasCredOverride = !!(jiraSyncData.email && jiraSyncData.apiToken);
      if (hasAnyOverride && !hasCredOverride) {
        this.showStatus('❌ If using Jira Sync credential overrides, provide both email and API token', 'error');
        return;
      }
    }

    if (button) {
      button.innerHTML = '<span class="material-icons">sync</span>Saving...';
      button.disabled = true;
    }

    try {
      this.settings.jiraSync = { ...jiraSyncData };
      await this.saveSettings();
      this.showStatus('✅ Jira Sync settings saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving Jira Sync settings:', error);
      this.showStatus('❌ Error saving Jira Sync settings', 'error');
    } finally {
      if (button) {
        setTimeout(() => {
          button.innerHTML = originalHTML;
          button.disabled = false;
        }, 800);
      }
    }
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

    // 🆕 Dados de sincronização Jira (genéricos)
    const jiraSyncData = {
      enabled: document.getElementById('jiraSyncEnabled')?.checked || false,
      intervalMinutes: parseInt(document.getElementById('jiraSyncInterval')?.value || '5', 10),
      jql: document.getElementById('jiraSyncJQL')?.value?.trim() || '',
      fieldId: document.getElementById('jiraSyncFieldId')?.value?.trim() || 'customfield_12345',
      // 🆕 Optional overrides
      email: document.getElementById('jiraSyncEmail')?.value?.trim() || '',
      apiToken: document.getElementById('jiraSyncApiToken')?.value?.trim() || '',
      projectKey: document.getElementById('jiraSyncProjectKey')?.value?.trim() || ''
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
    // 🆕 Validação básica para sincronização
    if (jiraSyncData.enabled) {
      if (!Number.isFinite(jiraSyncData.intervalMinutes) || jiraSyncData.intervalMinutes < 1) {
        this.showStatus('❌ Sync interval must be at least 1 minute', 'error');
        return;
      }
      if (!jiraSyncData.fieldId) {
        this.showStatus('❌ Please set a customfield ID for EasyVista link', 'error');
        return;
      }
      // Se overrides forem parcialmente preenchidos, validar consistência
      const hasAnyOverride = !!(jiraSyncData.email || jiraSyncData.apiToken || jiraSyncData.projectKey);
      const hasCredOverride = !!(jiraSyncData.email && jiraSyncData.apiToken);
      if (hasAnyOverride && !hasCredOverride) {
        this.showStatus('❌ If using Jira Sync credential overrides, provide both email and API token', 'error');
        return;
      }
      // ProjectKey override é opcional
    }
    
    button.innerHTML = '<span class="material-icons">sync</span>Saving...';
    button.disabled = true;
    
    try {
      this.settings.jira = {
        ...formData,
        priorities: this.settings.jira.priorities // Manter prioridades existentes
      };
      // 🆕 Persistir configuração genérica de sincronização
      this.settings.jiraSync = { ...jiraSyncData };
      
      // Salvar prioridades junto com as configurações do Jira
      await this.savePrioritySettings(false); // Não mostrar mensagem individual
      
      await this.saveSettings();
      
      // Mostrar mensagem de sucesso geral
      this.showStatus('✅ Jira settings saved successfully!', 'success');
      
    } catch (error) {
      console.error('Error saving Jira settings:', error);
      this.showStatus('❌ Error saving Jira settings', 'error');
    } finally {
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 1000);
    }
  }

  async saveEasyVistaSettings(event) {
    event.preventDefault();

    const button = event.target.querySelector('.btn-save-config');
    const originalHTML = button.innerHTML;

    const formData = {
      enabled: document.getElementById('easyvistaEnabled').checked,
      baseUrl: document.getElementById('easyvistaUrl').value.trim(),
      apiKey: document.getElementById('easyvistaApiKey').value.trim()
    };

    const statusSyncEnabled = document.getElementById('easyvistaStatusSyncEnable')?.checked || false;
    const updateUrlTemplate = document.getElementById('easyvistaUpdateUrlTemplate')?.value?.trim() || '';
    const mappingText = document.getElementById('easyvistaFieldMapping')?.value?.trim() || '';
    let fieldMapping = {};
    if (mappingText) {
      try {
        const parsed = JSON.parse(mappingText);
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          this.showStatus('❌ Field Mapping must be a JSON object', 'error');
          return;
        }
        // Validar que valores são strings (IDs de campos do Jira)
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k !== 'string' || typeof v !== 'string') {
            this.showStatus('❌ Field Mapping keys and values must be strings', 'error');
            return;
          }
        }
        fieldMapping = parsed;
      } catch (e) {
        this.showStatus('❌ Field Mapping must be valid JSON', 'error');
        return;
      }
    }

    // Validação básica
    if (formData.enabled) {
      if (!formData.baseUrl || !/^https?:\/\/.+/.test(formData.baseUrl)) {
        this.showStatus('❌ EasyVista URL must be a valid http/https URL', 'error');
        return;
      }
      if (!formData.apiKey || formData.apiKey.length < 8) {
        this.showStatus('❌ API key must be at least 8 characters long', 'error');
        return;
      }
    }

    // Validação para status sync
    if (statusSyncEnabled) {
      if (!updateUrlTemplate || !updateUrlTemplate.includes('{id}')) {
        this.showStatus('❌ Update URL Template must include {id}', 'error');
        return;
      }
      // Se sync estiver ativo, exigir configuração geral do EV
      if (!formData.baseUrl || !formData.apiKey) {
        this.showStatus('❌ Configure EasyVista Base URL and Access Token to enable status sync', 'error');
        return;
      }
    }

    button.innerHTML = '<span class="material-icons">sync</span>Saving...';
    button.disabled = true;

    try {
      this.settings.easyvista = {
        ...formData,
        statusSync: {
          enabled: statusSyncEnabled,
          updateUrlTemplate,
          fieldMapping
        }
      };
     await this.saveSettings();
     this.showStatus('✅ EasyVista settings saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving EasyVista settings:', error);
      this.showStatus('❌ Error saving EasyVista settings', 'error');
    } finally {
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 800);
    }
  }

  async saveCaptureSettings() {
    try {
      const captureData = {
        autoCaptureLogs: document.getElementById('autoCaptureLogs').checked,
        screenshotFormat: document.getElementById('screenshotFormat').value,
        maxVideoLength: parseInt(document.getElementById('maxVideoLength').value),
        screenshotQuality: parseInt(document.getElementById('screenshotQuality').value),
        recentLogsWindowSeconds: parseInt(document.getElementById('recentLogsWindowSeconds').value),
        recentLogsLimit: parseInt(document.getElementById('recentLogsLimit').value)
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
        },
        recentLogsWindowSeconds: {
          required: true,
          type: 'number',
          min: 30,
          max: 120
        },
        recentLogsLimit: {
          required: true,
          type: 'number',
          min: 10,
          max: 50
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
        if (captureData.recentLogsWindowSeconds < 30 || captureData.recentLogsWindowSeconds > 120) {
          this.showStatus('❌ Recent logs window must be between 30 and 120 seconds', 'error');
          return;
        }
        if (captureData.recentLogsLimit < 10 || captureData.recentLogsLimit > 50) {
          this.showStatus('❌ Recent logs limit must be between 10 and 50 entries', 'error');
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
      this.showStatus('✅ Security settings saved!', 'success');
    } catch (error) {
      console.error('Error saving security settings:', error);
      this.showStatus('❌ Error saving security settings', 'error');
    }
  }

  async saveSettings() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ settings: this.settings });
      } else {
        // Modo de desenvolvimento - silenciado
      }
    } catch (error) {
      console.error('Error saving settings:', error);
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

  // testEasyVistaConnection removido

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
      console.error('Error exporting data:', error);
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
        console.error('Error importing data:', error);
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
        console.error('Error clearing data:', error);
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
    // Status message - silenciado
    
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
      // Iniciando salvamento de prioridades - silenciado
      
      document.querySelectorAll('.priority-item').forEach(item => {
        const key = item.getAttribute('data-priority');
        const input = item.querySelector('input');
        if (input && input.value.trim()) {
          priorities[key] = input.value.trim();
          // Prioridade coletada - silenciado
        }
      });
      
      // Prioridades coletadas - silenciado
      // Settings antes - silenciado
      
      this.settings.jira.priorities = priorities;
      // Settings depois - silenciado
      
      await this.saveSettings();
      // Configurações salvas no storage - silenciado
      
      // Verificar se foi salvo corretamente
      const verification = await chrome.storage.local.get(['settings']);
      // Verificação do storage - silenciado
      
      // Mostrar mensagem apenas se solicitado
      if (showMessage) {
        this.showStatus('Settings saved successfully', 'success');
      }
      
    } catch (error) {
      console.error('❌ Error saving priority settings:', error);
      if (showMessage) {
        this.showStatus('❌ Error saving priority settings', 'error');
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
      
      // Prioridades atualizadas do Jira - silenciado
    } catch (error) {
      console.error('Error updating Jira priorities:', error);
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

  // ===== AI METHODS =====
  
  toggleAIConfig() {
    const enabled = document.getElementById('aiEnabled').checked;
    const config = document.getElementById('aiConfig');
    
    if (enabled) {
      config.classList.remove('disabled');
    } else {
      config.classList.add('disabled');
    }
    
    this.updateAIStatus();
  }
  
  handleProviderChange() {
    const providerSelect = document.getElementById('aiProvider');
    const apiKeyInput = document.getElementById('aiApiKey');
    const newProvider = providerSelect.value;
    
    // Salvar key do provider anterior (caso o evento de input não tenha pego algo ou para garantir)
    if (this.currentUiProvider && this.currentUiProvider !== newProvider) {
       // A key já deve estar atualizada pelo evento 'input', mas vamos garantir
       // Nota: Não lemos do input aqui porque ele já pode ter mudado se não formos cuidadosos,
       // mas no evento 'change' o valor do input ainda é o antigo? Não, o input não muda sozinho.
       // O input ainda tem o valor que o usuário digitou.
       this.apiKeys[this.currentUiProvider] = apiKeyInput.value;
    }

    // Atualizar input com a key do novo provider
    apiKeyInput.value = this.apiKeys[newProvider] || '';
    
    // Atualizar referência do provider atual
    this.currentUiProvider = newProvider;

    // Atualizar texto de ajuda
    this.updateAPIKeyHelp();
  }

  updateAPIKeyInputState() {
      // Chamado no init para setar o valor inicial correto
      const provider = document.getElementById('aiProvider').value;
      if (this.apiKeys[provider]) {
          document.getElementById('aiApiKey').value = this.apiKeys[provider];
      }
      this.currentUiProvider = provider;
      this.updateAPIKeyHelp();
  }
  
  updateAPIKeyHelp() {
    const provider = document.getElementById('aiProvider').value;
    const helpElement = document.getElementById('apiKeyHelp');
    
    const helpTexts = {
      gemini: 'Get your free API key at: <a href="https://makersuite.google.com/app/apikey" target="_blank">Google AI Studio</a>',
      openai: 'Get your API key at: <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a>',
      claude: 'Get your API key at: <a href="https://console.anthropic.com/" target="_blank">Anthropic Console</a>'
    };
    
    helpElement.innerHTML = helpTexts[provider] || helpTexts.gemini;
  }
  
  updateAIStatus() {
    const enabled = document.getElementById('aiEnabled').checked;
    const apiKey = document.getElementById('aiApiKey').value;
    const statusIcon = document.querySelector('.status-icon');
    const statusText = document.querySelector('.status-text');
    
    // Reset classes
    statusIcon.classList.remove('connected', 'error', 'warning');
    
    if (!enabled) {
      statusIcon.classList.add('error');
      statusText.textContent = 'Disabled';
    } else if (!apiKey) {
      statusIcon.classList.add('warning');
      statusText.textContent = 'API Key required';
    } else {
      statusIcon.classList.add('connected');
      statusText.textContent = 'Configured';
    }
  }
  
  async saveAISettings(event) {
    event.preventDefault();
    
    try {
      // Ensure current input is in the keys object
      const currentProvider = document.getElementById('aiProvider').value;
      const currentKey = document.getElementById('aiApiKey').value;
      this.apiKeys[currentProvider] = currentKey;

      // Collect AI settings
      const aiSettings = {
        enabled: document.getElementById('aiEnabled').checked,
        provider: currentProvider,
        apiKey: currentKey,
        autoNotify: document.getElementById('aiAutoNotify').checked,
        minStatus: parseInt(document.getElementById('aiMinStatus').value)
      };
      // Collect allowed domains (one per line)
      const allowedDomainsStr = (document.getElementById('aiAllowedDomains')?.value || '').trim();
      const allowedDomains = allowedDomainsStr
        .split(/\n|,/) // support newline or comma
        .map(s => s.trim())
        .filter(Boolean);
      aiSettings.allowedDomains = allowedDomains;
      // Legacy fallback: if single domain, set domainFilter for backward compatibility
      aiSettings.domainFilter = allowedDomains.length === 1 ? allowedDomains[0] : '';
      
      // Update settings object
      this.settings.ai = { ...this.settings.ai, ...aiSettings };
      
      // Save only if we're in extension context
      if (typeof chrome !== 'undefined' && chrome.storage) {
        // Save to both storages for consistency
        await Promise.all([
          // Save to sync storage (for cross-device sync)
          new Promise((resolve) => {
            chrome.storage.sync.set({ 
              aiEnabled: aiSettings.enabled,
              aiProvider: aiSettings.provider,
              aiApiKey: aiSettings.apiKey,
              aiKeys: this.apiKeys,
              aiAutoNotify: aiSettings.autoNotify,
              aiMinStatus: aiSettings.minStatus
            }, resolve);
          }),
          // Save to local storage (for consistency with other settings)
          this.saveSettings()
        ]);
        
        // Notify background script about AI settings change
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'AI_SETTINGS_UPDATED',
            settings: aiSettings
          });
        }
      } else {
        // Modo de desenvolvimento - silenciado
      }
      
      // Update UI
      this.updateAIStatus();
      
      this.showStatus('AI settings saved successfully!', 'success');
      
    } catch (error) {
      console.error('Error saving AI settings:', error);
      this.showStatus('Error saving AI settings', 'error');
    }
  }
  
  async testAIConnection() {
    const button = document.getElementById('testAiConnection');
    const originalText = button.innerHTML;
    
    try {
      // Update button state
      button.classList.add('testing');
      button.innerHTML = '<span class="material-icons">hourglass_empty</span>Testing...';
      button.disabled = true;
      
      // Get current settings
      const provider = document.getElementById('aiProvider').value;
      const apiKey = document.getElementById('aiApiKey').value;
      
      if (!apiKey) {
        throw new Error('API Key is required');
      }
      
      // Create temporary AIService instance for testing
      const testData = {
        url: 'https://example.com/api/test',
        method: 'GET',
        status: 404,
        statusText: 'Not Found',
        timestamp: new Date().toISOString(),
        headers: { 'content-type': 'application/json' },
        responseBody: 'Test error for AI connection',
        userAgent: navigator.userAgent
      };
      
      // Test connection by sending a simple request
    let response;
    if (provider === 'claude') {
      response = await this.testClaudeConnection(apiKey, testData);
    } else if (provider === 'openai') {
      response = await this.testOpenAIConnection(apiKey, testData);
    } else {
      response = await this.testGeminiConnection(apiKey, testData);
    }
      
      this.showStatus('AI connection successful! Generated test report.', 'success');
      
      // Update status
      const statusIcon = document.querySelector('.status-icon');
      const statusText = document.querySelector('.status-text');
      statusIcon.classList.remove('error', 'warning');
      statusIcon.classList.add('connected');
      statusText.textContent = 'Connected';
      
    } catch (error) {
      console.error('AI connection test failed:', error);
      this.showStatus('AI connection failed: ' + error.message, 'error');
      
      // Update status
      const statusIcon = document.querySelector('.status-icon');
      const statusText = document.querySelector('.status-text');
      statusIcon.classList.remove('connected', 'warning');
      statusIcon.classList.add('error');
      statusText.textContent = 'Connection failed';
      
    } finally {
      // Reset button state
      button.classList.remove('testing');
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }
  
  async testGeminiConnection(apiKey, testData, retryCount = 0, modelOverride = null) {
    const maxRetries = 0;
    const baseDelay = 2000; // 2 seconds
 
    const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const modelToUse = modelOverride || 'gemini-2.0-flash';
  
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${apiKey}`;
  
    const prompt = `Test connection. Respond with valid JSON: {"status": "ok", "message": "Connection successful"}`;
  
    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 1,
        maxOutputTokens: 100,
        responseMimeType: 'application/json'
      }
    };
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
  
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
 
        // Handle model not found/unsupported
        if (response.status === 404) {
          throw new Error(`Model not found or unsupported for generateContent: ${modelToUse}`);
        }
 
        // For 503 and 429 errors, try to retry
        if ((response.status === 503 || response.status === 429) && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
          // Retrying connection - silenciado
  
          // Update UI to show retry status
          this.showStatus(`Service overloaded. Retrying in ${delay/1000} seconds... (${retryCount + 1}/${maxRetries})`, 'warning');
  
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.testGeminiConnection(apiKey, testData, retryCount + 1, modelToUse);
        }
  
        let errorMessage;
        switch (response.status) {
          case 400:
            errorMessage = 'Invalid API request. Please check your API key and try again.';
            break;
          case 401:
            errorMessage = 'Invalid API key. Please check your Google AI API key.';
            break;
          case 403:
            errorMessage = 'API access forbidden. Please verify your API key permissions.';
            break;
          case 429:
            errorMessage = retryCount >= maxRetries ? 
              'Rate limit exceeded. Please wait longer before trying again.' :
              'Rate limit exceeded. Please wait a moment and try again.';
            break;
          case 503:
            errorMessage = retryCount >= maxRetries ? 
              'AI service is overloaded. Please try again later.' :
              'AI service is temporarily overloaded. Please try again in a few moments.';
            break;
          default:
            errorMessage = errorData.error?.message || `API Error: ${response.status} - ${response.statusText}`;
        }
  
        throw new Error(errorMessage);
      }
  
      const data = await response.json();
  
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response from AI service');
      }
  
      return data.candidates[0].content.parts[0].text;
  
      } catch (error) {
        // If it's a network error and we haven't exceeded retries, try again
        if (error.name === 'TypeError' && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          // Network error retrying - silenciado
  
        this.showStatus(`Network error. Retrying in ${delay/1000} seconds... (${retryCount + 1}/${maxRetries})`, 'warning');
  
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.testGeminiConnection(apiKey, testData, retryCount + 1, modelToUse);
      }
  
      throw error;
    }
  }

  async testClaudeConnection(apiKey, testData, retryCount = 0) {
    const maxRetries = 0;
    const baseDelay = 2000;
    const modelToUse = 'claude-3-haiku-20240307';
    const url = 'https://api.anthropic.com/v1/messages';

    const prompt = `Test connection. Respond with valid JSON: {"status": "ok", "message": "Connection successful"}`;

    const requestBody = {
        model: modelToUse,
        max_tokens: 100,
        temperature: 0.1,
        system: "You are a QA assistant. Return ONLY valid JSON.",
        messages: [
            {
                role: "user",
                content: prompt
            }
        ]
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Retry logic for 429/503
        if ((response.status === 503 || response.status === 429) && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          this.showStatus(`Service overloaded. Retrying in ${delay/1000} seconds... (${retryCount + 1}/${maxRetries})`, 'warning');
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.testClaudeConnection(apiKey, testData, retryCount + 1);
        }

        let errorMessage;
        switch (response.status) {
          case 401:
            errorMessage = 'Invalid API key. Please check your Anthropic API key.';
            break;
          case 403:
            errorMessage = 'API access forbidden. Please verify your API key permissions.';
            break;
          case 429:
            errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
            break;
          case 503:
            errorMessage = 'Claude service is temporarily overloaded.';
            break;
          default:
            errorMessage = errorData.error?.message || `API Error: ${response.status} - ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (!data.content || !data.content[0] || !data.content[0].text) {
        throw new Error('Invalid response from Claude API');
      }

      return data.content[0].text;

    } catch (error) {
      if (error.name === 'TypeError' && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount);
        this.showStatus(`Network error. Retrying in ${delay/1000} seconds... (${retryCount + 1}/${maxRetries})`, 'warning');
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.testClaudeConnection(apiKey, testData, retryCount + 1);
      }
      throw error;
    }
  }

  async testOpenAIConnection(apiKey, testData, retryCount = 0) {
    const maxRetries = 0;
    const baseDelay = 2000;
    // Use gpt-4o-mini as a more widely available and cost-effective default
    const modelToUse = 'gpt-4o-mini';
    const url = 'https://api.openai.com/v1/chat/completions';

    const prompt = `Test connection. Respond with valid JSON: {"status": "ok", "message": "Connection successful"}`;

    const requestBody = {
        model: modelToUse,
        messages: [
            {
                role: "system",
                content: "You are a QA assistant. Return ONLY valid JSON."
            },
            {
                role: "user",
                content: prompt
            }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
    };

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      // Adicionar OpenAI-Project se disponível nas configurações
      // Por enquanto hardcoded como 'bugspotter' conforme pedido, mas idealmente configurável
      // O usuário mencionou "bugspotter", mas vamos garantir que seja passado se necessário
      // Como não temos input para isso ainda, vamos adicionar fixo ou verificar se precisamos de input
      // O usuário disse: "tenho o nome do projeto que desconfio que tem que ser passado" -> "bugspotter"
      headers['OpenAI-Project'] = 'bugspotter';

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Retry logic for 429/503
        if ((response.status === 503 || response.status === 429) && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          this.showStatus(`Service overloaded. Retrying in ${delay/1000} seconds... (${retryCount + 1}/${maxRetries})`, 'warning');
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.testOpenAIConnection(apiKey, testData, retryCount + 1);
        }

        let errorMessage;
        switch (response.status) {
          case 401:
            errorMessage = 'Invalid API key. Please check your OpenAI API key.';
            break;
          case 403:
            errorMessage = 'API access forbidden. Please verify your API key permissions.';
            break;
          case 429:
            errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
            break;
          case 503:
            errorMessage = 'OpenAI service is temporarily overloaded.';
            break;
          default:
            errorMessage = errorData.error?.message || `API Error: ${response.status} - ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        throw new Error('Invalid response from OpenAI API');
      }

      return data.choices[0].message.content;

    } catch (error) {
      if (error.name === 'TypeError' && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount);
        this.showStatus(`Network error. Retrying in ${delay/1000} seconds... (${retryCount + 1}/${maxRetries})`, 'warning');
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.testOpenAIConnection(apiKey, testData, retryCount + 1);
      }
      throw error;
    }
  }

  async testJiraSyncCredentials() {
    const button = document.getElementById('testJiraSyncCredentials');
    if (!button) {
      this.showStatus('❌ Test button not found', 'error');
      return;
    }
    const originalHTML = button.innerHTML;

    // Coletar overrides
    const baseUrl = document.getElementById('jiraUrl').value.trim(); // Base URL vem da integração Jira
    const email = document.getElementById('jiraSyncEmail')?.value?.trim() || '';
    const apiToken = document.getElementById('jiraSyncApiToken')?.value?.trim() || '';
    const projectKey = document.getElementById('jiraSyncProjectKey')?.value?.trim() || document.getElementById('jiraProjectKey')?.value?.trim() || '';

    // Validar requerimentos
    if (!baseUrl || !/^https?:\/\/.+/.test(baseUrl)) {
      this.showStatus('❌ Jira Base URL must be a valid http/https URL', 'error');
      return;
    }
    if (!email || !apiToken) {
      this.showStatus('❌ Provide Email and API Token overrides for Jira Sync', 'error');
      return;
    }
    if (!projectKey) {
      this.showStatus('❌ Project Key is required (override or main)', 'error');
      return;
    }

    button.innerHTML = '<span class="material-icons">sync</span>Testing sync credentials...';
    button.disabled = true;

    try {
      const jiraConfig = { baseUrl, email, apiToken, projectKey };
      const response = await chrome.runtime.sendMessage({ action: 'TEST_JIRA_CONNECTION', config: jiraConfig });
      if (response.success) {
        this.showStatus(`✅ ${response.data.message} (Sync overrides)`, 'success');
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('Sync credentials test error:', error);
      this.showStatus(`❌ Sync credentials error: ${error.message}`, 'error');
    } finally {
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 800);
    }
  }

  toggleNotificationsConfig() {
    const enabled = document.getElementById('notificationsEnabled').checked;
    const configDiv = document.querySelector('.notifications-config');
    if (configDiv) {
      configDiv.style.display = enabled ? 'block' : 'none';
    }
  }

  async saveNotificationSettings() {
    try {
      this.settings.notifications = {
        enabled: document.getElementById('notificationsEnabled').checked,
        aiReports: document.getElementById('aiReportsNotifications').checked,
        httpErrors: document.getElementById('httpErrorsNotifications').checked,
        criticalOnly: document.getElementById('criticalOnlyNotifications').checked,
        errorThreshold: parseInt(document.getElementById('errorThreshold').value) || 400,
        sound: document.getElementById('notificationSound').checked
      };

      await this.saveSettings();
      this.showStatus('Notification settings saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving notification settings:', error);
      this.showStatus('Error saving notification settings', 'error');
    }
  }
}

// Inicializa as configurações
new BugSpotterSettings();
