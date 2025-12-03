class BugSpotter {
  constructor() {
    this.attachments = [];
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.reportStatusTimeout = null;
    this.captureStatusTimeout = null;
    this.cachedSettings = null; // Adicionar cache das configurações
    this.errorHandler = new ErrorHandler(); // Inicializar ErrorHandler
  }
  
  isExtensionContext() {
    try {
      return typeof window !== 'undefined' &&
        typeof window.chrome !== 'undefined' &&
        typeof chrome.runtime !== 'undefined' &&
        typeof chrome.storage !== 'undefined';
    } catch (_) {
      return false;
    }
  }
  
  async init() {
    // 🆕 Notificar background que popup foi aberto (para limpar badge)
    try {
      console.log('[Popup] Enviando mensagem POPUP_OPENED para limpar badge...');
      if (this.isExtensionContext()) {
        const response = await chrome.runtime.sendMessage({ action: 'POPUP_OPENED' });
        console.log('[Popup] Resposta do background:', response);
      } else {
        console.log('[Popup] Contexto de preview detectado, pulando sendMessage');
      }
    } catch (error) {
      console.error('[Popup] Error sending POPUP_OPENED message:', error);
    }
    
    // Verificar se há gravação em andamento
    try {
      if (this.isExtensionContext()) {
        await this.checkRecordingState();
      }
    } catch (err) {
      console.warn('[Popup] checkRecordingState failed, continuing:', err);
    }
    
    // Carregar configurações no cache
    this.cachedSettings = await this.getSettings();
    await this.loadBugHistory();
    await this.loadPriorityOptions();
    this.setupEventListeners();
    
    // Listener para mensagens do background script
    if (this.isExtensionContext()) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleBackgroundMessage(message, sender, sendResponse);
      });
    }
    
    // ADICIONAR: Listener para mudanças no storage (settings e ai-reports-*)
    if (this.isExtensionContext() && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        // Atualizar cache e prioridades se settings mudarem
        if (changes.settings) {
          this.loadPriorityOptions();
          this.cachedSettings = changes.settings.newValue;
        }
        // Recarregar histórico quando houver mudanças em chaves ai-reports-*
        const changedKeys = Object.keys(changes || {});
        const aiReportsChanged = changedKeys.some(k => k.startsWith('ai-reports-'));
        if (aiReportsChanged) {
          this.loadBugHistory();
        }
      });
    }
  }

  setupEventListeners() {
    // Event listeners for main buttons
    document.getElementById('captureScreenshot').addEventListener('click', () => this.captureScreenshot());
    // Split-button: botão principal (Logs) não é clicável; apenas o caret abre o menu
    document.getElementById('captureDOM').addEventListener('click', () => this.captureDOM());
    document.getElementById('startRecording').addEventListener('click', () => this.startRecording());
    document.getElementById('clearHistory').addEventListener('click', () => this.clearHistory());
    document.getElementById('openSettings').addEventListener('click', () => this.openSettings());
    // Removido: listener para seção Advanced Settings (seção foi eliminada)

    // Split-button: toggle e menu
    const caretBtn = document.getElementById('captureLogsToggle');
    const menu = document.getElementById('captureLogsMenu');
    if (caretBtn && menu) {
      caretBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.toggle('open');
        caretBtn.setAttribute('aria-expanded', String(isOpen));
        menu.setAttribute('aria-hidden', String(!isOpen));
      });

      // Menu items
      const itemConsole = document.getElementById('menuConsole');
      const itemNetwork = document.getElementById('menuNetwork');
      itemConsole?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.setLastCaptureMode('console');
        menu.classList.remove('open');
        caretBtn.setAttribute('aria-expanded', 'false');
        menu.setAttribute('aria-hidden', 'true');
        await this.captureLogs();
      });
      itemNetwork?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.setLastCaptureMode('network');
        menu.classList.remove('open');
        caretBtn.setAttribute('aria-expanded', 'false');
        menu.setAttribute('aria-hidden', 'true');
        await this.captureNetworkDetails();
      });
      // Removida opção 'Console + Network'

      // Fechar ao clicar fora
      document.addEventListener('click', (ev) => {
        if (!menu.classList.contains('open')) return;
        const wrapper = caretBtn.closest('.split-button');
        if (wrapper && !wrapper.contains(ev.target)) {
          menu.classList.remove('open');
          caretBtn.setAttribute('aria-expanded', 'false');
          menu.setAttribute('aria-hidden', 'true');
        }
      });
      // Fechar com ESC
      window.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && menu.classList.contains('open')) {
          menu.classList.remove('open');
          caretBtn.setAttribute('aria-expanded', 'false');
          menu.setAttribute('aria-hidden', 'true');
        }
      });
    }

    // Enhancer AI button
    const enhanceBtn = document.getElementById('enhanceWithAI');
    if (enhanceBtn) {
      enhanceBtn.addEventListener('click', () => this.enhanceWithAI());
    }

    
    // Event listener for bug form
    document.getElementById('bugForm').addEventListener('submit', (e) => this.submitBug(e));

    // Preview numerado não é atualizado durante escrita manual; somente via AI
    
    // Event listener for attachment removal and history buttons
    document.addEventListener('click', (e) => {
      // Fix event listener for attachment removal
      if (e.target.closest('.remove-attachment')) {
        const index = e.target.closest('.remove-attachment').dataset.index;
        this.removeAttachment(parseInt(index));
      }
      // Event listeners for history buttons
      if (e.target.closest('.send-btn')) {
        const indexStr = e.target.closest('.send-btn').dataset.index;
        const index = parseInt(indexStr);
        if (isNaN(index) || indexStr === undefined || indexStr === null) {
          console.error('Invalid index for send button:', indexStr);
          return;
        }
        
        // Desabilitar o botão para evitar cliques duplicados
        const sendBtn = e.target.closest('.send-btn');
        if (sendBtn) sendBtn.disabled = true;
        
        // Verificar se é um relatório AI ou manual
        const historyItem = e.target.closest('.history-item');
        if (historyItem && historyItem.classList.contains('ai-report-item')) {
          // Feedback imediato
          this.updateHistoryStatus('Sending...', 'loading');
          // É um relatório AI - buscar o relatório pelo índice
          this.loadAIReports().then(aiReports => {
            const report = aiReports[index];
            if (report) {
              this.sendAIReport(index, report).catch(error => {
                console.error('Error sending AI report:', error);
                // Reabilitar o botão em caso de erro
                const btn = document.querySelector(`.ai-report-item .send-btn[data-index="${index}"]`);
                if (btn) btn.disabled = false;
                this.updateHistoryStatus(`Error sending: ${error.message}`, 'error');
              });
            } else {
              console.error('AI report not found at index:', index);
              // Reabilitar o botão se o relatório não for encontrado
              const btn = document.querySelector(`.ai-report-item .send-btn[data-index="${index}"]`);
              if (btn) btn.disabled = false;
              this.updateHistoryStatus('AI report not found', 'error');
            }
          }).catch(error => {
            console.error('Error loading AI reports:', error);
            // Reabilitar o botão em caso de erro ao carregar relatórios
            const btn = document.querySelector(`.ai-report-item .send-btn[data-index="${index}"]`);
            if (btn) btn.disabled = false;
            this.updateHistoryStatus('Error loading AI reports', 'error');
          });
        } else {
          // É um relatório manual
          this.updateHistoryStatus('Resending...', 'loading');
          this.retrySubmission(index).catch(err => {
            console.error('Error resending manual report:', err);
            // Reabilitar o botão manual em caso de erro
            const btn = document.querySelector(`.history-item .send-btn[data-index="${index}"]`);
            if (btn) btn.disabled = false;
            this.updateHistoryStatus('Error resending: ' + err.message, 'error');
          });
        }
      }
      
      if (e.target.closest('.view-btn')) {
        const indexStr = e.target.closest('.view-btn').dataset.index;
        const index = parseInt(indexStr);
        if (isNaN(index) || indexStr === undefined || indexStr === null) {
          console.error('Invalid index for view button:', indexStr);
          return;
        }
        
        // Verificar se é um relatório AI ou manual
        const historyItem = e.target.closest('.history-item');
        if (historyItem && historyItem.classList.contains('ai-report-item')) {
          // É um relatório AI
          this.viewAIReport(index);
        } else {
          // É um relatório manual
          this.viewReport(index);
        }
      }
      
      if (e.target.closest('.delete-btn')) {
        const indexStr = e.target.closest('.delete-btn').dataset.index;
        const index = parseInt(indexStr);
        if (isNaN(index) || indexStr === undefined || indexStr === null) {
          console.error('Invalid index for delete button:', indexStr);
          return;
        }
        
        // Verificar se é um relatório AI ou manual
        const historyItem = e.target.closest('.history-item');
        if (historyItem && historyItem.classList.contains('ai-report-item')) {
          // É um relatório AI
          this.deleteAIReport(index);
        } else {
          // É um relatório manual
          this.deleteReport(index);
        }
      }
      
      // Event listeners for AI report buttons (mantidos para compatibilidade)
      if (e.target.closest('.view-ai-btn')) {
        const index = e.target.closest('.view-ai-btn').dataset.index;
        this.viewAIReport(parseInt(index));
      }
      if (e.target.closest('.delete-ai-btn')) {
        const index = e.target.closest('.delete-ai-btn').dataset.index;
        this.deleteAIReport(parseInt(index));
      }
    });
  }

  async captureByPreferredMode() {
    const last = await this.getLastCaptureMode();
    if (last === 'network') {
      return this.captureNetworkDetails();
    }
    return this.captureLogs(); // default console
  }

  async getLastCaptureMode() {
    try {
      const { lastCaptureMode } = await chrome.storage.local.get(['lastCaptureMode']);
      // aceitar apenas 'console' ou 'network'
      return lastCaptureMode === 'network' ? 'network' : 'console';
    } catch (_) {
      return 'console';
    }
  }

  async setLastCaptureMode(mode) {
    try {
      const sanitized = mode === 'network' ? 'network' : 'console';
      await chrome.storage.local.set({ lastCaptureMode: sanitized });
    } catch (_) {}
  }
  
  filterHistory() {
    const searchTerm = document.getElementById('searchBugs').value.toLowerCase();
    const priorityFilter = document.getElementById('filterPriority').value;
    const environmentFilter = document.getElementById('filterEnvironment').value;
    
    // Apply filters to reports
    this.loadBugHistory().then(() => {
      const items = document.querySelectorAll('.history-item');
      items.forEach(item => {
        const title = item.querySelector('.history-title').textContent.toLowerCase();
        const description = item.querySelector('.history-description').textContent.toLowerCase();
        const priority = item.querySelector('.priority-badge').textContent.toLowerCase();
        
        const matchesSearch = !searchTerm || title.includes(searchTerm) || description.includes(searchTerm);
        const matchesPriority = !priorityFilter || priority.includes(priorityFilter.toLowerCase());
        
        if (matchesSearch && matchesPriority) {
          item.style.display = 'block';
        } else {
          item.style.display = 'none';
        }
      });
    });
  }
  
  updateCaptureStatus(message, type = 'info') {
    const statusElement = document.getElementById('captureStatus');
    if (!statusElement) {
      console.warn('[Popup] captureStatus element not found');
      return;
    }
    
    const statusText = statusElement.querySelector('.status-text');
    const statusIcon = statusElement.querySelector('.status-icon');
    
    if (!statusText) {
      console.warn('[Popup] Element .status-text not found');
      return;
    }
    
    if (!statusIcon) {
      console.warn('[Popup] Element .status-icon not found');
      return;
    }
    
    // If no message, hide the div completely
    if (!message || message.trim() === '') {
      statusElement.style.display = 'none';
      return;
    }
    
    // Show the div and update content
    statusElement.style.display = 'block';
    statusText.textContent = message;
    
    // Clear previous classes
    statusElement.className = 'capture-status';
    
    // Apply class based on type
    statusElement.classList.add(`status-${type}`);
    
    // Set icon based on type
    const icons = {
      info: 'info',
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      loading: 'hourglass_empty'
    };
    
    statusIcon.textContent = icons[type] || 'info';
    
    // Auto-hide for all messages except loading
    if (this.captureStatusTimeout) {
      clearTimeout(this.captureStatusTimeout);
    }
    
    if (type !== 'loading') {
      this.captureStatusTimeout = setTimeout(() => {
        statusElement.style.display = 'none';
      }, 3000);
    }
  }

  updateReportStatus(message, type = 'info') {
    const statusElement = document.getElementById('reportStatus');
    const statusText = statusElement.querySelector('.status-text');
    const statusIcon = statusElement.querySelector('.status-icon');
    
    // Show status div
    statusElement.style.display = 'block';
    
    // Remove previous status classes
    statusElement.classList.remove('status-info', 'status-success', 'status-error', 'status-warning', 'status-loading');
    
    // Add new status class
    statusElement.classList.add(`status-${type}`);
    
    // Update text
    statusText.textContent = message;
    
    // Update icon based on type
    const icons = {
      info: 'info',
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      loading: 'hourglass_empty'
    };
    
    statusIcon.textContent = icons[type] || 'info';

    // Garantir visibilidade: rolar para o status se estiver fora de vista
    try {
      const rect = statusElement.getBoundingClientRect();
      const viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
      const isVisible = rect.top >= 0 && rect.bottom <= viewHeight;
      if (!isVisible) {
        statusElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (_) { /* ignore scroll errors */ }
    
    // Clear previous timeout if exists
    if (this.reportStatusTimeout) {
      clearTimeout(this.reportStatusTimeout);
    }
    
    // Auto-hide messages after 3 seconds (except loading and error)
    if (type !== 'loading' && type !== 'error') {
      this.reportStatusTimeout = setTimeout(() => {
        statusElement.style.display = 'none';
      }, 3000);
    }
  }

  async enhanceWithAI() {
    try {
      // Feedback imediato no botão
      const enhanceBtn = document.getElementById('enhanceWithAI');
      const originalEnhanceHTML = enhanceBtn ? enhanceBtn.innerHTML : null;
      if (enhanceBtn) {
        enhanceBtn.disabled = true;
        enhanceBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Enhancing...';
      }

      this.updateReportStatus('Enhancing with AI...', 'loading');
      // Evitar erro em ambiente de preview (fora da extensão)
      if (!this.isExtensionContext()) {
        this.updateReportStatus('Enhance with AI está disponível apenas na extensão. Abra o popup da extensão para usar.', 'warning');
        if (enhanceBtn) {
          enhanceBtn.disabled = false;
          if (typeof originalEnhanceHTML === 'string') {
            enhanceBtn.innerHTML = originalEnhanceHTML;
          } else {
            enhanceBtn.innerHTML = '<span class="material-icons">auto_fix_high</span> Enhance with AI';
          }
        }
        return;
      }
      const titleEl = document.getElementById('title');
      const descEl = document.getElementById('description');
      const stepsEl = document.getElementById('steps');
      const expectedEl = document.getElementById('expectedBehavior');
      const actualEl = document.getElementById('actualBehavior');
      const priorityEl = document.getElementById('priority');
      const fields = {
        title: titleEl?.value || '',
        description: descEl?.value || '',
        steps: (stepsEl?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
        expectedBehavior: expectedEl?.value || '',
        actualBehavior: actualEl?.value || ''
      };

      // Resolve active tabId to allow background to fetch interactions
      let tabId = null;
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tabs && tabs[0] ? tabs[0].id : null;
      } catch (e) {
        // ignore; will be handled by background if null
      }

      const result = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ action: 'ENHANCE_REPORT_WITH_AI', fields, tabId }, (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (resp && resp.success) {
              resolve(resp.data);
            } else {
              reject(new Error(resp?.error || 'Enhancement failed'));
            }
          });
        } catch (e) {
          reject(e);
        }
      });

      if (result) {
        if (titleEl && typeof result.title === 'string') {
          titleEl.value = result.title;
        }
        if (descEl && typeof result.description === 'string') {
          descEl.value = result.description;
        }
        // Preencher Expected/Actual Behavior se fornecidos pela IA
        if (expectedEl && typeof result.expectedBehavior === 'string') {
          expectedEl.value = result.expectedBehavior;
        }
        if (actualEl && typeof result.actualBehavior === 'string') {
          actualEl.value = result.actualBehavior;
        }
        // Mapear severidade da IA para prioridade selecionável
        if (priorityEl && typeof result.severity === 'string') {
          const sev = result.severity.toLowerCase();
          const mapSeverityToPriorityKey = (s) => {
            switch (s) {
              case 'critical':
              case 'blocker':
              case 'highest':
                return 'highest';
              case 'high':
                return 'high';
              case 'medium':
              case 'moderate':
                return 'medium';
              case 'low':
              case 'minor':
                return 'low';
              default:
                return 'medium';
            }
          };
          const key = mapSeverityToPriorityKey(sev);
          // Verificar se a opção existe antes de setar
          const hasOption = Array.from(priorityEl.options).some(opt => opt.value === key);
          if (hasOption) {
            priorityEl.value = key;
          }
        }
        // Preencher Steps apenas se a IA fornecer e o campo estiver vazio
        if (stepsEl) {
          let stepsNormalized = [];
          if (Array.isArray(result.stepsToReproduce)) {
            stepsNormalized = result.stepsToReproduce;
          } else if (Array.isArray(result.steps)) {
            stepsNormalized = result.steps;
          } else if (Array.isArray(result['steps_to_reproduce'])) {
            stepsNormalized = result['steps_to_reproduce'];
          } else if (typeof result.stepsToReproduce === 'string') {
            stepsNormalized = result.stepsToReproduce.split('\n').map(s => s.trim()).filter(Boolean);
          } else if (typeof result.steps === 'string') {
            stepsNormalized = result.steps.split('\n').map(s => s.trim()).filter(Boolean);
          } else if (typeof result['steps_to_reproduce'] === 'string') {
            stepsNormalized = result['steps_to_reproduce'].split('\n').map(s => s.trim()).filter(Boolean);
          }
          if (stepsNormalized.length > 20) stepsNormalized = stepsNormalized.slice(0, 20);
          if (stepsNormalized.length && (!stepsEl.value || !stepsEl.value.trim().length)) {
            const stepsNumbered = stepsNormalized.map((s, idx) => {
              const clean = (s || '').replace(/^\s*(\d+[\)\.]|[-•])\s*/, '').trim();
              return `${idx + 1}. ${clean}`;
            });
            stepsEl.value = stepsNumbered.join('\n');
          }
        }
        this.updateReportStatus('Fields enhanced with AI', 'success');
      } else {
        this.updateReportStatus('No AI suggestions available', 'warning');
      }
    } catch (error) {
      this.updateReportStatus(`AI enhancement error: ${error.message}`, 'error');
    }
    finally {
      // Restaurar botão
      const enhanceBtn = document.getElementById('enhanceWithAI');
      if (enhanceBtn) {
        enhanceBtn.disabled = false;
        if (typeof originalEnhanceHTML === 'string') {
          enhanceBtn.innerHTML = originalEnhanceHTML;
        } else {
          enhanceBtn.innerHTML = '<span class="material-icons">auto_fix_high</span> Enhance with AI';
        }
      }
    }
  }

  // Preview de passos removido da extensão

  async captureScreenshot() {
    // captureScreenshot started - silenciado
    const button = document.getElementById('captureScreenshot');
    const btnText = button.querySelector('.btn-text');
    
    // Check only if already in process
    if (button.disabled) {
      return;
    }
    
    // Elements found - silenciado
    
    button.disabled = true;
    btnText.textContent = 'Capturing...';
    
    this.updateCaptureStatus('Capturing screenshot...', 'loading');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      
      const attachment = {
        type: 'screenshot',
        name: `screenshot_${Date.now()}.png`,
        data: dataUrl,
        size: this.calculateDataUrlSize(dataUrl)
      };
      
      const added = this.addAttachment(attachment);
      
      if (added) {
        this.updateCaptureStatus('Screenshot captured successfully!', 'success');
      }
    } catch (error) {
      // ✅ Tratar especificamente o erro 'No tab with given id'
      if (error.message && error.message.includes('No tab with given id')) {
        console.log('[Popup] Tab no longer exists, skipping screenshot capture');
        this.updateCaptureStatus('Tab no longer exists', 'warning');
      } else {
        console.error('Error capturing screenshot:', error);
        this.updateCaptureStatus('Error capturing screenshot', 'error');
      }
    } finally {
      button.disabled = false;
      btnText.textContent = 'Screenshot';
    }
  }

  async captureLogs() {
    // captureLogs started - silenciado
    const button = document.getElementById('captureLogs');
    const btnText = button.querySelector('.btn-text');
    
    // Check only if already in process
    if (button.disabled) {
      return;
    }
    
    // Elements found - silenciado
    
    button.disabled = true;
    btnText.textContent = 'Capturing...';
    
    this.updateCaptureStatus('Capturing console logs...', 'loading');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Extrair parâmetros configuráveis de janela e limite
      const cfg = this.cachedSettings?.capture || {};
      let winSec = Number(cfg.recentLogsWindowSeconds ?? 30);
      let lim = Number(cfg.recentLogsLimit ?? 10);
      winSec = isFinite(winSec) ? Math.max(30, Math.min(120, winSec)) : 30;
      lim = isFinite(lim) ? Math.max(10, Math.min(50, lim)) : 10;
      const windowMsCfg = winSec * 1000;

      // 1) Tente obter logs recentes diretamente do background (unificado)
      let recentLogs = null;
      try {
        const res = await chrome.runtime.sendMessage({
          action: 'GET_RECENT_LOGS',
          tabId: tab?.id,
          windowMs: windowMsCfg,
          limit: lim
        });
        if (res?.success && Array.isArray(res.data?.logs)) {
          recentLogs = res.data.logs;
        }
      } catch (_) {
        // Silenciar e seguir para fallback
      }

      // 2) Se não houver logs, tentar anexar debugger rapidamente e repetir
      if ((!recentLogs || recentLogs.length === 0) && tab?.id) {
        try {
          const attachResult = await chrome.runtime.sendMessage({ action: 'ATTACH_DEBUGGER', tabId: tab.id });
          if (attachResult?.success) {
            await new Promise(r => setTimeout(r, 500));
            const res2 = await chrome.runtime.sendMessage({
              action: 'GET_RECENT_LOGS',
              tabId: tab.id,
              windowMs: windowMsCfg,
              limit: lim
            });
            if (res2?.success && Array.isArray(res2.data?.logs)) {
              recentLogs = res2.data.logs;
            }
          }
        } catch (_) {
          // Ignorar e usar fallback tradicional
        } finally {
          try { await chrome.runtime.sendMessage({ action: 'DETACH_DEBUGGER', tabId: tab.id }); } catch (_) {}
        }
      }

      // 3) Se ainda vazio, usar fallback tradicional que injeta script
      let logLines = [];
      if (recentLogs && recentLogs.length > 0) {
        logLines = this.formatUnifiedLogs(recentLogs);
      } else {
        const fallback = await this.captureLogsTraditional(tab?.id);
        if (Array.isArray(fallback) && fallback.length > 0) {
          logLines = fallback;
        }
      }

      if (logLines.length > 0) {
        const attachment = {
          type: 'logs',
          name: `console_logs_${Date.now()}.txt`,
          data: logLines.join('\n'),
          size: new Blob([logLines.join('\n')]).size
        };

        const added = this.addAttachment(attachment);
        if (added) this.updateCaptureStatus('Console logs captured successfully!', 'success');
      } else {
        this.updateCaptureStatus('No console logs found', 'warning');
      }
    } catch (error) {
      console.error('Error capturing logs:', error);
      this.updateCaptureStatus('Error capturing console logs', 'error');
    } finally {
      button.disabled = false;
      btnText.textContent = 'Logs';
    }
  }

  async captureNetworkDetails() {
    const button = document.getElementById('captureLogs');
    const btnText = button?.querySelector('.btn-text');

    if (button && button.disabled) {
      return;
    }
    if (button) button.disabled = true;
    if (btnText) btnText.textContent = 'Capturing...';
    this.updateCaptureStatus('Capturing network logs...', 'loading');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active tab');

      const domain = (() => {
        try { return new URL(tab.url).hostname; } catch (_) { return null; }
      })();

      const logsResult = await chrome.runtime.sendMessage({
        action: 'GET_DEBUGGER_LOGS',
        tabId: tab.id,
        domainFilter: domain || null
      });

      if (!logsResult?.success) {
        throw new Error(logsResult?.error || 'Failed to get logs');
      }

      const requests = (logsResult.data?.networkRequests || [])
        .filter(r => (typeof r.status === 'number' ? r.status >= 400 : false))
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
        .slice(0, 3);

      if (!requests.length) {
        this.updateCaptureStatus('No recent network errors found', 'warning');
        return;
      }

      const detailsList = [];
      for (const req of requests) {
        const res = await chrome.runtime.sendMessage({
          action: 'GET_NETWORK_DETAILS',
          tabId: tab.id,
          url: req.url,
          timestamp: req.timestamp
        });
        if (res?.success) {
          const d = res.data || {};
          // Redact sensitive headers
          d.requestHeaders = this.redactHeaders(d.requestHeaders || {});
          d.responseHeaders = this.redactHeaders(d.responseHeaders || {});
          // Truncate response body
          if (typeof d.responseBody === 'string') {
            d.responseBody = this.truncateBody(d.responseBody, 5000);
          }
          detailsList.push(d);
        }
      }

      const json = JSON.stringify({ collectedAt: new Date().toISOString(), items: detailsList }, null, 2);
      const attachment = {
        type: 'network',
        name: `network-details_${Date.now()}.json`,
        data: json,
        size: new Blob([json]).size
      };
      const added = this.addAttachment(attachment);
      if (added) {
        this.updateCaptureStatus('Network logs captured successfully!', 'success');
      }
    } catch (error) {
      console.error('Error capturing network details:', error);
      this.updateCaptureStatus('Error capturing network logs', 'error');
    } finally {
      if (button) button.disabled = false;
      if (btnText) btnText.textContent = 'Logs';
    }
  }

  truncateBody(text, maxLen) {
    try {
      if (typeof text !== 'string') return text;
      if (text.length <= maxLen) return text;
      return text.slice(0, maxLen) + '...';
    } catch (_) { return text; }
  }

  redactHeaders(headers) {
    try {
      const redacted = { ...headers };
      const keys = Object.keys(redacted);
      for (const k of keys) {
        const lower = k.toLowerCase();
        if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie' || lower.includes('token')) {
          redacted[k] = '[REDACTED]';
        }
      }
      return redacted;
    } catch (_) { return headers; }
  }

  // Removido modo combinado 'Console + Network'

  // Novo método para capturar logs usando Chrome Debugger API
  async captureLogsWithDebugger(tabId) {
    try {
      // Iniciando captura com Chrome Debugger API - silenciado
      
      // Anexar debugger
      // Tentando anexar debugger - silenciado
      const attachResult = await chrome.runtime.sendMessage({
        action: 'ATTACH_DEBUGGER',
        tabId: tabId
      });
      
      // Resultado do attach - silenciado
      
      if (!attachResult.success) {
        console.error('[DEBUG] Failed to attach debugger:', attachResult.error);
        throw new Error(attachResult.error || 'Failed to attach debugger');
      }
      
      // Debugger anexado com sucesso - silenciado
      
      // Aguardar um pouco para capturar logs
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Obter logs do debugger
      // Solicitando logs do debugger - silenciado
      const logsResult = await chrome.runtime.sendMessage({
        action: 'GET_DEBUGGER_LOGS',
        tabId: tabId
      });
      
      // Resultado dos logs - silenciado
      
      if (!logsResult.success) {
        console.error('[DEBUG] Failed to get logs:', logsResult.error);
        throw new Error(logsResult.error || 'Failed to get debugger logs');
      }
      
      // Logs obtidos - silenciado
      
      // Formatar logs para exibição com filtragem e limite
      const formattedLogs = [];
      const maxLogs = 100; // Limite para evitar arquivos excessivamente grandes
      
      if (logsResult.data.logs) {
        logsResult.data.logs.forEach(log => {
          if (formattedLogs.length >= maxLogs) return; // Parar se atingir o limite
          
          const timestamp = new Date(log.timestamp).toISOString();
          
          if (log.type === 'console') {
            // Correção: verificar se log.level existe antes de usar toUpperCase()
            const level = log.level ? log.level.toUpperCase() : 'LOG';
            const text = log.text || '';
            
            // Filtrar apenas logs relevantes (erros, warnings ou logs com palavras-chave)
            if (level === 'ERROR' || level === 'WARN' || 
                text.includes('error') || text.includes('Error') || 
                text.includes('failed') || text.includes('Failed')) {
              formattedLogs.push(`[${level}] ${timestamp}: ${text}`);
            }
          } else if (log.type === 'console-api') {
            // Correção: verificar se log.level existe antes de usar toUpperCase()
            const level = log.level ? log.level.toUpperCase() : 'LOG';
            const args = log.args ? log.args.map(arg => arg.value || arg.description || JSON.stringify(arg)).join(' ') : '';
            
            // Filtrar apenas logs relevantes
            if (level === 'ERROR' || level === 'WARN' || 
                args.includes('error') || args.includes('Error') || 
                args.includes('failed') || args.includes('Failed')) {
              formattedLogs.push(`[${level}] ${timestamp}: ${args}`);
            }
          }
        });
      }
      
      // Removido: não incluir eventos/erros de rede aqui. Console logs apenas.
      
      // Logs formatados - silenciado
      
      // Desanexar debugger após captura
      try {
        await chrome.runtime.sendMessage({
          action: 'DETACH_DEBUGGER',
          tabId: tabId
        });
        // Debugger desanexado com sucesso - silenciado
      } catch (detachError) {
        console.warn('[DEBUG] Error detaching debugger:', detachError);
      }
      
      return formattedLogs;
      
    } catch (error) {
      console.error('[DEBUG] Debugger API capture failed:', error);
      console.error('[DEBUG] Stack trace:', error.stack);
      
      // Tentar desanexar debugger em caso de erro
      try {
        await chrome.runtime.sendMessage({
          action: 'DETACH_DEBUGGER',
          tabId: tabId
        });
      } catch (detachError) {
        console.warn('[DEBUG] Error detaching debugger after failure:', detachError);
      }
      
      return null;
    }
  }

  // Método tradicional como fallback
  async captureLogsTraditional(tabId) {
    try {
      const logs = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => {
          // Capture console logs
          const logs = [];
          
          // Intercept console.log, console.error, console.warn, console.info
          const originalLog = console.log;
          const originalError = console.error;
          const originalWarn = console.warn;
          const originalInfo = console.info;
          
          // Check if logs are already stored
          if (window.capturedLogs && window.capturedLogs.length > 0) {
            return window.capturedLogs;
          }
          
          // If no captured logs, initialize capture with size limit
          window.capturedLogs = [];
          window.maxLogEntries = 100; // Limit to prevent excessive log files
          
          // Override console methods to capture only relevant logs
          console.log = function(...args) {
            // Only capture logs that seem relevant for debugging (errors, warnings, or specific keywords)
            const logText = args.join(' ');
            if (logText.includes('error') || logText.includes('Error') || logText.includes('failed') || logText.includes('Failed')) {
              if (window.capturedLogs.length < window.maxLogEntries) {
                window.capturedLogs.push(`[LOG] ${new Date().toISOString()}: ${logText}`);
              }
            }
            originalLog.apply(console, args);
          };

          console.error = function(...args) {
            if (window.capturedLogs.length < window.maxLogEntries) {
              window.capturedLogs.push(`[ERROR] ${new Date().toISOString()}: ${args.join(' ')}`);
            }
            originalError.apply(console, args);
          };

          console.warn = function(...args) {
            if (window.capturedLogs.length < window.maxLogEntries) {
              window.capturedLogs.push(`[WARN] ${new Date().toISOString()}: ${args.join(' ')}`);
            }
            originalWarn.apply(console, args);
          };

          console.info = function(...args) {
            // Only capture info logs that seem relevant for debugging
            const logText = args.join(' ');
            if (logText.includes('error') || logText.includes('Error') || logText.includes('failed') || logText.includes('Failed')) {
              if (window.capturedLogs.length < window.maxLogEntries) {
                window.capturedLogs.push(`[INFO] ${new Date().toISOString()}: ${logText}`);
              }
            }
            originalInfo.apply(console, args);
          };
          
          // Capture JavaScript errors
          window.addEventListener('error', (event) => {
            if (window.capturedLogs.length < window.maxLogEntries) {
              window.capturedLogs.push(`[JS ERROR] ${new Date().toISOString()}: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
            }
          });

          // Capture rejected Promise errors
          window.addEventListener('unhandledrejection', (event) => {
            if (window.capturedLogs.length < window.maxLogEntries) {
              window.capturedLogs.push(`[PROMISE ERROR] ${new Date().toISOString()}: ${event.reason}`);
            }
          });
          
          // Return existing logs or an indicative message
          if (window.capturedLogs.length === 0) {
            return [`[INFO] ${new Date().toISOString()}: Log capture system initialized. Interact with the page to generate logs.`];
          }
          
          return window.capturedLogs;
        }
      });
      
      return logs[0].result;
      
    } catch (error) {
      // ✅ Tratar especificamente o erro 'No tab with given id'
      if (error.message && error.message.includes('No tab with given id')) {
        console.log('[Popup] Tab no longer exists, skipping traditional log capture');
        return null;
      }
      console.error('Traditional capture failed:', error);
      return null;
    }
  }

  // Formata logs unificados (console, console-api, exception) em linhas de texto
  formatUnifiedLogs(entries) {
    const lines = [];
    for (const log of entries) {
      const ts = (() => { try { return new Date(log.timestamp).toISOString(); } catch { return String(log.timestamp || '') } })();
      if (log.type === 'exception') {
        let where = '';
        const st = log.stackTrace;
        if (st && Array.isArray(st.callFrames) && st.callFrames.length > 0) {
          const f = st.callFrames[0];
          where = ` at ${f.functionName || '<anonymous>'} (${f.url || log.url || ''}:${f.lineNumber}:${f.columnNumber})`;
        } else if (log.url) {
          where = ` at ${log.url}:${log.lineNumber}:${log.columnNumber}`;
        }
        const excRaw = (log.text !== undefined ? log.text : (log.message !== undefined ? log.message : 'Runtime Exception'));
        const excText = typeof excRaw === 'string' ? excRaw : (() => { try { return JSON.stringify(excRaw); } catch { return String(excRaw); } })();
        lines.push(`[ERROR] ${ts}: Exception: ${excText}${where}`);
      } else {
        const level = (log.level || 'log').toUpperCase();
        const rawText = (log.text !== undefined ? log.text : (log.message !== undefined ? log.message : ''));
        const text = typeof rawText === 'string' ? rawText : (() => { try { return JSON.stringify(rawText); } catch { return String(rawText); } })();
        lines.push(`[${level}] ${ts}: ${text}`);
      }
    }
    return lines;
  }

  async captureDOM() {
    // captureDOM started - silenciado
    const button = document.getElementById('captureDOM');
    const btnText = button.querySelector('.btn-text');
    
    if (button.disabled) {
      return;
    }
    
    button.disabled = true;
    btnText.textContent = 'Capturing...';
    
    this.updateCaptureStatus('Capturing DOM...', 'loading');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const domData = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          return document.documentElement.outerHTML;
        }
      });
      
      const htmlContent = domData[0].result;
      
      if (!htmlContent || typeof htmlContent !== 'string') {
        throw new Error('Failed to capture DOM content');
      }
      
      const attachment = {
        type: 'dom',
        name: `dom_snapshot_${Date.now()}.html`,
        data: htmlContent,
        size: new Blob([htmlContent]).size
      };
      
      const added = this.addAttachment(attachment);
      
      if (added) {
        this.updateCaptureStatus('DOM captured successfully!', 'success');
      }
    } catch (error) {
      // ✅ Tratar especificamente o erro 'No tab with given id'
      if (error.message && error.message.includes('No tab with given id')) {
        console.log('[Popup] Tab no longer exists, skipping DOM capture');
        this.updateCaptureStatus('Tab no longer exists', 'warning');
      } else {
        console.error('Error capturing DOM:', error);
        this.updateCaptureStatus('Error capturing DOM', 'error');
      }
    } finally {
      button.disabled = false;
      btnText.textContent = 'DOM';
    }
  }

  async startRecording() {
    try {
      // Obter configurações de duração máxima
      const settings = await this.getSettings();
      const maxDuration = (settings.capture?.maxVideoLength || 30); // Em segundos
      
      this.updateCaptureStatus('Preparing recording...', 'loading');
      
      // Obter aba ativa
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      
      if (!activeTab) {
        throw new Error('No active tab found');
      }
      
      // Verificar se a URL é acessível para content scripts
      const url = activeTab.url;
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || 
          url.startsWith('moz-extension://') || url.startsWith('edge://') || 
          url.startsWith('about:') || url.startsWith('file://')) {
        throw new Error('Cannot access a chrome:// URL');
      }
      
      // Injetar content script na aba ativa
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['src/content/recording-content.js']
      });
      
      // Aguardar um pouco para o content script inicializar
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Enviar comando para injetar overlay
      await chrome.tabs.sendMessage(activeTab.id, {
        action: 'INJECT_RECORDING_OVERLAY',
        config: {
          maxDuration: maxDuration
        }
      });
      
      // Notificar background script sobre início da gravação
      await this.notifyRecordingStart(maxDuration * 1000);
      
      this.updateCaptureStatus('Recording overlay injected!', 'success');
      
      // Fechar popup após 1 segundo
      setTimeout(() => {
        window.close();
      }, 1000);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      
      let errorMessage = 'Error starting recording';
      if (error.message.includes('Cannot access')) {
        errorMessage = 'Cannot record on this page. Try a normal web page (http/https).';
      } else if (error.message.includes('No active tab')) {
        errorMessage = 'No active tab found';
      }
      
      this.updateCaptureStatus(errorMessage, 'error');
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch (error) {
        console.error('Error stopping recording:', error);
      }
      
      this.isRecording = false;
      
      // Notificar background script sobre parada da gravação
      this.notifyRecordingStop();
      
      // Limpar timeout se ainda estiver ativo
      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
        this.recordingTimeout = null;
      }
      
      // Limpar timer de atualização
      if (this.recordingTimerInterval) {
        clearInterval(this.recordingTimerInterval);
        this.recordingTimerInterval = null;
      }
      
      this.resetRecordingButton();
      this.updateCaptureStatus('Finalizing recording...', 'loading');
    }
  }
  
  resetRecordingButton() {
    const button = document.getElementById('startRecording');
    if (!button) {
      console.warn('[Popup] startRecording button not found');
      return;
    }
    
    const btnText = button.querySelector('.btn-text');
    if (!btnText) {
      console.warn('[Popup] Element .btn-text not found');
      return;
    }
    
    btnText.textContent = 'Video';
    button.classList.remove('recording');
  }
  
  updateRecordingTimer(maxDuration, startElapsed = 0) {
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

  addAttachment(attachment) {
    // Check if an attachment of the same type was captured recently (last 3 seconds)
    const now = Date.now();
    const recentDuplicate = this.attachments.find(existing => 
      existing.type === attachment.type && 
      (now - parseInt(existing.name.match(/_(\\d+)\\./)?.[1] || 0)) < 3000
    );
    
    if (recentDuplicate) {
      this.updateCaptureStatus(`${attachment.type} was already captured recently. Please wait a few seconds.`, 'warning');
      return false;
    }
    
    this.attachments.push(attachment);
    this.updateAttachmentsList();
    return true;
  }

  removeAttachment(index) {
    this.attachments.splice(index, 1);
    this.updateAttachmentsList();
    this.updateReportStatus('Attachment removed', 'info');
  }

  updateAttachmentsList() {
    const container = document.getElementById('attachmentsList');
    container.innerHTML = '';
    
    this.attachments.forEach((attachment, index) => {
      const item = document.createElement('div');
      item.className = 'attachment-item';
      
      const typeIcons = {
        screenshot: 'image',
        logs: 'description',
        dom: 'code',
        recording: 'videocam',
        video: 'videocam'
      };
      
      // Criar elementos base
      const attachmentInfo = document.createElement('div');
      attachmentInfo.className = 'attachment-info';
      
      const icon = document.createElement('span');
      icon.className = 'material-icons attachment-icon';
      icon.textContent = typeIcons[attachment.type];
      
      const details = document.createElement('div');
      details.className = 'attachment-details';
      
      const nameElement = document.createElement('div');
      nameElement.className = 'attachment-name';
      nameElement.textContent = attachment.name;
      
      const sizeElement = document.createElement('div');
      sizeElement.className = 'attachment-size';
      
      // Adicionar informações específicas por tipo
      if (attachment.type === 'recording' && attachment.duration) {
        sizeElement.textContent = `${this.formatFileSize(attachment.size)} • ${attachment.duration}s`;
        
        // Adicionar preview do vídeo se disponível
        if (attachment.data) {
          const previewContainer = document.createElement('div');
          previewContainer.className = 'video-preview-container';
          
          const video = document.createElement('video');
          video.className = 'video-preview';
          video.src = attachment.data;
          video.controls = false;
          video.muted = true;
          video.preload = 'metadata';
          video.style.width = '60px';
          video.style.height = '40px';
          video.style.objectFit = 'cover';
          video.style.borderRadius = '4px';
          video.style.cursor = 'pointer';
          
          // Adicionar evento para reproduzir/pausar ao clicar
          video.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showVideoPreview(attachment);
          });
          
          // Tentar capturar frame inicial
          video.addEventListener('loadedmetadata', () => {
            video.currentTime = Math.min(1, video.duration * 0.1); // 10% do vídeo ou 1s
          });
          
          previewContainer.appendChild(video);
          
          // Adicionar overlay de play
          const playOverlay = document.createElement('div');
          playOverlay.className = 'video-play-overlay';
          playOverlay.innerHTML = '<span class="material-icons">play_circle_filled</span>';
          playOverlay.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 20px;
            text-shadow: 0 0 4px rgba(0,0,0,0.8);
            pointer-events: none;
          `;
          previewContainer.style.position = 'relative';
          previewContainer.appendChild(playOverlay);
          
          attachmentInfo.appendChild(previewContainer);
        }
      } else {
        sizeElement.textContent = this.formatFileSize(attachment.size);
        
        // Remover preview de screenshots conforme solicitado
      }
      
      details.appendChild(nameElement);
      details.appendChild(sizeElement);
      
      attachmentInfo.appendChild(icon);
      attachmentInfo.appendChild(details);
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-icon remove-attachment';
      removeBtn.setAttribute('data-index', index);
      removeBtn.title = 'Remove attachment';
      removeBtn.innerHTML = '<span class="material-icons">delete</span>';
      
      item.appendChild(attachmentInfo);
      item.appendChild(removeBtn);
      
      container.appendChild(item);
    });
  }
  
  showVideoPreview(attachment) {
    // Criar modal para preview do vídeo
    const modal = document.createElement('div');
    modal.className = 'video-preview-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = `
      position: relative;
      max-width: 90%;
      max-height: 90%;
    `;
    
    const video = document.createElement('video');
    video.src = attachment.data;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = `
      max-width: 100%;
      max-height: 100%;
      border-radius: 8px;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '<span class="material-icons">close</span>';
    closeBtn.style.cssText = `
      position: absolute;
      top: -40px;
      right: 0;
      background: rgba(255, 255, 255, 0.9);
      border: none;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(closeBtn);
    modal.appendChild(videoContainer);
    document.body.appendChild(modal);
  }
  
  showImagePreview(attachment) {
    // Criar modal para preview da imagem
    const modal = document.createElement('div');
    modal.className = 'image-preview-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = `
      position: relative;
      max-width: 90%;
      max-height: 90%;
    `;
    
    const img = document.createElement('img');
    img.src = attachment.data;
    img.style.cssText = `
      max-width: 100%;
      max-height: 100%;
      border-radius: 8px;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '<span class="material-icons">close</span>';
    closeBtn.style.cssText = `
      position: absolute;
      top: -40px;
      right: 0;
      background: rgba(255, 255, 255, 0.9);
      border: none;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    imgContainer.appendChild(img);
    imgContainer.appendChild(closeBtn);
    modal.appendChild(imgContainer);
    document.body.appendChild(modal);
  }

  async submitBug(event) {
    event.preventDefault();
    
    // Protection against multiple clicks
    const submitBtn = event.target.querySelector('.submit-btn');
    if (submitBtn.disabled) {
      return; // Already processing
    }
    
    const formData = new FormData(event.target);
    const bugData = {
      title: formData.get('title'),
      description: formData.get('description'),
      steps: formData.get('steps'),
      expectedBehavior: formData.get('expectedBehavior'),
      actualBehavior: formData.get('actualBehavior'),
      priority: formData.get('priority'),
      environment: formData.get('environment'),
      component: formData.get('component')
    };
    
    // Schema de validação
    const validationSchema = {
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
        required: true,
        type: 'string'
      },
      environment: {
        required: true,
        type: 'string'
      }
    };
    
    // Validar dados de entrada
    try {
      // Usar ErrorHandler se disponível
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const response = await chrome.runtime.sendMessage({
          action: 'VALIDATE_INPUT',
          data: bugData,
          schema: validationSchema,
          context: 'Bug Report'
        });
        
        if (!response.success) {
          this.updateReportStatus(`❌ ${response.errors.join(', ')}`, 'error');
          return;
        }
      } else {
        // Validação básica como fallback
        if (!bugData.title || bugData.title.length < 5) {
          this.updateReportStatus('❌ Title must be at least 5 characters long', 'error');
          return;
        }
        if (!bugData.description || bugData.description.length < 10) {
          this.updateReportStatus('❌ Description must be at least 10 characters long', 'error');
          return;
        }
        if (!bugData.priority) {
          this.updateReportStatus('❌ Priority is required', 'error');
          return;
        }
        if (!bugData.environment) {
          this.updateReportStatus('❌ Environment is required', 'error');
          return;
        }
      }
    } catch (error) {
      console.error('Validation error:', error);
      this.updateReportStatus('❌ Validation failed', 'error');
      return;
    }
    
    // Disable button and show visual feedback
    submitBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = `
      <span class="material-icons">hourglass_empty</span>
      Sending...
    `;
    submitBtn.classList.add('loading');
    
    // Show processing status
    this.updateReportStatus('Processing report...', 'loading');
    
    // Completar dados do bug
    bugData.url = await this.getCurrentTabUrl();
    bugData.attachments = this.attachments;
    bugData.timestamp = new Date().toISOString();
    bugData.jiraAttempted = false;
    bugData.easyvistaAttempted = false;
    bugData.status = 'open';
  
    try {
      // Try to send according to preferred target and enabled integrations
      const settings = await this.getSettings();
      const jiraEnabled = !!(settings.jira && settings.jira.enabled);
      const evEnabled = !!(settings.easyvista && settings.easyvista.enabled);
      let target = null;
      if (jiraEnabled && evEnabled) {
        target = settings.preferredTarget === 'easyvista' ? 'easyvista' : 'jira';
      } else if (jiraEnabled) {
        target = 'jira';
      } else if (evEnabled) {
        target = 'easyvista';
      }

      // Envio sequencial para ambos quando habilitado: sempre Jira → EasyVista
      if (jiraEnabled && evEnabled && settings.postToBoth) {
        const order = ['jira', 'easyvista'];
        try {
          for (const step of order) {
            if (step === 'jira') {
              bugData.jiraAttempted = true;
              const jiraResponse = await this.sendToJira(bugData);
              const ticketKey = jiraResponse?.key || jiraResponse?.issueKey || jiraResponse?.data?.key || jiraResponse?.data?.issueKey;
              if (ticketKey) {
                bugData.jiraKey = ticketKey;
                // Preparar cross-link para o próximo envio
                const jiraUrl = this.getJiraTicketUrl(ticketKey);
                bugData.crossLink = { ...(bugData.crossLink || {}), jiraKey: ticketKey, jiraUrl };
                this.updateReportStatus(`Jira criado: ${ticketKey}. Prosseguindo com EasyVista...`, 'loading');
              } else {
                this.updateReportStatus('Jira criado com resposta inválida; continuando com EasyVista', 'warning');
              }
            } else if (step === 'easyvista') {
              bugData.easyvistaAttempted = true;
              const evResp = await this.sendToEasyVista(bugData);
              const evId = evResp?.ticketId || evResp?.data?.ticketId || evResp?.data?.id;
              const evUrl = evResp?.ticketUrl || evResp?.data?.ticketUrl;
              if (evId || evUrl) {
                bugData.easyvistaId = evId || null;
                bugData.easyvistaUrl = evUrl || null;
                // Preparar cross-link para o próximo envio
                bugData.crossLink = { ...(bugData.crossLink || {}), easyvistaId: evId || undefined, easyvistaUrl: evUrl || undefined };
                this.updateReportStatus(`EasyVista criado${evId ? ': ' + evId : ''}. Prosseguindo com Jira...`, 'loading');
              } else {
                this.updateReportStatus('EasyVista criado com resposta inválida; continuando com Jira', 'warning');
              }
            }
          }
          // Se Jira foi criado primeiro, adicionar comentário com link do EasyVista (formato padrão)
          if (order[0] === 'jira' && bugData.jiraKey && (bugData.easyvistaUrl || bugData.easyvistaId)) {
            const commentBody = bugData.crossLink?.easyvistaUrl
              ? `[EASYVISTA] ${bugData.crossLink.easyvistaUrl}`
              : (bugData.crossLink?.easyvistaId ? `[EASYVISTA] ${bugData.crossLink.easyvistaId}` : null);
            if (commentBody) {
              try {
                await this.addJiraComment(bugData.jiraKey, commentBody);
              } catch (commentError) {
                console.warn('Falha ao adicionar comentário de cross-link no Jira:', commentError);
              }
            }
          }
          const summary = [
            bugData.jiraKey ? `Jira: ${bugData.jiraKey}` : null,
            bugData.easyvistaId ? `EasyVista: ${bugData.easyvistaId}` : null
          ].filter(Boolean).join(' | ');
          this.updateReportStatus(`Report enviado para ambos. ${summary}`, 'success');
        } catch (dualError) {
          console.error('Erro no envio duplo:', dualError);
          this.updateReportStatus('Erro ao enviar para ambos: ' + dualError.message, 'warning');
        }
      } else if (target === 'jira') {
        try {
          bugData.jiraAttempted = true;
          const jiraResponse = await this.sendToJira(bugData);
          const ticketKey = jiraResponse?.key || jiraResponse?.issueKey || jiraResponse?.data?.key || jiraResponse?.data?.issueKey;
          if (ticketKey) {
            bugData.jiraKey = ticketKey;
            this.updateReportStatus(`Report sent successfully! Jira: ${ticketKey}`, 'success');
          } else {
            this.updateReportStatus('Saved locally. Error sending to Jira: Invalid response', 'warning');
          }
        } catch (jiraError) {
          console.error('Error sending to Jira:', jiraError);
          this.updateReportStatus('Saved locally. Error sending to Jira: ' + jiraError.message, 'warning');
        }
      } else if (target === 'easyvista') {
        try {
          bugData.easyvistaAttempted = true;
          const evResp = await this.sendToEasyVista(bugData);
          const evId = evResp?.ticketId || evResp?.data?.ticketId || evResp?.data?.id;
          const evUrl = evResp?.ticketUrl || evResp?.data?.ticketUrl;
          if (evId || evUrl) {
            bugData.easyvistaId = evId || null;
            bugData.easyvistaUrl = evUrl || null;
            this.updateReportStatus(`Report sent successfully! EasyVista${evId ? ': ' + evId : ''}`, 'success');
          } else {
            this.updateReportStatus('Saved locally. Error sending to EasyVista: Invalid response', 'warning');
          }
        } catch (evError) {
          console.error('Error sending to EasyVista:', evError);
          this.updateReportStatus('Saved locally. Error sending to EasyVista: ' + evError.message, 'warning');
        }
      } else {
        this.updateReportStatus('Report saved locally!', 'success');
      }
      
      // Save only ONCE, with or without jiraKey
      await this.saveBugReport(bugData);
      
      // Clear form and attachments
      event.target.reset();
      this.attachments = [];
      this.updateAttachmentsList();
      
      // Update history
      this.loadBugHistory();
      
    } catch (error) {
      console.error('Error saving report:', error);
      this.updateReportStatus('Error saving report: ' + error.message, 'error');
    } finally {
      // Always restore button, regardless of result
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        submitBtn.classList.remove('loading');
      }, 1000); // Small delay to show result
    }
  }

  async addJiraComment(issueKey, body) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'ADD_JIRA_COMMENT',
        issueKey,
        body
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Communication error: ${chrome.runtime.lastError.message}`));
          return;
        }
        if (!response) {
          reject(new Error('No response received from background script'));
          return;
        }
        if (response.success === false) {
          reject(new Error(response.error || 'Unknown error'));
          return;
        }
        resolve(response.data || { ok: true });
      });
    });
  }

  async getSettings() {
    try {
      let settings = {};
      if (this.isExtensionContext()) {
        const result = await chrome.storage.local.get(['settings']);
        settings = result.settings || {};
      } else {
        console.log('[Popup] Preview sem chrome.storage; usando configurações padrão');
      }
      // Storage carregado no popup - silenciado
      
      // Definir prioridades padrão
      const defaultPriorities = {
        'highest': 'Highest',
        'high': 'High',
        'medium': 'Medium',
        'low': 'Low',
        'lowest': 'Lowest'
      };
      
      const finalSettings = {
        autoCapture: settings.popup?.autoCapture ?? true,
        includeConsole: settings.popup?.includeConsole ?? true,
        maxFileSize: settings.popup?.maxFileSize ?? 5,
        preferredTarget: settings.preferredTarget || 'jira',
        postToBoth: !!settings.postToBoth,
        capture: {
          autoCaptureLogs: settings.capture?.autoCaptureLogs ?? true,
          screenshotFormat: settings.capture?.screenshotFormat ?? 'png',
          maxVideoLength: settings.capture?.maxVideoLength ?? 30,
          screenshotQuality: settings.capture?.screenshotQuality ?? 90,
          recentLogsWindowSeconds: settings.capture?.recentLogsWindowSeconds ?? 30,
          recentLogsLimit: settings.capture?.recentLogsLimit ?? 10
        },
        jira: {
          enabled: settings.jira?.enabled ?? false,
          baseUrl: settings.jira?.baseUrl || '',
          email: settings.jira?.email || '',
          apiToken: settings.jira?.apiToken || '',
          projectKey: settings.jira?.projectKey || '',
          priorities: settings.jira?.priorities || defaultPriorities
        },
        easyvista: {
          enabled: settings.easyvista?.enabled ?? false,
          baseUrl: settings.easyvista?.baseUrl || '',
          apiKey: settings.easyvista?.apiKey || ''
        }
      };
      
      // Configurações finais do popup - silenciado
      return finalSettings;
      
    } catch (error) {
      console.error('❌ Error loading settings:', error);
      return {
        autoCapture: true,
        includeConsole: true,
        maxFileSize: 5,
        preferredTarget: 'jira',
        postToBoth: false,
        capture: {
          autoCaptureLogs: true,
          screenshotFormat: 'png',
          maxVideoLength: 30,
          screenshotQuality: 90
        },
        jira: {
          enabled: false,
          baseUrl: '',
          email: '',
          apiToken: '',
          projectKey: '',
          priorities: {
            'highest': 'Highest',
            'high': 'High',
            'medium': 'Medium',
            'low': 'Low',
            'lowest': 'Lowest'
          }
        },
        easyvista: {
          enabled: false,
          baseUrl: '',
          apiKey: ''
        }
      };
    }
  }

  async sendToJira(bugData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'SEND_TO_JIRA',
        data: bugData
      }, (response) => {
        // Check for runtime error
        if (chrome.runtime.lastError) {
          reject(new Error(`Communication error: ${chrome.runtime.lastError.message}`));
          return;
        }
        
        // Check if response exists
        if (!response) {
          reject(new Error('No response received from background script'));
          return;
        }
        
        // Respect explicit failure from background
        if (response.success === false) {
          reject(new Error(response.error || 'Unknown error'));
          return;
        }

        // Support both response shapes from background:
        // - { success: true, data: { key: 'PROJ-1', ... } }
        // - { success: true, issueKey: 'PROJ-1', ... }
        // - Raw Jira payload { key: 'PROJ-1', ... }
        const payload = response.data != null ? response.data : response;
        resolve(payload);
      });
    });
  }

  async getCurrentTabUrl() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab.url;
    } catch (error) {
      return 'URL not available';
    }
  }

  async saveBugReport(bugData) {
    return new Promise((resolve) => {
      // First, check current storage usage
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        const maxBytes = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB
        const usagePercent = (bytesInUse / maxBytes) * 100;
        
        // If usage is above 70%, clean data first
        if (usagePercent > 70) {
          chrome.storage.local.get(['bugReports'], (result) => {
            let reports = result.bugReports || [];
            // Keep only the 5 most recent reports
            reports = reports.slice(0, 5);
            
            chrome.storage.local.set({ bugReports: reports }, () => {
              this.saveReportAfterCleanup(bugData, resolve);
            });
          });
        } else {
          this.saveReportAfterCleanup(bugData, resolve);
        }
      });
    });
  }

  async sendToEasyVista(bugData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'SEND_TO_EASYVISTA',
        data: bugData
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Communication error: ${chrome.runtime.lastError.message}`));
          return;
        }
        if (!response) {
          reject(new Error('No response received from background script'));
          return;
        }
        if (response.success === false) {
          reject(new Error(response.error || 'Unknown error'));
          return;
        }
        const payload = response.data != null ? response.data : response;
        resolve(payload);
      });
    });
  }
  
  saveReportAfterCleanup(bugData, resolve) {
    chrome.storage.local.get(['bugReports'], (result) => {
      let reports = result.bugReports || [];
      
      // Create an optimized version of bugData (without large attachments)
      const optimizedBugData = {
        ...bugData,
        attachments: bugData.attachments ? bugData.attachments.map(att => {
          if (att.type === 'screenshot' && att.data) {
            // Reduce screenshot quality if necessary
            return {
              ...att,
              data: att.data.length > 500000 ? null : att.data, // Remove screenshots > 500KB
              note: att.data.length > 500000 ? 'Screenshot removed to save space' : att.note
            };
          }
          return att;
        }) : []
      };
      
      reports.unshift(optimizedBugData);
      
      // Limit to 10 reports to be more conservative
      if (reports.length > 10) {
        reports = reports.slice(0, 10);
      }
      
      chrome.storage.local.set({ bugReports: reports }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving report:', chrome.runtime.lastError.message);
          // Last attempt: save only essential data
          const essentialData = {
            title: bugData.title,
            description: bugData.description,
            priority: bugData.priority,
            environment: bugData.environment,
            timestamp: bugData.timestamp,
            attachments: [] // Remove all attachments
          };
          
          chrome.storage.local.set({ bugReports: [essentialData] }, () => {
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  }

  async loadBugHistory() {
    return new Promise((resolve) => {
      // Carregar relatórios manuais e AI em paralelo
      Promise.all([
        this.loadManualReports(),
        this.loadAIReports()
      ]).then(([manualReports, aiReports]) => {
        this.displayBugHistory(manualReports, aiReports);
        // Disparar migração de relatórios AI sem steps, se necessário (não bloqueante)
        this.migrateAIReportsIfNeeded().catch((err) => {
          console.warn('AI reports migration skipped/error:', err);
        });
        resolve();
      }).catch(error => {
        console.error('Error loading history:', error);
        this.displayBugHistory([], []);
        resolve();
      });
    });
  }
  
  async loadManualReports() {
    return new Promise((resolve) => {
      if (this.isExtensionContext()) {
        chrome.storage.local.get(['bugReports'], (result) => {
          resolve(result.bugReports || []);
        });
      } else {
        resolve([]);
      }
    });
  }
  
  async loadAIReports() {
    return new Promise((resolve) => {
      // Obter aba atual para carregar relatórios AI específicos
      if (this.isExtensionContext()) {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs.length === 0) {
            resolve([]);
            return;
          }
          
          const tabId = tabs[0].id;
          const key = `ai-reports-${tabId}`;
          
          chrome.storage.local.get([key], (result) => {
            const aiReports = result[key] || [];
            // Ordenar por data de criação (mais recentes primeiro) com robustez
            aiReports.sort((a, b) => {
              const getTs = (r) => {
                if (!r || !r.createdAt) return 0;
                const d = new Date(r.createdAt);
                return isNaN(d.getTime()) ? 0 : d.getTime();
              };
              return getTs(b) - getTs(a);
            });
            // Persistir a ordem ordenada para manter consistência com os índices exibidos
            try {
              chrome.storage.local.set({ [key]: aiReports }, () => {
                resolve(aiReports);
              });
            } catch (_) {
              resolve(aiReports);
            }
          });
        });
      } else {
        resolve([]);
      }
    });
  }

  // Verifica se há relatórios AI sem steps e dispara migração no background
  async migrateAIReportsIfNeeded() {
    if (!this.isExtensionContext()) return false;
    return new Promise((resolve) => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (!tabs || tabs.length === 0) { resolve(false); return; }
        const tabId = tabs[0].id;

        const key = `ai-reports-${tabId}`;
        const flagKey = `ai-migration-done-${tabId}`;

        chrome.storage.local.get([key, flagKey], (result) => {
          const alreadyDone = !!result[flagKey];
          const aiReports = result[key] || [];
          const missingSteps = aiReports.filter(r => {
            const steps = r && r.stepsToReproduce;
            return !steps || (Array.isArray(steps) && steps.length === 0) || (typeof steps === 'string' && steps.trim() === '');
          });

          if (alreadyDone || missingSteps.length === 0) {
            // Marcar como done para evitar nova checagem visual
            if (!alreadyDone) {
              chrome.storage.local.set({ [flagKey]: true }, () => resolve(false));
            } else {
              resolve(false);
            }
            return;
          }

          // Informar ao usuário que vamos migrar
          this.updateHistoryStatus('Migrando passos dos relatórios AI...', 'info');

          // Disparar migração no background
          chrome.runtime.sendMessage({ action: 'MIGRATE_AI_REPORT_STEPS', tabId }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn('Erro ao solicitar migração:', chrome.runtime.lastError.message);
              this.updateHistoryStatus('Falha ao migrar relatórios AI.', 'error');
              resolve(false);
              return;
            }

            if (response && response.success) {
              // Marcar flag de migração concluída para esta aba
              chrome.storage.local.set({ [flagKey]: true }, () => {
                this.updateHistoryStatus('Migração concluída. Atualizando histórico...', 'success');
                // Recarregar histórico para refletir novos steps
                this.loadBugHistory();
                resolve(true);
              });
            } else {
              const msg = (response && response.error) ? response.error : 'Migração não retornou sucesso.';
              this.updateHistoryStatus(`Falha na migração: ${msg}`, 'error');
              resolve(false);
            }
          });
        });
      });
    });
  }

  // Tornar getJiraTicketUrl síncrono usando o cache
  getJiraTicketUrl(ticketKey) {
    const baseUrl = this.cachedSettings?.jira?.baseUrl || 'https://jorgealijo.atlassian.net';
    return `${baseUrl}/browse/${ticketKey}`;
  }

  // Modificar displayBugHistory para exibir relatórios manuais e AI
  displayBugHistory(manualReports, aiReports = []) {
    const container = document.getElementById('bugHistory');
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    
    // Exibir relatórios AI primeiro (se houver)
    if (aiReports.length > 0) {
      this.displayAIReports(container, aiReports);
    }
    
    // Exibir relatórios manuais
    if (manualReports.length > 0) {
      this.displayManualReports(container, manualReports);
    }
    
    // Estado vazio se não há relatórios
    if (manualReports.length === 0 && aiReports.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      
      const icon = document.createElement('span');
      icon.className = 'material-icons empty-icon';
      icon.textContent = 'history';
      
      const text = document.createElement('p');
      text.textContent = 'No bugs registered yet';
      
      emptyState.appendChild(icon);
      emptyState.appendChild(text);
      container.appendChild(emptyState);
      return;
    }
  }
  
  displayAIReports(container, aiReports) {
    // Criar seção para relatórios AI
    const aiSection = document.createElement('div');
    aiSection.className = 'ai-reports-section';
    
    const aiHeader = document.createElement('div');
    aiHeader.className = 'section-header ai-header';
    aiHeader.innerHTML = `
      <span class="material-icons">smart_toy</span>
      <span>AI Generated Reports (${aiReports.length})</span>
    `;
    
    aiSection.appendChild(aiHeader);
    
    aiReports.forEach((report, index) => {
      const item = this.createAIReportItem(report, index);
      aiSection.appendChild(item);
    });
    
    container.appendChild(aiSection);
  }
  
  createAIReportItem(report, index) {
    const item = document.createElement('div');
    item.className = 'history-item ai-report-item';
    
    const truncatedTitle = report.title && report.title.length > 45 
      ? report.title.substring(0, 45) + '...' 
      : report.title;
    
    // Se o relatório foi enviado, mostrar o layout com link (Jira ou EasyVista)
    if (report.jiraKey || report.easyvistaUrl || report.easyvistaId) {
      let linkHtml = '';
      if (report.jiraKey) {
        const jiraUrl = this.getJiraTicketUrl(report.jiraKey);
        linkHtml = `<a href="${jiraUrl}" target="_blank" class="jira-link">${report.jiraKey}</a>`;
      } else if (report.easyvistaUrl || report.easyvistaId) {
        const text = report.easyvistaId ? `EV-${report.easyvistaId}` : 'EasyVista Ticket';
        const href = report.easyvistaUrl || '#';
        linkHtml = `<a href="${href}" target="_blank" class="jira-link">${text}</a>`;
      }
      item.innerHTML = `
        <div class="history-item-header-inline">
          <div class="history-title-inline">${truncatedTitle}</div>
          <div class="history-actions-inline">
            <button class="view-btn" title="View full report" data-index="${index}">
              <span class="material-icons">visibility</span>
            </button>
            <button class="delete-btn" title="Delete" data-index="${index}">
              <span class="material-icons">delete</span>
            </button>
          </div>
        </div>
        <div class="history-item-meta">
          ${linkHtml}
          <span class="timestamp">${new Date(report.jiraSentAt || report.createdAt).toLocaleString()}</span>
        </div>
      `;
    } else {
      // Layout padrão para relatórios não enviados
      item.innerHTML = `
        <div class="history-item-header-inline">
          <div class="history-title-inline">${truncatedTitle}</div>
          <div class="history-actions-inline">
            <button class="send-btn" title="Send" data-index="${index}">
              <span class="material-icons">send</span>
            </button>
            <button class="view-btn" title="View full report" data-index="${index}">
              <span class="material-icons">visibility</span>
            </button>
            <button class="delete-btn" title="Deletar" data-index="${index}">
              <span class="material-icons">delete</span>
            </button>
          </div>
        </div>
        <div class="history-item-meta">
          <span class="timestamp">${new Date(report.createdAt).toLocaleString()}</span>
        </div>
      `;
    }
    
    return item;
  }
  
  displayManualReports(container, reports) {
    // Criar seção para relatórios manuais se há relatórios AI
    const hasAIReports = container.querySelector('.ai-reports-section');
    if (hasAIReports) {
      const manualSection = document.createElement('div');
      manualSection.className = 'manual-reports-section';
      
      const manualHeader = document.createElement('div');
      manualHeader.className = 'section-header manual-header';
      manualHeader.innerHTML = `
        <span class="material-icons">bug_report</span>
        <span>Manual Reports (${reports.length})</span>
      `;
      
      manualSection.appendChild(manualHeader);
      container.appendChild(manualSection);
    }
    
    reports.forEach((report, index) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      
      if (report.jiraKey || report.easyvistaUrl || report.easyvistaId) {
        const maxTitleLength = 45;
        let linkHtml = '';
        let fullTitle = '';
        if (report.jiraKey) {
          const jiraUrl = this.getJiraTicketUrl(report.jiraKey);
          fullTitle = `${report.jiraKey} - ${report.title}`;
          const truncatedTitle = fullTitle.length > maxTitleLength 
            ? fullTitle.substring(0, maxTitleLength) + '...' 
            : fullTitle;
          linkHtml = `<a href="${jiraUrl}" target="_blank" class="jira-link-full">${truncatedTitle}</a>`;
        } else {
          const text = report.easyvistaId ? `EV-${report.easyvistaId}` : 'EasyVista Ticket';
          fullTitle = `${text} - ${report.title}`;
          const href = report.easyvistaUrl || '#';
          const truncatedTitle = fullTitle.length > maxTitleLength 
            ? fullTitle.substring(0, maxTitleLength) + '...' 
            : fullTitle;
          linkHtml = `<a href="${href}" target="_blank" class="jira-link-full">${truncatedTitle}</a>`;
        }
        
        item.innerHTML = `
          <div class="history-item-header-inline">
            <div class="history-title-inline">
              ${linkHtml}
            </div>
            <div class="history-actions-inline">
              <button class="delete-btn" title="Delete" data-index="${index}">
                <span class="material-icons">delete</span>
              </button>
            </div>
          </div>
          <div class="history-item-meta">
            <span class="timestamp">${new Date(report.createdAt || report.timestamp || Date.now()).toLocaleString()}</span>
          </div>
        `;
      } else {
        const maxTitleLength = 45;
        const truncatedTitle = report.title.length > maxTitleLength 
          ? report.title.substring(0, maxTitleLength) + '...' 
          : report.title;
        
        item.innerHTML = `
          <div class="history-item-header-inline">
            <div class="history-title-inline">${truncatedTitle}</div>
            <div class="history-actions-inline">
              <button class="send-btn" title="Send" data-index="${index}">
                <span class="material-icons">send</span>
              </button>
              <button class="view-btn" title="View details" data-index="${index}">
                <span class="material-icons">visibility</span>
              </button>
              <button class="delete-btn" title="Delete" data-index="${index}">
                <span class="material-icons">delete</span>
              </button>
            </div>
          </div>
          <div class="history-item-meta">
            <span class="timestamp">${new Date(report.createdAt || report.timestamp || Date.now()).toLocaleString()}</span>
          </div>
        `;
      }
      
      container.appendChild(item);
    });
  }

  // New method for submission retry (routes to Jira or EasyVista)
  async retrySubmission(index) {
    try {
      const settings = await this.getSettings();
      const jiraEnabled = !!(settings.jira && settings.jira.enabled);
      const evEnabled = !!(settings.easyvista && settings.easyvista.enabled);
      if (!jiraEnabled && !evEnabled) {
        this.updateHistoryStatus('No integration enabled. Configure in Settings.', 'error');
        return;
      }

      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['bugReports'], resolve);
      });
      const reports = result.bugReports || [];
      if (index < 0 || index >= reports.length) throw new Error(`Report index ${index} is out of bounds. Total reports: ${reports.length}`);
      const report = reports[index];
      if (!report) throw new Error(`Report not found at index ${index}`);

      let target = null;
      if (jiraEnabled && evEnabled) {
        target = settings.preferredTarget === 'easyvista' ? 'easyvista' : 'jira';
      } else if (jiraEnabled) {
        target = 'jira';
      } else if (evEnabled) {
        target = 'easyvista';
      }

      if (target === 'jira') {
        this.updateHistoryStatus('Resending to Jira...', 'loading');
        const jiraResponse = await this.sendToJira(report);
        const ticketKey = jiraResponse?.key || jiraResponse?.issueKey || jiraResponse?.data?.key || jiraResponse?.data?.issueKey;
        if (!ticketKey) throw new Error('Invalid Jira response: missing ticket key');

        const updatedResult = await new Promise((resolve) => {
          chrome.storage.local.get(['bugReports'], resolve);
        });
        const updatedReports = updatedResult.bugReports || [];
        const reportIndex = updatedReports.findIndex(r => 
          (r.createdAt === report.createdAt) || 
          (r.timestamp === report.timestamp) ||
          (r.title === report.title && Math.abs(new Date(r.createdAt || r.timestamp) - new Date(report.createdAt || report.timestamp)) < 1000)
        );
        if (reportIndex === -1) throw new Error('Report not found in updated storage');
        updatedReports[reportIndex].jiraKey = ticketKey;
        updatedReports[reportIndex].jiraAttempted = true;
        updatedReports[reportIndex].jiraSuccess = true;
        chrome.storage.local.set({ bugReports: updatedReports }, () => {
          this.updateHistoryStatus(`Sent successfully! Ticket: ${ticketKey}`, 'success');
          this.loadBugHistory();
        });
      } else if (target === 'easyvista') {
        this.updateHistoryStatus('Resending to EasyVista...', 'loading');
        const evResp = await this.sendToEasyVista(report);
        const evId = evResp?.ticketId || evResp?.data?.ticketId || evResp?.data?.id;
        const evUrl = evResp?.ticketUrl || evResp?.data?.ticketUrl;
        if (!evId && !evUrl) throw new Error('Invalid EasyVista response');

        const updatedResult = await new Promise((resolve) => {
          chrome.storage.local.get(['bugReports'], resolve);
        });
        const updatedReports = updatedResult.bugReports || [];
        const reportIndex = updatedReports.findIndex(r => 
          (r.createdAt === report.createdAt) || 
          (r.timestamp === report.timestamp) ||
          (r.title === report.title && Math.abs(new Date(r.createdAt || r.timestamp) - new Date(report.createdAt || report.timestamp)) < 1000)
        );
        if (reportIndex === -1) throw new Error('Report not found in updated storage');
        updatedReports[reportIndex].easyvistaId = evId || null;
        updatedReports[reportIndex].easyvistaUrl = evUrl || null;
        updatedReports[reportIndex].easyvistaAttempted = true;
        updatedReports[reportIndex].easyvistaSuccess = true;
        chrome.storage.local.set({ bugReports: updatedReports }, () => {
          this.updateHistoryStatus(`Sent successfully! EasyVista${evId ? ': ' + evId : ''}`, 'success');
          this.loadBugHistory();
        });
      }
    } catch (error) {
      console.error('Error resending report:', error);
      this.updateHistoryStatus('Error resending: ' + error.message, 'error');
    }
  }

  // New method to update a specific history card
  updateHistoryCard(index, report) {
    const historyContainer = document.getElementById('bugHistory');
    const cards = historyContainer.querySelectorAll('.history-item');
    
    if (cards[index]) {
      const card = cards[index];
      // Hide send button if already sent to any target
      const actionButtons = card.querySelector('.action-buttons, .history-actions-inline');
      const sentToJira = !!report.jiraKey;
      const sentToEV = !!(report.easyvistaId || report.easyvistaUrl);
      if (actionButtons && (sentToJira || sentToEV)) {
        const sendBtn = actionButtons.querySelector('.send-btn');
        if (sendBtn) {
          sendBtn.style.display = 'none';
        }
      }
    }
  }
  
  /**
   * Visualiza detalhes de um relatório AI
   * @param {number} index - Índice do relatório AI
   */
  async viewAIReport(index) {
    try {
      // Carregar relatórios AI já ordenados para manter consistência de índices
      const aiReports = await this.loadAIReports();
      if (index >= aiReports.length) return;
      
      const report = aiReports[index];
      
      // Criar modal para exibir detalhes
      this.showAIReportModal(report);
      
    } catch (error) {
      console.error('Error viewing AI report:', error);
    }
  }
  
  /**
   * Exibe modal com detalhes do relatório AI
   * @param {Object} report - Relatório AI
   */
  showAIReportModal(report) {
    // Remover modal existente se houver
    const existingModal = document.querySelector('.ai-report-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    // Preparar metadados padronizados
    const createdAt = new Date(report.createdAt || report.timestamp || Date.now()).toLocaleString();
    const pageUrlText = report.url || report.pageUrl || (report.originalError && report.originalError.url) || 'Not available';
    const priorityText = report.severity || 'Not defined';
    const categoryText = report.category || '';
    const environmentText = report.environment || '';
    const descriptionText = report.description || report.analysis || 'No description provided.';
    const stepsData = Array.isArray(report.stepsToReproduce)
      ? report.stepsToReproduce
      : (Array.isArray(report.steps) ? report.steps : []);

    // Construir lista de anexos para preview
    let attachmentsHTML = '';
    const attachments = Array.isArray(report.attachments) ? report.attachments : [];
    const items = [];
    if (attachments.length > 0) {
      attachments.forEach((attachment, idx) => {
        const name = attachment?.name || `Attachment ${idx + 1}`;
        let sizeBytes = Number(attachment?.size || 0);
        try {
          if (!sizeBytes || sizeBytes <= 0) {
            const data = attachment?.data;
            if (typeof data === 'string' && data.startsWith('data:')) {
              sizeBytes = this.calculateDataUrlSize(data);
            } else if (typeof data === 'string') {
              sizeBytes = new Blob([data]).size;
            }
          }
        } catch (_) { /* ignore size estimation errors */ }
        const sizeLabel = this.formatFileSize(sizeBytes || 0);
        items.push({ name, sizeLabel, pending: false });
      });
    } else {
      // Sem anexos persistidos em AI report: mostrar o que será enviado
      // Screenshot (se existir) como anexo
      if (report.screenshot) {
        const sizeBytes = this.calculateDataUrlSize(report.screenshot);
        items.push({ name: 'screenshot.png', sizeLabel: this.formatFileSize(sizeBytes), pending: false });
      }
      // Network details e console logs serão gerados no envio
      items.push({ name: 'network-details.json', sizeLabel: 'to be generated', pending: true });
      items.push({ name: 'console-logs-recent.txt', sizeLabel: 'to be generated', pending: true });
    }

    if (items.length > 0) {
      attachmentsHTML = `
        <div class="report-section">
          <h4><span class="material-icons">attach_file</span> Attachments (${items.length})</h4>
          <div class="attachments-list" id="aiAttachmentsList">
            ${items.map(item => `
              <div class="attachment-item${item.pending ? ' attachment-pending' : ''}" data-name="${item.name}">
                <span class="material-icons">insert_drive_file</span>
                <span>${item.name}</span>
                <span class="attachment-size">${item.sizeLabel}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Screenshot (se houver)
    const screenshotHTML = report.screenshot ? `
      <div class="report-section">
        <h4><span class="material-icons">image</span> Screenshot</h4>
        <img src="${report.screenshot}" alt="Screenshot" class="report-screenshot" />
      </div>
    ` : '';

    // Sugestões
    const suggestionsHTML = (report.suggestions && report.suggestions.length > 0) ? `
      <div class="report-section">
        <h4><span class="material-icons">tips_and_updates</span> Suggestions</h4>
        <ul class="suggestions-list">
          ${report.suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    // Criar modal
    const modal = document.createElement('div');
    modal.className = 'ai-report-modal';
    modal.innerHTML = `
      <div class="ai-report-modal-content">
        <div class="ai-report-modal-header">
          <h3 class="ai-report-modal-title">${report.title}</h3>
          <button class="ai-report-modal-close">&times;</button>
        </div>
        <div class="ai-report-modal-body">
          <div class="report-section">
            <h4><span class="material-icons">description</span> Description</h4>
            <p>${descriptionText}</p>
          </div>

          <div class="report-section">
            <h4><span class="material-icons">format_list_numbered</span> Steps to Reproduce</h4>
            <ol id="aiStepsList" class="steps-list"></ol>
          </div>

          ${report.expectedBehavior ? `
            <div class="report-section">
              <h4><span class="material-icons">check_circle</span> Expected Behavior</h4>
              <p>${report.expectedBehavior}</p>
            </div>
          ` : ''}

          ${report.actualBehavior ? `
            <div class="report-section">
              <h4><span class="material-icons">error</span> Actual Behavior</h4>
              <p>${report.actualBehavior}</p>
            </div>
          ` : ''}

          <div class="report-meta">
            <h4><span class="material-icons">info</span> Report Details</h4>
            <div class="meta-item"><span class="material-icons">flag</span><span>Priority: ${priorityText}</span></div>
            ${categoryText ? `<div class="meta-item"><span class="material-icons">category</span><span>Category: ${categoryText}</span></div>` : ''}
            ${environmentText ? `<div class="meta-item"><span class="material-icons">computer</span><span>Environment: ${environmentText}</span></div>` : ''}
            <div class="meta-item"><span class="material-icons">schedule</span><span>Created at: ${createdAt}</span></div>
            <div class="meta-item"><span class="material-icons">link</span><span class="meta-url" title="${pageUrlText}">Page URL: ${pageUrlText}</span></div>
            ${report.originalError && (report.originalError.status || report.originalError.statusText) ? `<div class="meta-item"><span class="material-icons">error</span><span>HTTP Error: ${[report.originalError.status, report.originalError.statusText].filter(Boolean).join(' ')}${report.originalError.method ? ' · ' + report.originalError.method : ''}</span></div>` : ''}
            ${report.originalError && report.originalError.url && report.originalError.url !== pageUrlText ? `<div class="meta-item"><span class="material-icons">link</span><span>Request URL: ${report.originalError.url}</span></div>` : ''}
          </div>
          
          
          ${attachmentsHTML}
          ${screenshotHTML}
          ${suggestionsHTML}
        </div>
      </div>
    `;
    
    // Adicionar event listener para fechar modal
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.classList.contains('ai-report-modal-close')) {
        modal.remove();
      }
    });
    
    // Prevenir scroll do body quando modal está aberto
    document.body.style.overflow = 'hidden';
    
    // Restaurar scroll quando modal for removido
    const originalRemove = modal.remove.bind(modal);
    modal.remove = function() {
      document.body.style.overflow = '';
      originalRemove();
    };
    
    document.body.appendChild(modal);

    // Tentar popular tamanhos de anexos gerados dinamicamente (apenas em contexto de extensão)
    this.tryPopulateAIAttachmentSizes(report, modal).catch(() => {});

    // Popular lista de passos com segurança (textContent) e suportar formatos string/objeto
    try {
      const listEl = modal.querySelector('#aiStepsList');
      if (listEl) {
        const toText = (step) => {
          if (typeof step === 'string') return step;
          if (!step || typeof step !== 'object') return '';
          const parts = [];
          const type = step.type || step.kind;
          const selector = step.selector || step.path;
          const text = step.text || step.value || '';
          if (type) parts.push(type);
          if (selector) parts.push(selector);
          if (text) parts.push(text);
          return parts.join(' - ') || JSON.stringify(step);
        };

        if (Array.isArray(stepsData) && stepsData.length > 0) {
          stepsData.slice(0, 20).forEach((s) => {
            const li = document.createElement('li');
            li.textContent = toText(s);
            listEl.appendChild(li);
          });
        } else {
          const li = document.createElement('li');
          li.textContent = 'No steps available for this report.';
          listEl.appendChild(li);
        }
      }
    } catch (_) { /* ignore steps population errors */ }

    // Toggle de detalhes do erro original
    try {
      const toggleBtn = modal.querySelector('.error-details-toggle');
      const detailsEl = modal.querySelector('.error-details');
      if (toggleBtn && detailsEl) {
        toggleBtn.addEventListener('click', () => {
          const isHidden = detailsEl.style.display === 'none';
          detailsEl.style.display = isHidden ? 'block' : 'none';
          toggleBtn.textContent = isHidden ? 'Hide details' : 'Show details';
        });
      }
    } catch (_) { /* ignore toggle errors */ }
  }

  async tryPopulateAIAttachmentSizes(report, modal) {
    try {
      if (!window.chrome || !chrome.runtime || !chrome.tabs) return;
      const list = modal.querySelector('#aiAttachmentsList');
      if (!list) return;

      // Obter tabId atual
      const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
      const tabId = tabs?.[0]?.id;
      if (!tabId) return;

      // Network details
      if (report?.originalError?.url) {
        const netResp = await new Promise(resolve => {
          try {
            chrome.runtime.sendMessage({ action: 'GET_NETWORK_DETAILS', tabId, url: report.originalError.url, timestamp: report.originalError.timestamp }, resolve);
          } catch (_) { resolve(null); }
        });
        const details = netResp?.success ? netResp.data : null;
        if (details) {
          const json = JSON.stringify(details, null, 2);
          const size = new Blob([json]).size;
          const el = list.querySelector('[data-name="network-details.json"] .attachment-size');
          if (el) el.textContent = this.formatFileSize(size);
          const item = list.querySelector('[data-name="network-details.json"]');
          if (item) item.classList.remove('attachment-pending');
        }
      }

      // Console logs recentes
      const logsResp = await new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({ action: 'GET_RECENT_LOGS', tabId, windowMs: 30000, limit: 100 }, resolve);
        } catch (_) { resolve(null); }
      });
      const logsData = logsResp?.success ? logsResp.data?.logs : null;
      if (Array.isArray(logsData) && logsData.length > 0) {
        const lines = logsData.map(l => `${new Date(l.timestamp || Date.now()).toLocaleTimeString()} [${l.level || 'log'}] ${l.message || l.text || ''}`);
        const txt = lines.join('\n');
        const size = new Blob([txt]).size;
        const el = list.querySelector('[data-name="console-logs-recent.txt"] .attachment-size');
        if (el) el.textContent = this.formatFileSize(size);
        const item = list.querySelector('[data-name="console-logs-recent.txt"]');
        if (item) item.classList.remove('attachment-pending');
      }
    } catch (_) {
      // silencioso
    }
  }
  
  /**
   * Deleta um relatório AI
   * @param {number} index - Índice do relatório AI
   */
  async deleteAIReport(index) {
    try {
      // Confirmar deleção com o usuário
      const confirmed = window.confirm('Are you sure you want to delete this AI report?');
      if (!confirmed) {
        return;
      }
      
      // Carregar relatórios AI já ordenados para manter consistência de índices
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      if (tabs.length === 0) return;
      const tabId = tabs[0].id;
      const key = `ai-reports-${tabId}`;
      const aiReports = await this.loadAIReports();
      if (index >= aiReports.length) return;
      
      // Remover relatório
      aiReports.splice(index, 1);
      
      // Salvar de volta
      await new Promise((resolve) => {
        chrome.storage.local.set({ [key]: aiReports }, resolve);
      });
      
      // Recarregar histórico
      await this.loadBugHistory();
      
      // Feedback de deleção
      this.updateHistoryStatus('AI report deleted', 'success');
      
    } catch (error) {
      console.error('Error deleting AI report:', error);
    }
  }

  // New method for history status
  updateHistoryStatus(message, type = 'info') {
    const statusElement = document.getElementById('historyStatus');
    const statusText = statusElement.querySelector('.status-text');
    const statusIcon = statusElement.querySelector('.status-icon');
    
    if (!message || message.trim() === '') {
      statusElement.style.display = 'none';
      return;
    }
    
    statusElement.style.display = 'block';
    statusText.textContent = message;
    
    statusElement.className = 'capture-status';
    statusElement.classList.add(`status-${type}`);
    
    const icons = {
      info: 'info',
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      loading: 'hourglass_empty'
    };
    
    statusIcon.textContent = icons[type] || 'info';
    
    // Auto-hide for all messages except loading
    if (type !== 'loading') {
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 3000);
    }
  }

  async clearHistory() {
    try {
      // Obter aba atual para limpar AI reports específicos da aba
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      
      // Remover relatórios manuais
      await chrome.storage.local.remove('bugReports');
      
      // Remover AI reports da aba atual se existir
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        const aiReportsKey = `ai-reports-${tabId}`;
        await chrome.storage.local.remove(aiReportsKey);
      }
      
      await this.loadBugHistory();
      this.updateHistoryStatus('History cleared', 'info');
    } catch (error) {
      console.error('Error clearing history:', error);
      this.updateHistoryStatus('Error clearing history', 'error');
    }
  }

  async deleteReport(index) {
    if (confirm('Are you sure you want to delete this report?')) {
      chrome.storage.local.get(['bugReports'], (result) => {
        const reports = result.bugReports || [];
        reports.splice(index, 1);
        
        chrome.storage.local.set({ bugReports: reports }, () => {
          this.loadBugHistory();
          this.updateHistoryStatus('Report deleted', 'success');
        });
      });
    }
  }

  viewReport(index) {
    chrome.storage.local.get(['bugReports'], (result) => {
      const reports = result.bugReports || [];
      const report = reports[index];
      
      if (report) {
        this.showManualReportModal(report);
      }
    });
  }

  showManualReportModal(report) {
    // Remove existing modal if any
    const existingModal = document.querySelector('.manual-report-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'manual-report-modal';
    modal.innerHTML = `
      <div class="manual-report-modal-content">
        <div class="manual-report-modal-header">
          <h3 class="manual-report-modal-title">${report.title}</h3>
          <button class="manual-report-modal-close">&times;</button>
        </div>
        <div class="manual-report-modal-body">
          <div class="report-section">
            <h4><span class="material-icons">description</span> Description</h4>
            <p>${report.description || 'No description provided.'}</p>
          </div>
          
          <div class="report-section">
            <h4><span class="material-icons">format_list_numbered</span> Steps to Reproduce</h4>
            <ol id="manualStepsList" class="steps-list"></ol>
          </div>
          
          ${report.expectedBehavior ? `
            <div class="report-section">
              <h4><span class="material-icons">check_circle</span> Expected Behavior</h4>
              <p>${report.expectedBehavior}</p>
            </div>
          ` : ''}
          
          ${report.actualBehavior ? `
            <div class="report-section">
              <h4><span class="material-icons">error</span> Actual Behavior</h4>
              <p>${report.actualBehavior}</p>
            </div>
          ` : ''}
          
          <div class="report-meta">
            <h4><span class="material-icons">info</span> Report Details</h4>
            <div class="meta-item">
              <span class="material-icons">flag</span>
              <span>Priority: ${report.priority || 'Not defined'}</span>
            </div>
            ${report.environment ? `
              <div class="meta-item">
                <span class="material-icons">computer</span>
                <span>Environment: ${report.environment}</span>
              </div>
            ` : ''}
            <div class="meta-item">
              <span class="material-icons">schedule</span>
              <span>Created at: ${new Date(report.createdAt || report.timestamp || Date.now()).toLocaleString()}</span>
            </div>
            <div class="meta-item">
              <span class="material-icons">link</span>
              <span class="meta-url" title="${report.url || report.pageUrl || 'Not available'}">Page URL: ${report.url || report.pageUrl || 'Not available'}</span>
            </div>
            ${report.originalError && (report.originalError.status || report.originalError.statusText) ? `<div class="meta-item"><span class="material-icons">error</span><span>HTTP Error: ${[report.originalError.status, report.originalError.statusText].filter(Boolean).join(' ')}${report.originalError.method ? ' · ' + report.originalError.method : ''}</span></div>` : ''}
            ${report.originalError && report.originalError.url && report.originalError.url !== (report.url || report.pageUrl) ? `<div class="meta-item"><span class="material-icons">link</span><span>Request URL: ${report.originalError.url}</span></div>` : ''}
          </div>

          ${report.attachments && report.attachments.length > 0 ? `
            <div class="report-section">
              <h4><span class="material-icons">attach_file</span> Attachments (${report.attachments.length})</h4>
              <div class="attachments-list">
                ${report.attachments.map((attachment, index) => `
                  <div class="attachment-item">
                    <span class="material-icons">insert_drive_file</span>
                    <span>${attachment.name || `Attachment ${index + 1}`}</span>
                    <span class="attachment-size">${this.formatFileSize(attachment.size || 0)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${report.screenshot ? `
            <div class="report-section">
              <h4><span class="material-icons">image</span> Screenshot</h4>
              <img src="${report.screenshot}" alt="Screenshot" class="report-screenshot" />
            </div>
          ` : ''}

          ${report.logs && report.logs.length > 0 ? `
            <div class="report-section">
              <h4><span class="material-icons">bug_report</span> Console Logs</h4>
              <pre class="report-logs">${report.logs.slice(0, 10).map(log => `[${log.level}] ${log.message}`).join('\n')}</pre>
              ${report.logs.length > 10 ? `<p class="logs-truncated">... and ${report.logs.length - 10} more entries</p>` : ''}
            </div>
          ` : ''}

          ${report.originalError ? `
            <div class="report-section">
              <h4 class="error-section-header">
                <span class="material-icons">error</span>
                <span>Original Error</span>
                <span class="error-status-badge">${[report.originalError.status, report.originalError.statusText].filter(Boolean).join(' ')}</span>
              </h4>
              <button class="error-details-toggle">Show details</button>
              <div class="error-details" style="display: none;">
                ${report.originalError.url && report.originalError.url !== (report.url || report.pageUrl) ? `<p><strong>Request URL:</strong> ${report.originalError.url}</p>` : ''}
                ${report.originalError.method ? `<p><strong>Method:</strong> ${report.originalError.method}</p>` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Add event listeners
    const closeBtn = modal.querySelector('.manual-report-modal-close');
    closeBtn.addEventListener('click', () => modal.remove());
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    document.body.appendChild(modal);

    // Popular lista numerada de passos com parsing seguro
    try {
      const listEl = modal.querySelector('#manualStepsList');
      if (listEl) {
        const rawSteps = Array.isArray(report.stepsToReproduce)
          ? report.stepsToReproduce
          : (Array.isArray(report.steps) ? report.steps : (typeof report.steps === 'string' ? report.steps : ''));

        const toText = (step) => {
          if (typeof step === 'string') return step;
          if (!step || typeof step !== 'object') return '';
          const parts = [];
          const type = step.type || step.kind;
          const selector = step.selector || step.path;
          const text = step.text || step.value || '';
          if (type) parts.push(type);
          if (selector) parts.push(selector);
          if (text) parts.push(text);
          return parts.join(' - ') || JSON.stringify(step);
        };

        let stepsArray = [];
        if (Array.isArray(rawSteps)) {
          stepsArray = rawSteps;
        } else if (typeof rawSteps === 'string' && rawSteps.trim().length > 0) {
          // Dividir por quebras de linha ou ponto e vírgula; remover numeração prefixada
          stepsArray = rawSteps.split(/\r?\n|;/).map(s => s.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
        }

        if (stepsArray.length > 0) {
          stepsArray.slice(0, 50).forEach((s) => {
            const li = document.createElement('li');
            li.textContent = toText(s);
            listEl.appendChild(li);
          });
        } else {
          const li = document.createElement('li');
          li.textContent = 'No steps provided.';
          listEl.appendChild(li);
        }
      }
    } catch (_) { /* ignore steps population errors */ }

    // Toggle de detalhes do erro original (manual)
    try {
      const toggleBtn = modal.querySelector('.error-details-toggle');
      const detailsEl = modal.querySelector('.error-details');
      if (toggleBtn && detailsEl) {
        toggleBtn.addEventListener('click', () => {
          const isHidden = detailsEl.style.display === 'none';
          detailsEl.style.display = isHidden ? 'block' : 'none';
          toggleBtn.textContent = isHidden ? 'Hide details' : 'Show details';
        });
      }
    } catch (_) { /* ignore toggle errors */ }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async sendAIReportToJira(index, report) {
    try {
      // Verificar se a integração Jira está habilitada
      const settings = await this.getSettings();
      if (!settings.jira || !settings.jira.enabled) {
        throw new Error('Jira integration is not enabled');
      }

      // Preparar dados do relatório AI para envio ao Jira
      const bugData = {
        title: report.title,
        description: report.description || report.analysis || 'AI-generated report',
        // Mapear steps do relatório de IA com sanitização de prefixos numéricos/bullets
        steps: Array.isArray(report.stepsToReproduce)
          ? report.stepsToReproduce.map(s => (s || '').replace(/^\s*(\d+[\)\.]|[-•])\s*/, '').trim())
          : [],
        expectedBehavior: report.expectedBehavior,
        actualBehavior: report.actualBehavior,
        // Usar severity do relatório de IA, apenas para descrição (não define prioridade Jira em AI)
        priority: report.severity || 'Medium',
        // Garantir URL correta (usar originalError.url se disponível)
        url: (report.originalError && report.originalError.url) || report.url || '',
        screenshot: report.screenshot || null,
        logs: report.logs || [],
        attachments: report.attachments || [],
        // Enviar timestamp esperado pelo template
        timestamp: report.createdAt || (report.originalError && report.originalError.timestamp) || new Date().toISOString(),
        // Incluir erro original para descrição detalhada no Jira
        originalError: report.originalError || null,
        isAIReport: true
      };

      // 🆕 Anexar detalhes completos de rede (headers + body) como arquivo JSON
      try {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({active: true, currentWindow: true}, resolve);
        });
        if (tabs && tabs.length > 0) {
          const tabId = tabs[0].id;
          // 1) Detalhes de rede
          const netDetailsResp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'GET_NETWORK_DETAILS',
              tabId,
              url: bugData.url,
              timestamp: bugData.timestamp
            }, resolve);
          });
          if (netDetailsResp && netDetailsResp.success && netDetailsResp.data) {
            const jsonContent = JSON.stringify(netDetailsResp.data, null, 2);
            bugData.attachments = bugData.attachments || [];
            bugData.attachments.push({
              type: 'json',
              name: 'network-details.json',
              data: jsonContent
            });
          }

          // 2) Logs de console recentes com parâmetros configuráveis
          try {
            // Extrair domínio para filtrar logs relevantes da aba corrente
            let domainFilter = '';
            try {
              const useUrl = bugData.url && bugData.url.startsWith('http') ? bugData.url : (tabs[0].url || '');
              domainFilter = new URL(useUrl).hostname || '';
            } catch (_) {
              domainFilter = '';
            }
            // Ler window/limit das configurações
            const cfg = this.cachedSettings?.capture || {};
            let winSec = Number(cfg.recentLogsWindowSeconds ?? 30);
            let lim = Number(cfg.recentLogsLimit ?? 10);
            winSec = isFinite(winSec) ? Math.max(30, Math.min(120, winSec)) : 30;
            lim = isFinite(lim) ? Math.max(10, Math.min(50, lim)) : 10;
            const windowMsCfg = winSec * 1000;
            const recentResp = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'GET_RECENT_LOGS',
                tabId,
                windowMs: windowMsCfg,
                limit: lim,
                domainFilter
              }, resolve);
            });
            if (recentResp && recentResp.success && Array.isArray(recentResp.data?.logs) && recentResp.data.logs.length > 0) {
              const lines = this.formatUnifiedLogs(recentResp.data.logs);
              if (lines && lines.length > 0) {
                bugData.attachments = bugData.attachments || [];
                bugData.attachments.push({
                  type: 'text',
                  name: 'console-logs-recent.txt',
                  data: lines.join('\n')
                });
              }
            }
          } catch (_) {
            // Silenciar falhas ao coletar console; envio continua
          }
        }
      } catch (_) {
        // Silenciar falhas ao obter detalhes de rede; envio ao Jira continua
      }

      // Enviar para Jira usando a função existente
      const jiraResponse = await this.sendToJira(bugData);
      const ticketKey = jiraResponse?.key || jiraResponse?.issueKey || jiraResponse?.data?.key || jiraResponse?.data?.issueKey;
      
      if (ticketKey) {
        // Obter aba atual para usar a chave correta
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({active: true, currentWindow: true}, resolve);
        });
        
        if (tabs.length === 0) {
            throw new Error('Could not get the current tab');
          }
        
        const tabId = tabs[0].id;
        const key = `ai-reports-${tabId}`;
        
        // Atualizar o relatório AI com o ID do ticket Jira usando o timestamp como identificador único
        chrome.storage.local.get([key], (result) => {
          const aiReports = result[key] || [];
          // Encontrar o relatório pelo timestamp em vez do índice para evitar problemas de sincronização
          const reportIndex = aiReports.findIndex(r => r.createdAt === report.createdAt);
          
          if (reportIndex !== -1) {
            aiReports[reportIndex].jiraKey = ticketKey;
            aiReports[reportIndex].jiraAttempted = true;
            aiReports[reportIndex].jiraSuccess = true;
            aiReports[reportIndex].jiraSentAt = new Date().toISOString();
            
            chrome.storage.local.set({ [key]: aiReports }, () => {
              // Recarregar o histórico para mostrar as mudanças
              this.loadBugHistory();
              this.updateHistoryStatus(`AI report sent to Jira: ${ticketKey}`, 'success');
            });
          } else {
              throw new Error('Report not found in storage');
            }
        });
      } else {
        throw new Error('Failed to get Jira ticket ID');
      }
    } catch (error) {
      console.error('Error sending AI report to Jira:', error);
      
      // Obter aba atual para usar a chave correta
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        const key = `ai-reports-${tabId}`;
        
        // Marcar como tentativa falhada usando o timestamp como identificador
        chrome.storage.local.get([key], (result) => {
          const aiReports = result[key] || [];
          const reportIndex = aiReports.findIndex(r => r.createdAt === report.createdAt);
          
          if (reportIndex !== -1) {
            aiReports[reportIndex].jiraAttempted = true;
            aiReports[reportIndex].jiraSuccess = false;
            aiReports[reportIndex].jiraError = error.message;
            aiReports[reportIndex].jiraSentAt = new Date().toISOString();
            
            chrome.storage.local.set({ [key]: aiReports }, () => {
              // Não recarregar o histórico em caso de erro para evitar conflitos de mensagem
              this.updateHistoryStatus(`Error sending to Jira: ${error.message}`, 'error');
            });
          }
        });
      }
    }
  }

  async sendAIReport(index, report) {
    const settings = await this.getSettings();
    const jiraEnabled = !!(settings.jira && settings.jira.enabled);
    const evEnabled = !!(settings.easyvista && settings.easyvista.enabled);
    if (!jiraEnabled && !evEnabled) {
      throw new Error('No integration enabled');
    }
    let target = null;
    if (jiraEnabled && evEnabled) {
      target = settings.preferredTarget === 'easyvista' ? 'easyvista' : 'jira';
    } else if (jiraEnabled) {
      target = 'jira';
    } else if (evEnabled) {
      target = 'easyvista';
    }
    if (target === 'jira') return this.sendAIReportToJira(index, report);
    return this.sendAIReportToEasyVista(index, report);
  }

  async sendAIReportToEasyVista(index, report) {
    try {
      const settings = await this.getSettings();
      if (!settings.easyvista || !settings.easyvista.enabled) {
        throw new Error('EasyVista integration is not enabled');
      }
      const bugData = {
        title: report.title,
        description: report.description || report.analysis || 'AI-generated report',
        steps: Array.isArray(report.stepsToReproduce)
          ? report.stepsToReproduce.map(s => (s || '').replace(/^\s*(\d+[\)\.]|[-•])\s*/, '').trim())
          : [],
        expectedBehavior: report.expectedBehavior,
        actualBehavior: report.actualBehavior,
        priority: report.severity || 'Medium',
        url: (report.originalError && report.originalError.url) || report.url || '',
        screenshot: report.screenshot || null,
        logs: report.logs || [],
        attachments: report.attachments || [],
        timestamp: report.createdAt || (report.originalError && report.originalError.timestamp) || new Date().toISOString(),
        originalError: report.originalError || null,
        isAIReport: true
      };

      // Attach network details and recent console logs (same as Jira flow)
      try {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({active: true, currentWindow: true}, resolve);
        });
        if (tabs && tabs.length > 0) {
          const tabId = tabs[0].id;
          const netDetailsResp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'GET_NETWORK_DETAILS',
              tabId,
              url: bugData.url,
              timestamp: bugData.timestamp
            }, resolve);
          });
          if (netDetailsResp && netDetailsResp.success && netDetailsResp.data) {
            const jsonContent = JSON.stringify(netDetailsResp.data, null, 2);
            bugData.attachments = bugData.attachments || [];
            bugData.attachments.push({ type: 'json', name: 'network-details.json', data: jsonContent });
          }

          try {
            let domainFilter = '';
            try {
              const useUrl = bugData.url && bugData.url.startsWith('http') ? bugData.url : (tabs[0].url || '');
              domainFilter = new URL(useUrl).hostname || '';
            } catch (_) { domainFilter = ''; }
            const cfg = this.cachedSettings?.capture || {};
            let winSec = Number(cfg.recentLogsWindowSeconds ?? 30);
            let lim = Number(cfg.recentLogsLimit ?? 10);
            winSec = isFinite(winSec) ? Math.max(30, Math.min(120, winSec)) : 30;
            lim = isFinite(lim) ? Math.max(10, Math.min(50, lim)) : 10;
            const windowMsCfg = winSec * 1000;
            const recentResp = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'GET_RECENT_LOGS',
                tabId,
                windowMs: windowMsCfg,
                limit: lim,
                domainFilter
              }, resolve);
            });
            if (recentResp && recentResp.success && Array.isArray(recentResp.data?.logs) && recentResp.data.logs.length > 0) {
              const lines = this.formatUnifiedLogs(recentResp.data.logs);
              if (lines && lines.length > 0) {
                bugData.attachments = bugData.attachments || [];
                bugData.attachments.push({ type: 'text', name: 'console-logs-recent.txt', data: lines.join('\n') });
              }
            }
          } catch (_) {}
        }
      } catch (_) {}

      const evResp = await this.sendToEasyVista(bugData);
      const evId = evResp?.ticketId || evResp?.data?.ticketId || evResp?.data?.id;
      const evUrl = evResp?.ticketUrl || evResp?.data?.ticketUrl;
      if (!evId && !evUrl) throw new Error('Failed to get EasyVista ticket info');

      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      if (tabs.length === 0) throw new Error('Could not get the current tab');
      const tabId = tabs[0].id;
      const key = `ai-reports-${tabId}`;
      chrome.storage.local.get([key], (result) => {
        const aiReports = result[key] || [];
        const reportIndex = aiReports.findIndex(r => r.createdAt === report.createdAt);
        if (reportIndex !== -1) {
          aiReports[reportIndex].easyvistaId = evId || null;
          aiReports[reportIndex].easyvistaUrl = evUrl || null;
          aiReports[reportIndex].easyvistaAttempted = true;
          aiReports[reportIndex].easyvistaSuccess = true;
          aiReports[reportIndex].easyvistaSentAt = new Date().toISOString();
          chrome.storage.local.set({ [key]: aiReports }, () => {
            this.loadBugHistory();
            this.updateHistoryStatus(`AI report sent to EasyVista${evId ? ': ' + evId : ''}`, 'success');
          });
        } else {
          throw new Error('Report not found in storage');
        }
      });
    } catch (error) {
      console.error('Error sending AI report to EasyVista:', error);
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        const key = `ai-reports-${tabId}`;
        chrome.storage.local.get([key], (result) => {
          const aiReports = result[key] || [];
          const reportIndex = aiReports.findIndex(r => r.createdAt === report.createdAt);
          if (reportIndex !== -1) {
            aiReports[reportIndex].easyvistaAttempted = true;
            aiReports[reportIndex].easyvistaSuccess = false;
            aiReports[reportIndex].easyvistaError = error.message;
            aiReports[reportIndex].easyvistaSentAt = new Date().toISOString();
            chrome.storage.local.set({ [key]: aiReports }, () => {
              this.updateHistoryStatus(`Error sending to EasyVista: ${error.message}`, 'error');
            });
          }
        });
      }
    }
  }

  openSettings() {
    // Open settings page in a new tab
    chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/settings.html') });
  }







  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async saveSettings() {
    try {
      // Salvando configurações do popup - silenciado
      
      // Carregar configurações existentes primeiro
      const result = await chrome.storage.local.get(['settings']);
      const existingSettings = result.settings || {};
      // Configurações existentes - silenciado
      
      // Fazer merge profundo preservando todas as configurações
      const updatedSettings = this.deepMerge(existingSettings, {
        popup: {
          autoCapture: document.getElementById('autoCapture').checked,
          includeConsole: document.getElementById('includeConsole').checked,
          maxFileSize: parseInt(document.getElementById('maxFileSize').value) || 5
        }
      });
      
      // Configurações após merge - silenciado
      await chrome.storage.local.set({ settings: updatedSettings });
      // Configurações do popup salvas - silenciado
      
    } catch (error) {
      console.error('❌ Error saving popup settings:', error);
    }
  }

  // Adicionar método deepMerge ao popup.js
  deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  calculateDataUrlSize(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    return Math.round((base64.length * 3) / 4);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  async loadPriorityOptions() {
    try {
      // Carregar de storage se disponível; caso contrário, usar cache/default
      let prioritiesSource = null;
      if (this.isExtensionContext()) {
        const result = await chrome.storage.local.get(['settings']);
        prioritiesSource = result.settings?.jira?.priorities || null;
      } else {
        prioritiesSource = this.cachedSettings?.jira?.priorities || null;
      }
      
      const defaultPriorities = {
        'highest': 'Highest',
        'high': 'High', 
        'medium': 'Medium',
        'low': 'Low',
        'lowest': 'Lowest'
      };
      
      const priorities = prioritiesSource || defaultPriorities;
      // Prioridades a serem usadas - silenciado
      
      const prioritySelect = document.getElementById('priority');
      if (!prioritySelect) {
        console.error('❌ Priority select element not found');
        return;
      }
      
      // Salvar valor atual antes de recriar opções
      const currentValue = prioritySelect.value;
      // Valor atual do select - silenciado
      
      prioritySelect.innerHTML = '<option value="">Select</option>';
      
      // Definir ordem específica das prioridades (do mais alto para o mais baixo)
      const priorityOrder = ['highest', 'high', 'medium', 'low', 'lowest'];
      
      // Adicionar prioridades na ordem correta
      priorityOrder.forEach(key => {
        if (priorities[key]) {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = priorities[key];
          prioritySelect.appendChild(option);
          // Adicionada opção - silenciado
        }
      });
      
      // Adicionar qualquer prioridade personalizada que não esteja na ordem padrão
      Object.entries(priorities).forEach(([key, value]) => {
        if (!priorityOrder.includes(key)) {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = value;
          prioritySelect.appendChild(option);
          // Adicionada opção personalizada - silenciado
        }
      });
      
      // Restaurar valor se ainda existir
      if (currentValue && priorities[currentValue]) {
        prioritySelect.value = currentValue;
        // Valor restaurado - silenciado
      }
      
      // Dropdown atualizada com sucesso - silenciado
    } catch (error) {
      console.error('❌ Error loading priorities:', error);
    }
  }

  // Métodos para gerenciamento de estado de gravação
  async checkRecordingState() {
    try {
      if (!this.isExtensionContext()) {
        return;
      }
      const response = await chrome.runtime.sendMessage({ action: 'GET_RECORDING_STATE' });
      if (response && response.success && response.state && response.state.isRecording) {
        console.log('[Popup] Ongoing recording detected, restoring state...');
        
        // Calcular tempo decorrido e restante
        const elapsed = Date.now() - response.state.startTime;
        const remaining = response.state.maxDuration - elapsed;
        
        if (remaining > 1000) { // Se ainda há mais de 1 segundo restante
          // Tentar restaurar gravação ativa
          await this.attemptRecordingRecovery(remaining);
        } else {
          // Gravação deve ter terminado, limpar estado
          console.log('[Popup] Recording expired, clearing state...');
          await this.handleExpiredRecording();
        }
      }
    } catch (error) {
      console.error('[Popup] Error checking recording state:', error);
    }
  }

  async attemptRecordingRecovery(remainingTime) {
    try {
      // Verificar se ainda temos acesso ao stream de mídia
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        console.log('[Popup] MediaRecorder still active, continuing recording...');
        await this.restoreRecordingUI(remainingTime);
        return;
      }
      
      // Se não temos MediaRecorder ativo, mostrar opções de recuperação
      this.showRecoveryOptions(remainingTime);
      
    } catch (error) {
      console.error('[Popup] Error recovering recording:', error);
      this.showRecoveryOptions(remainingTime);
    }
  }

  async restoreRecordingUI(remainingTime) {
    this.isRecording = true;
    
    const button = document.getElementById('startRecording');
    if (!button) {
      console.warn('[Popup] startRecording button not found when restoring UI');
      return;
    }
    
    const btnText = button.querySelector('.btn-text');
    if (!btnText) {
      console.warn('[Popup] Element .btn-text not found when restoring UI');
      return;
    }
    
    btnText.textContent = 'Stop';
    button.classList.add('recording');
    
    const totalSeconds = Math.ceil(remainingTime/1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      this.updateCaptureStatus(`Recording restored... (${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} remaining)`, 'success');
    
    // Calcular tempo total baseado nas configurações
    const settings = await this.getSettings();
    const maxDuration = (settings.capture?.maxVideoLength || 30) * 1000;
    const elapsedTime = maxDuration - remainingTime;
    
    this.updateRecordingTimer(maxDuration, elapsedTime);
  }

  showRecoveryOptions(remainingTime) {
    const statusDiv = document.getElementById('captureStatus');
    if (!statusDiv) {
      console.warn('[Popup] captureStatus element not found to show recovery options');
      return;
    }
    
    statusDiv.innerHTML = `
      <div class="recovery-options" style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 12px; margin: 8px 0;">
        <div style="color: #856404; font-weight: bold; margin-bottom: 8px;">
          🔄 Interrupted Recording Detected
        </div>
        <div style="color: #856404; margin-bottom: 12px; font-size: 14px;">
          A recording was in progress (${(() => {
            const totalSeconds = Math.ceil(remainingTime/1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
          })()} remaining). What would you like to do?
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button id="continueRecording" class="btn btn-primary" style="font-size: 12px; padding: 6px 12px;">
            ▶️ Continue Recording
          </button>
          <button id="cancelRecording" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
            ❌ Cancel
          </button>
        </div>
      </div>
    `;
    
    // Adicionar event listeners para os botões de recuperação
    const continueBtn = document.getElementById('continueRecording');
    const cancelBtn = document.getElementById('cancelRecording');
    
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        this.continueRecording(remainingTime);
      });
    } else {
      console.warn('[Popup] continueRecording button not found');
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.cancelRecording();
      });
    } else {
      console.warn('[Popup] cancelRecording button not found');
    }
  }

  async continueRecording(remainingTime) {
    try {
      // Iniciar nova gravação com o tempo restante
      const settings = await this.getSettings();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          mediaSource: 'screen',
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });
      
      // Configurar MediaRecorder
      const options = { 
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 1000000,
        audioBitsPerSecond: 128000
      };
      
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8';
        options.videoBitsPerSecond = 800000;
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = 'video/webm';
          options.videoBitsPerSecond = 600000;
        }
      }
      
      this.mediaRecorder = new MediaRecorder(stream, options);
      this.recordedChunks = [];
      this.recordingStartTime = Date.now() - (settings.capture?.maxVideoLength * 1000 - remainingTime);
      
      // Configurar timeout para o tempo restante
      this.recordingTimeout = setTimeout(() => {
        if (this.isRecording) {
          this.updateCaptureStatus('Recording automatically finished', 'warning');
          this.stopRecording();
        }
      }, remainingTime);
      
      // Event listeners
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.onstop = () => {
        if (this.recordingTimeout) {
          clearTimeout(this.recordingTimeout);
          this.recordingTimeout = null;
        }
        
        stream.getTracks().forEach(track => track.stop());
        
        const blob = new Blob(this.recordedChunks, { type: options.mimeType });
        const duration = (Date.now() - this.recordingStartTime) / 1000;
        
        const maxSize = 50 * 1024 * 1024;
        if (blob.size > maxSize) {
          this.updateCaptureStatus('Recording too large (>50MB)', 'error');
          return;
        }
        
        const reader = new FileReader();
        reader.onload = () => {
          this.addAttachment({
            type: 'recording',
            name: `screen_recording_recovered_${Date.now()}.webm`,
            data: reader.result,
            size: blob.size,
            duration: Math.round(duration)
          });
          this.updateCaptureStatus(`Recording recovered successfully! (${Math.round(duration)}s)`, 'success');
        };
        reader.readAsDataURL(blob);
      };
      
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.isRecording) {
          this.updateCaptureStatus('Screen sharing ended', 'info');
          this.stopRecording();
        }
      });
      
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      await this.restoreRecordingUI(remainingTime);
      
    } catch (error) {
      console.error('[Popup] Error continuing recording:', error);
      this.updateCaptureStatus('Error continuing recording', 'error');
      this.cancelRecording();
    }
  }

  async cancelRecording() {
    try {
      await chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
      this.updateCaptureStatus('Recording canceled', 'info');
      this.resetRecordingButton();
    } catch (error) {
      console.error('[Popup] Error canceling recording:', error);
    }
  }

  async handleExpiredRecording() {
    try {
      await chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
      this.updateCaptureStatus('Previous recording expired', 'warning');
      this.resetRecordingButton();
    } catch (error) {
      console.error('[Popup] Error clearing expired recording:', error);
    }
  }

  async notifyRecordingStart(maxDuration) {
    try {
      await chrome.runtime.sendMessage({
        action: 'START_RECORDING',
        maxDuration: maxDuration
      });
      console.log('[Popup] Background notified about recording start');
    } catch (error) {
      console.error('[Popup] Error notifying recording start:', error);
    }
  }

  async notifyRecordingStop() {
    try {
      await chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
      console.log('[Popup] Background notified about recording stop');
    } catch (error) {
      console.error('[Popup] Error notifying recording stop:', error);
    }
  }

  handleBackgroundMessage(message, sender, sendResponse) {
    console.log('[Popup] Message received from background:', message);
    
    switch (message.type) {
      case 'AI_REPORT_STORED':
        // Atualizar imediatamente o histórico ao armazenar novo relatório AI
        this.loadBugHistory();
        break;
      case 'VIDEO_ATTACHED':
        this.handleVideoAttached(message);
        break;
      default:
        console.log('[Popup] Unknown message type:', message.type);
    }
    
    sendResponse({ success: true });
  }

  async handleVideoAttached(message) {
    try {
      if (message.success && message.videoKey) {
        // Sucesso - carregar o vídeo e adicionar aos anexos
        console.log('[Popup] Video attached successfully:', message.videoKey);
        
        let videoData = null;
        let storedItem = null;
        
        // Tentar recuperar dados do vídeo do storage com múltiplas abordagens
        try {
          // Primeira tentativa: chrome.storage.local direto
          const chromeStorageData = await chrome.storage.local.get(message.videoKey);
          if (chromeStorageData[message.videoKey]) {
            videoData = chromeStorageData;
            storedItem = chromeStorageData[message.videoKey];
            console.log('[Popup] Video found in chrome.storage.local');
          }
        } catch (chromeError) {
          console.warn('[Popup] Error accessing chrome.storage.local:', chromeError.message);
        }
        
        // Segunda tentativa: usar StorageManager se disponível
        if (!storedItem && typeof StorageManager !== 'undefined') {
          try {
            console.log('[Popup] Trying to retrieve video via StorageManager...');
            const storageManager = new StorageManager();
            const retrievedData = await storageManager.retrieve(message.videoKey, 'chrome');
            if (retrievedData) {
              storedItem = retrievedData;
              console.log('[Popup] Video found via StorageManager');
            }
          } catch (storageManagerError) {
            console.warn('[Popup] Error using StorageManager:', storageManagerError.message);
          }
        }
        
        // Terceira tentativa: buscar por padrão de chave similar
        if (!storedItem) {
          try {
            console.log('[Popup] Trying to find video by key pattern...');
            const allData = await chrome.storage.local.get(null);
            const videoKeys = Object.keys(allData).filter(key => 
              key.includes('video_') && key.includes(message.videoKey.split('_')[1])
            );
            
            if (videoKeys.length > 0) {
              const foundKey = videoKeys[0];
              storedItem = allData[foundKey];
              console.log(`[Popup] Video found with alternative key: ${foundKey}`);
            }
          } catch (searchError) {
            console.warn('[Popup] Error searching by pattern:', searchError.message);
          }
        }
        
        if (storedItem) {
          // O StorageManager armazena dados com metadados
          const video = storedItem.data || storedItem;
          
          // Validar se os dados do vídeo são válidos
          if (!video || (!video.data && typeof video !== 'string')) {
            throw new Error('Video data is corrupted or invalid');
          }
          
          // Criar anexo de vídeo
          const attachment = {
            type: 'video',
            name: `video_recording_${Date.now()}.webm`,
            data: video.data || video,
            timestamp: storedItem.timestamp || Date.now(),
            size: storedItem.size || this.calculateDataUrlSize(video.data || video)
          };
          
          // Adicionar aos anexos
          this.addAttachment(attachment);
          
          // Exibir mensagem de sucesso
          this.updateCaptureStatus('Video recording completed successfully!', 'success');
          
          // Limpar dados temporários do storage
          try {
            await chrome.storage.local.remove(message.videoKey);
          } catch (cleanupError) {
            console.warn('[Popup] Error clearing temporary data:', cleanupError.message);
          }
        } else {
          // Dados não encontrados após todas as tentativas
          console.error('[Popup] Video data not found after multiple attempts');
          console.error('[Popup] Searched key:', message.videoKey);
          
          // List available keys for debugging
          try {
            const allKeys = await chrome.storage.local.get(null);
            const videoKeys = Object.keys(allKeys).filter(key => key.includes('video_'));
            console.error('[Popup] Available video keys:', videoKeys);
          } catch (debugError) {
            console.error('[Popup] Error listing keys for debug:', debugError.message);
          }
          
          throw new Error(`Video data not found in storage (key: ${message.videoKey})`);
        }
      } else {
        // Recording error
        const errorMsg = message.error || 'Unknown recording error';
        console.error('[Popup] Recording error:', errorMsg);
        this.updateCaptureStatus(`❌ Recording failed: ${errorMsg}`, 'error');
      }
    } catch (error) {
      console.error('[Popup] Error processing attached video:', error);
      
      // Mensagem de erro mais específica
      let errorMessage = '❌ Error processing video recording';
      if (error.message.includes('not found')) {
        errorMessage = '❌ Video not found - it may have expired or been removed';
      } else if (error.message.includes('corrupted')) {
        errorMessage = '❌ Video data is corrupted';
      } else if (error.message.includes('quota exceeded')) {
        errorMessage = '❌ Storage full - clear old data and try again';
      }
      
      this.updateCaptureStatus(errorMessage, 'error');
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    window.bugSpotter = new BugSpotter();
    await window.bugSpotter.init();

    // Modo de preview: abrir modal de relatório manual com steps numerados
    const params = new URLSearchParams(window.location.search);
    if (params.get('previewManualSteps') === '1') {
      const mockReport = {
        title: 'Preview Manual Report',
        description: 'Exemplo de descrição de bug para preview.',
        steps: '1. Abrir a página X\n2. Clicar no botão Y\n3. Observar erro Z',
        expectedBehavior: 'Deveria carregar sem erros.',
        actualBehavior: 'Aparece erro 500.',
        priority: 'High',
        environment: 'Chrome 118 / macOS',
        timestamp: new Date().toISOString(),
        url: 'https://example.com'
      };
      window.bugSpotter.showManualReportModal(mockReport);
    }
  } catch (error) {
    console.error('[Popup] Error during initialization:', error);
  }
});

// Adicionar error boundary global
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Prevenir que o erro apareça no console
  event.preventDefault();
});