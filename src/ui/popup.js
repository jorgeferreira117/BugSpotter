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
  
  async init() {
    // 🆕 Notificar background que popup foi aberto (para limpar badge)
    try {
      console.log('[Popup] Enviando mensagem POPUP_OPENED para limpar badge...');
      const response = await chrome.runtime.sendMessage({ action: 'POPUP_OPENED' });
      console.log('[Popup] Resposta do background:', response);
    } catch (error) {
      console.error('[Popup] Erro ao enviar mensagem POPUP_OPENED:', error);
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
    
    // ADICIONAR: Listener para mudanças nas configurações
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.settings) {
        this.loadPriorityOptions(); // Recarregar prioridades quando settings mudam
        this.cachedSettings = changes.settings.newValue; // Atualizar cache
      }
    });
  }

  setupEventListeners() {
    // Event listeners for main buttons
    document.getElementById('captureScreenshot').addEventListener('click', () => this.captureScreenshot());
    document.getElementById('captureLogs').addEventListener('click', () => this.captureLogs());
    document.getElementById('captureDOM').addEventListener('click', () => this.captureDOM());
    document.getElementById('startRecording').addEventListener('click', () => this.startRecording());
    document.getElementById('clearHistory').addEventListener('click', () => this.clearHistory());
    document.getElementById('openSettings').addEventListener('click', () => this.openSettings());
    

    
    // Event listener for bug form
    document.getElementById('bugForm').addEventListener('submit', (e) => this.submitBug(e));
    
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
        
        // Verificar se é um relatório AI ou manual
        const historyItem = e.target.closest('.history-item');
        if (historyItem && historyItem.classList.contains('ai-report-item')) {
          // É um relatório AI - buscar o relatório pelo índice
          this.loadAIReports().then(aiReports => {
            const report = aiReports[index];
            if (report) {
              this.sendAIReportToJira(index, report).catch(error => {
                console.error('Error sending AI report to Jira:', error);
                this.updateHistoryStatus(`Erro ao enviar para Jira: ${error.message}`, 'error');
              });
            } else {
              console.error('AI report not found at index:', index);
              this.updateHistoryStatus('Relatório AI não encontrado', 'error');
            }
          }).catch(error => {
            console.error('Error loading AI reports:', error);
            this.updateHistoryStatus('Erro ao carregar relatórios AI', 'error');
          });
        } else {
          // É um relatório manual
          this.retryJiraSubmission(index);
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
      console.warn('[Popup] Elemento captureStatus não encontrado');
      return;
    }
    
    const statusText = statusElement.querySelector('.status-text');
    const statusIcon = statusElement.querySelector('.status-icon');
    
    if (!statusText) {
      console.warn('[Popup] Elemento .status-text não encontrado');
      return;
    }
    
    if (!statusIcon) {
      console.warn('[Popup] Elemento .status-icon não encontrado');
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
        console.log('[Popup] Aba não existe mais, pulando captura de screenshot');
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
    
    this.updateCaptureStatus('Capturing logs...', 'loading');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Tentar usar Chrome Debugger API primeiro
      let logData = await this.captureLogsWithDebugger(tab.id);
      
      // Se falhar, usar método tradicional como fallback
      if (!logData || logData.length === 0) {
        // Debugger API failed, using fallback method - silenciado
        logData = await this.captureLogsTraditional(tab.id);
      }
      
      if (logData && logData.length > 0) {
        const attachment = {
          type: 'logs',
          name: `console_logs_${Date.now()}.txt`,
          data: logData.join('\n'),
          size: new Blob([logData.join('\n')]).size
        };
        
        const added = this.addAttachment(attachment);
        
        if (added) {
          this.updateCaptureStatus('Logs captured successfully!', 'success');
        }
      } else {
        this.updateCaptureStatus('No logs found', 'warning');
      }
    } catch (error) {
      console.error('Error capturing logs:', error);
      this.updateCaptureStatus('Error capturing logs', 'error');
    } finally {
      button.disabled = false;
      btnText.textContent = 'Logs';
    }
  }

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
        console.error('[DEBUG] Falha ao anexar debugger:', attachResult.error);
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
        console.error('[DEBUG] Falha ao obter logs:', logsResult.error);
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
      
      // 🆕 CORREÇÃO: Incluir logs de erro HTTP com corpo da resposta (com limite)
      if (logsResult.data.logs && formattedLogs.length < maxLogs) {
        logsResult.data.logs.forEach(log => {
          if (formattedLogs.length >= maxLogs) return; // Parar se atingir o limite
          
          const timestamp = log.timestamp || new Date().toISOString();
          
          // Incluir apenas erros HTTP (mais relevantes para debugging)
          if (log.type === 'http-error-with-body' || log.type === 'http-error') {
            // Log de erro HTTP com detalhes completos
            let errorText = `${timestamp}: ${log.text}`;
            
            // Adicionar corpo da resposta se disponível (limitado)
            if (log.decodedBody) {
              const body = log.decodedBody.length > 500 ? log.decodedBody.substring(0, 500) + '...' : log.decodedBody;
              errorText += `\nResponse Body: ${body}`;
            } else if (log.responseBody) {
              const body = log.responseBody.length > 500 ? log.responseBody.substring(0, 500) + '...' : log.responseBody;
              errorText += `\nResponse Body: ${body}`;
            }
            
            formattedLogs.push(errorText);
          } else if (log.text && (log.text.includes('error') || log.text.includes('Error') || log.text.includes('failed'))) {
            // Outros logs apenas se contiverem palavras-chave de erro
            formattedLogs.push(`${timestamp}: ${log.text}`);
          }
        });
      }
      
      // Incluir apenas erros de rede (status >= 400)
      if (logsResult.data.networkRequests && formattedLogs.length < maxLogs) {
        logsResult.data.networkRequests.forEach(req => {
          if (formattedLogs.length >= maxLogs) return; // Parar se atingir o limite
          
          const timestamp = new Date(req.timestamp).toISOString();
          
          // Só adicionar se for um erro HTTP (status >= 400)
          if (req.status && req.status >= 400) {
            let method = req.method || 'Unknown';
            let status = req.status || 'Unknown';
            let url = req.url || 'Unknown URL';
            
            if (req.text) {
              formattedLogs.push(`${timestamp}: ${req.text}`);
            } else {
              formattedLogs.push(`${timestamp}: [NETWORK ERROR] ${method} ${status} - ${url}`);
            }
          }
        });
      }
      
      // Logs formatados - silenciado
      
      // Desanexar debugger após captura
      try {
        await chrome.runtime.sendMessage({
          action: 'DETACH_DEBUGGER',
          tabId: tabId
        });
        // Debugger desanexado com sucesso - silenciado
      } catch (detachError) {
        console.warn('[DEBUG] Erro ao desanexar debugger:', detachError);
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
        console.warn('[DEBUG] Erro ao desanexar debugger após falha:', detachError);
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
        console.log('[Popup] Aba não existe mais, pulando captura tradicional de logs');
        return null;
      }
      console.error('Traditional capture failed:', error);
      return null;
    }
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
        console.log('[Popup] Aba não existe mais, pulando captura de DOM');
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
      
      this.updateCaptureStatus('Preparando gravação...', 'loading');
      
      // Obter aba ativa
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      
      if (!activeTab) {
        throw new Error('Nenhuma aba ativa encontrada');
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
      
      this.updateCaptureStatus('Overlay de gravação injetado!', 'success');
      
      // Fechar popup após 1 segundo
      setTimeout(() => {
        window.close();
      }, 1000);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      
      let errorMessage = 'Erro ao iniciar gravação';
      if (error.message.includes('Cannot access')) {
        errorMessage = 'Não é possível gravar nesta página. Tente em uma página web normal (http/https).';
      } else if (error.message.includes('Nenhuma aba')) {
        errorMessage = 'Nenhuma aba ativa encontrada';
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
      console.warn('[Popup] Botão startRecording não encontrado');
      return;
    }
    
    const btnText = button.querySelector('.btn-text');
    if (!btnText) {
      console.warn('[Popup] Elemento .btn-text não encontrado');
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
    bugData.status = 'open';
  
    try {
      // Try to send to Jira if configured
      const settings = await this.getSettings();
      if (settings.jira && settings.jira.enabled) {
        try {
          bugData.jiraAttempted = true;
          const jiraResponse = await this.sendToJira(bugData);
          // Jira response - silenciado
          
          if (jiraResponse && jiraResponse.key) {
            // Add Jira key to report before saving
            bugData.jiraKey = jiraResponse.key;
            this.updateReportStatus(`Report sent successfully! Ticket: ${jiraResponse.key}`, 'success');
          } else {
            this.updateReportStatus('Saved locally. Error sending to Jira: Invalid response', 'warning');
          }
        } catch (jiraError) {
          console.error('Error sending to Jira:', jiraError);
          this.updateReportStatus('Saved locally. Error sending to Jira: ' + jiraError.message, 'warning');
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

  async getSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      const settings = result.settings || {};
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
        capture: {
          autoCaptureLogs: settings.capture?.autoCaptureLogs ?? true,
          screenshotFormat: settings.capture?.screenshotFormat ?? 'png',
          maxVideoLength: settings.capture?.maxVideoLength ?? 30,
          screenshotQuality: settings.capture?.screenshotQuality ?? 90
        },
        jira: {
          enabled: settings.jira?.enabled ?? false,
          url: settings.jira?.url || '',
          username: settings.jira?.username || '',
          token: settings.jira?.token || '',
          projectKey: settings.jira?.projectKey || '',
          priorities: settings.jira?.priorities || defaultPriorities
        }
      };
      
      // Configurações finais do popup - silenciado
      return finalSettings;
      
    } catch (error) {
      console.error('❌ Erro ao carregar configurações:', error);
      return {
        autoCapture: true,
        includeConsole: true,
        maxFileSize: 5,
        capture: {
          autoCaptureLogs: true,
          screenshotFormat: 'png',
          maxVideoLength: 30,
          screenshotQuality: 90
        },
        jira: {
          enabled: false,
          url: '',
          username: '',
          token: '',
          projectKey: '',
          priorities: {
            'highest': 'Highest',
            'high': 'High',
            'medium': 'Medium',
            'low': 'Low',
            'lowest': 'Lowest'
          }
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
        
        // Check if response exists and has expected structure
        if (!response) {
          reject(new Error('No response received from background script'));
          return;
        }
        
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
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
        resolve();
      }).catch(error => {
        console.error('Erro ao carregar histórico:', error);
        this.displayBugHistory([], []);
        resolve();
      });
    });
  }
  
  async loadManualReports() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['bugReports'], (result) => {
        resolve(result.bugReports || []);
      });
    });
  }
  
  async loadAIReports() {
    return new Promise((resolve) => {
      // Obter aba atual para carregar relatórios AI específicos
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs.length === 0) {
          resolve([]);
          return;
        }
        
        const tabId = tabs[0].id;
        const key = `ai-reports-${tabId}`;
        
        chrome.storage.local.get([key], (result) => {
          const aiReports = result[key] || [];
          // Ordenar por data de criação (mais recentes primeiro)
          aiReports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          resolve(aiReports);
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
    
    // Se o relatório foi enviado para Jira, mostrar o layout com link
    if (report.jiraKey) {
      const jiraUrl = this.getJiraTicketUrl(report.jiraKey);
      item.innerHTML = `
        <div class="history-item-header-inline">
          <div class="history-title-inline">${truncatedTitle}</div>
          <div class="history-actions-inline">
            <button class="view-btn" title="Ver relatório completo" data-index="${index}">
              <span class="material-icons">visibility</span>
            </button>
            <button class="delete-btn" title="Deletar" data-index="${index}">
              <span class="material-icons">delete</span>
            </button>
          </div>
        </div>
        <div class="history-item-meta">
          <a href="${jiraUrl}" target="_blank" class="jira-link">${report.jiraKey}</a>
          <span class="timestamp">${new Date(report.jiraSentAt || report.createdAt).toLocaleString()}</span>
        </div>
      `;
    } else {
      // Layout padrão para relatórios não enviados
      item.innerHTML = `
        <div class="history-item-header-inline">
          <div class="history-title-inline">${truncatedTitle}</div>
          <div class="history-actions-inline">
            <button class="send-btn" title="Enviar para Jira" data-index="${index}">
              <span class="material-icons">send</span>
            </button>
            <button class="view-btn" title="Ver relatório completo" data-index="${index}">
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
      
      if (report.jiraKey) {
        const jiraUrl = this.getJiraTicketUrl(report.jiraKey);
        const maxTitleLength = 45;
        const fullTitle = `${report.jiraKey} - ${report.title}`;
        const truncatedTitle = fullTitle.length > maxTitleLength 
          ? fullTitle.substring(0, maxTitleLength) + '...' 
          : fullTitle;
        
        // Reports já enviados para Jira não têm botão de preview
        item.innerHTML = `
          <div class="history-item-header-inline">
            <div class="history-title-inline">
              <a href="${jiraUrl}" target="_blank" class="jira-link-full">${truncatedTitle}</a>
            </div>
            <div class="history-actions-inline">
              <button class="delete-btn" title="Deletar" data-index="${index}">
                <span class="material-icons">delete</span>
              </button>
            </div>
          </div>
          <div class="history-item-meta">
            <span class="timestamp">${new Date(report.createdAt || report.timestamp || Date.now()).toLocaleString()}</span>
          </div>
        `;
      } else if (report.jiraAttempted === false) {
        const maxTitleLength = 45;
        const truncatedTitle = report.title.length > maxTitleLength 
          ? report.title.substring(0, maxTitleLength) + '...' 
          : report.title;
        
        item.innerHTML = `
          <div class="history-item-header-inline">
            <div class="history-title-inline">${truncatedTitle}</div>
            <div class="history-actions-inline">
              <button class="send-btn" title="Enviar para Jira" data-index="${index}">
                <span class="material-icons">send</span>
              </button>
              <button class="view-btn" title="Ver detalhes" data-index="${index}">
                <span class="material-icons">visibility</span>
              </button>
              <button class="delete-btn" title="Deletar" data-index="${index}">
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
              <button class="send-btn" title="Enviar para Jira" data-index="${index}">
                <span class="material-icons">send</span>
              </button>
              <button class="view-btn" title="Ver detalhes" data-index="${index}">
                <span class="material-icons">visibility</span>
              </button>
              <button class="delete-btn" title="Deletar" data-index="${index}">
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

  // New method for Jira submission retry
  async retryJiraSubmission(index) {
    try {
      // Verificar se a integração Jira está habilitada
      const settings = await this.getSettings();
      if (!settings.jira || !settings.jira.enabled) {
        this.updateHistoryStatus('Integração com Jira não está habilitada. Configure nas configurações.', 'error');
        return;
      }

      this.updateHistoryStatus('Resending to Jira...', 'loading');
      
      // Use chrome.storage.local instead of localStorage
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['bugReports'], resolve);
      });
      
      const reports = result.bugReports || [];
      
      // Verificar se o índice é válido
      if (index < 0 || index >= reports.length) {
        throw new Error(`Report index ${index} is out of bounds. Total reports: ${reports.length}`);
      }
      
      const report = reports[index];
      
      if (!report) {
        throw new Error(`Report not found at index ${index}`);
      }
      
      const jiraResponse = await this.sendToJira(report);
      
      // Update report with jiraKey using chrome.storage.local
      // Recarregar os dados para garantir que temos a versão mais atual
      const updatedResult = await new Promise((resolve) => {
        chrome.storage.local.get(['bugReports'], resolve);
      });
      
      const updatedReports = updatedResult.bugReports || [];
      
      // Encontrar o relatório pelo timestamp para evitar problemas de índice
      const reportIndex = updatedReports.findIndex(r => 
        (r.createdAt === report.createdAt) || 
        (r.timestamp === report.timestamp) ||
        (r.title === report.title && Math.abs(new Date(r.createdAt || r.timestamp) - new Date(report.createdAt || report.timestamp)) < 1000)
      );
      
      if (reportIndex === -1) {
        throw new Error('Report not found in updated storage');
      }
      
      updatedReports[reportIndex].jiraKey = jiraResponse.key;
      updatedReports[reportIndex].jiraAttempted = true;
      updatedReports[reportIndex].jiraSuccess = true;
      
      chrome.storage.local.set({ bugReports: updatedReports }, () => {
        this.updateHistoryStatus(`Sent successfully! Ticket: ${jiraResponse.key}`, 'success');
        
        // Recarregar o histórico para mostrar as mudanças
        this.loadBugHistory();
      });
      
    } catch (error) {
      console.error('Error resending to Jira:', error);
      this.updateHistoryStatus('Error resending: ' + error.message, 'error');
    }
  }

  // New method to update a specific history card
  updateHistoryCard(index, report) {
    const historyContainer = document.getElementById('bugHistory');
    const cards = historyContainer.querySelectorAll('.history-item');
    
    if (cards[index]) {
      const card = cards[index];
      
      // Update Jira status
      const jiraStatus = card.querySelector('.jira-status');
      if (jiraStatus) {
        if (report.jiraKey) {
          jiraStatus.innerHTML = `
            <span class="material-icons status-icon success">check_circle</span>
            <span class="status-text">Sent: ${report.jiraKey}</span>
          `;
          jiraStatus.className = 'jira-status success';
        }
      }
      
      // Update action buttons
      const actionButtons = card.querySelector('.action-buttons');
      if (actionButtons && report.jiraKey) {
        const sendBtn = actionButtons.querySelector('.send-btn');
        if (sendBtn) {
          sendBtn.style.display = 'none'; // Hide resend button
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
      // Obter aba atual
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      
      if (tabs.length === 0) return;
      
      const tabId = tabs[0].id;
      const key = `ai-reports-${tabId}`;
      
      // Carregar relatórios AI
      const result = await new Promise((resolve) => {
        chrome.storage.local.get([key], resolve);
      });
      
      const aiReports = result[key] || [];
      if (index >= aiReports.length) return;
      
      const report = aiReports[index];
      
      // Criar modal para exibir detalhes
      this.showAIReportModal(report);
      
    } catch (error) {
      console.error('Erro ao visualizar relatório AI:', error);
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
          <div class="report-meta">
            <span class="severity-badge severity-${report.severity}">${(report.severity || 'unknown').toUpperCase()}</span>
            <span class="category-badge">${report.category}</span>
            <span class="timestamp">${new Date(report.createdAt).toLocaleString()}</span>
          </div>
          
          <div class="report-section">
            <h4>Descrição</h4>
            <p>${report.description}</p>
          </div>
          
          <div class="report-section">
            <h4>Erro Original</h4>
            <div class="error-details">
              <p><strong>Status:</strong> ${report.originalError.status} ${report.originalError.statusText}</p>
              <p><strong>URL:</strong> ${report.originalError.url}</p>
              <p><strong>Timestamp:</strong> ${new Date(report.originalError.timestamp).toLocaleString()}</p>
            </div>
          </div>
          
          ${report.suggestions && report.suggestions.length > 0 ? `
            <div class="report-section">
              <h4>Sugestões</h4>
              <ul class="suggestions-list">
                ${report.suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
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
  }
  
  /**
   * Deleta um relatório AI
   * @param {number} index - Índice do relatório AI
   */
  async deleteAIReport(index) {
    try {
      // Obter aba atual
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      
      if (tabs.length === 0) return;
      
      const tabId = tabs[0].id;
      const key = `ai-reports-${tabId}`;
      
      // Carregar relatórios AI
      const result = await new Promise((resolve) => {
        chrome.storage.local.get([key], resolve);
      });
      
      const aiReports = result[key] || [];
      if (index >= aiReports.length) return;
      
      // Remover relatório
      aiReports.splice(index, 1);
      
      // Salvar de volta
      await new Promise((resolve) => {
        chrome.storage.local.set({ [key]: aiReports }, resolve);
      });
      
      // Recarregar histórico
      await this.loadBugHistory();
      
      // Relatório AI deletado com sucesso - silenciado
      
    } catch (error) {
      console.error('Erro ao deletar relatório AI:', error);
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
            <h4><span class="material-icons">description</span> Descrição</h4>
            <p>${report.description || 'Nenhuma descrição fornecida.'}</p>
          </div>
          
          ${report.steps ? `
            <div class="report-section">
              <h4><span class="material-icons">list</span> Passos para Reproduzir</h4>
              <p>${report.steps}</p>
            </div>
          ` : ''}
          
          ${report.expectedBehavior ? `
            <div class="report-section">
              <h4><span class="material-icons">check_circle</span> Comportamento Esperado</h4>
              <p>${report.expectedBehavior}</p>
            </div>
          ` : ''}
          
          ${report.actualBehavior ? `
            <div class="report-section">
              <h4><span class="material-icons">error</span> Comportamento Atual</h4>
              <p>${report.actualBehavior}</p>
            </div>
          ` : ''}
          
          <div class="report-meta">
            <div class="meta-item">
              <span class="material-icons">flag</span>
              <span>Prioridade: ${report.priority || 'Não definida'}</span>
            </div>
            ${report.environment ? `
              <div class="meta-item">
                <span class="material-icons">computer</span>
                <span>Ambiente: ${report.environment}</span>
              </div>
            ` : ''}
            <div class="meta-item">
              <span class="material-icons">schedule</span>
              <span>Criado em: ${new Date(report.createdAt || report.timestamp || Date.now()).toLocaleString()}</span>
            </div>
            <div class="meta-item">
              <span class="material-icons">link</span>
              <span>URL: ${report.url || 'Não disponível'}</span>
            </div>
          </div>

          ${report.attachments && report.attachments.length > 0 ? `
            <div class="report-section">
              <h4><span class="material-icons">attach_file</span> Anexos (${report.attachments.length})</h4>
              <div class="attachments-list">
                ${report.attachments.map((attachment, index) => `
                  <div class="attachment-item">
                    <span class="material-icons">insert_drive_file</span>
                    <span>${attachment.name || `Anexo ${index + 1}`}</span>
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
              <h4><span class="material-icons">bug_report</span> Logs de Console</h4>
              <pre class="report-logs">${report.logs.slice(0, 10).map(log => `[${log.level}] ${log.message}`).join('\n')}</pre>
              ${report.logs.length > 10 ? `<p class="logs-truncated">... e mais ${report.logs.length - 10} entradas</p>` : ''}
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
        throw new Error('Integração com Jira não está habilitada');
      }

      // Preparar dados do relatório AI para envio ao Jira
      const bugData = {
        title: report.title,
        description: report.analysis || report.description || 'Relatório gerado por AI',
        priority: report.severity || 'Medium',
        url: report.url || '',
        screenshot: report.screenshot || null,
        logs: report.logs || [],
        attachments: report.attachments || [],
        createdAt: report.createdAt || new Date().toISOString(),
        isAIReport: true
      };

      // Enviar para Jira usando a função existente
      const jiraResponse = await this.sendToJira(bugData);
      
      if (jiraResponse && jiraResponse.key) {
        // Obter aba atual para usar a chave correta
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({active: true, currentWindow: true}, resolve);
        });
        
        if (tabs.length === 0) {
          throw new Error('Não foi possível obter a aba atual');
        }
        
        const tabId = tabs[0].id;
        const key = `ai-reports-${tabId}`;
        
        // Atualizar o relatório AI com o ID do ticket Jira usando o timestamp como identificador único
        chrome.storage.local.get([key], (result) => {
          const aiReports = result[key] || [];
          // Encontrar o relatório pelo timestamp em vez do índice para evitar problemas de sincronização
          const reportIndex = aiReports.findIndex(r => r.createdAt === report.createdAt);
          
          if (reportIndex !== -1) {
            aiReports[reportIndex].jiraKey = jiraResponse.key;
            aiReports[reportIndex].jiraAttempted = true;
            aiReports[reportIndex].jiraSuccess = true;
            aiReports[reportIndex].jiraSentAt = new Date().toISOString();
            
            chrome.storage.local.set({ [key]: aiReports }, () => {
              // Recarregar o histórico para mostrar as mudanças
              this.loadBugHistory();
              this.updateHistoryStatus(`Relatório AI enviado para Jira: ${jiraResponse.key}`, 'success');
            });
          } else {
            throw new Error('Relatório não encontrado no storage');
          }
        });
      } else {
        throw new Error('Falha ao obter ID do ticket Jira');
      }
    } catch (error) {
      console.error('Erro ao enviar relatório AI para Jira:', error);
      
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
              this.updateHistoryStatus(`Erro ao enviar para Jira: ${error.message}`, 'error');
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
      console.error('❌ Erro ao salvar configurações do popup:', error);
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
      // Carregando opções de prioridade - silenciado
      const result = await chrome.storage.local.get(['settings']);
      // Storage completo - silenciado
      
      const defaultPriorities = {
        'highest': 'Highest',
        'high': 'High', 
        'medium': 'Medium',
        'low': 'Low',
        'lowest': 'Lowest'
      };
      
      const priorities = result.settings?.jira?.priorities || defaultPriorities;
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
      console.error('❌ Erro ao carregar prioridades:', error);
    }
  }

  // Métodos para gerenciamento de estado de gravação
  async checkRecordingState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_RECORDING_STATE' });
      if (response && response.success && response.state && response.state.isRecording) {
        console.log('[Popup] Gravação em andamento detectada, restaurando estado...');
        
        // Calcular tempo decorrido e restante
        const elapsed = Date.now() - response.state.startTime;
        const remaining = response.state.maxDuration - elapsed;
        
        if (remaining > 1000) { // Se ainda há mais de 1 segundo restante
          // Tentar restaurar gravação ativa
          await this.attemptRecordingRecovery(remaining);
        } else {
          // Gravação deve ter terminado, limpar estado
          console.log('[Popup] Gravação expirou, limpando estado...');
          await this.handleExpiredRecording();
        }
      }
    } catch (error) {
      console.error('[Popup] Erro ao verificar estado de gravação:', error);
    }
  }

  async attemptRecordingRecovery(remainingTime) {
    try {
      // Verificar se ainda temos acesso ao stream de mídia
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        console.log('[Popup] MediaRecorder ainda ativo, continuando gravação...');
        await this.restoreRecordingUI(remainingTime);
        return;
      }
      
      // Se não temos MediaRecorder ativo, mostrar opções de recuperação
      this.showRecoveryOptions(remainingTime);
      
    } catch (error) {
      console.error('[Popup] Erro na recuperação da gravação:', error);
      this.showRecoveryOptions(remainingTime);
    }
  }

  async restoreRecordingUI(remainingTime) {
    this.isRecording = true;
    
    const button = document.getElementById('startRecording');
    if (!button) {
      console.warn('[Popup] Botão startRecording não encontrado ao restaurar UI');
      return;
    }
    
    const btnText = button.querySelector('.btn-text');
    if (!btnText) {
      console.warn('[Popup] Elemento .btn-text não encontrado ao restaurar UI');
      return;
    }
    
    btnText.textContent = 'Stop';
    button.classList.add('recording');
    
    const totalSeconds = Math.ceil(remainingTime/1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      this.updateCaptureStatus(`Gravação restaurada... (${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} restantes)`, 'success');
    
    // Calcular tempo total baseado nas configurações
    const settings = await this.getSettings();
    const maxDuration = (settings.capture?.maxVideoLength || 30) * 1000;
    const elapsedTime = maxDuration - remainingTime;
    
    this.updateRecordingTimer(maxDuration, elapsedTime);
  }

  showRecoveryOptions(remainingTime) {
    const statusDiv = document.getElementById('captureStatus');
    if (!statusDiv) {
      console.warn('[Popup] Elemento captureStatus não encontrado para mostrar opções de recuperação');
      return;
    }
    
    statusDiv.innerHTML = `
      <div class="recovery-options" style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 12px; margin: 8px 0;">
        <div style="color: #856404; font-weight: bold; margin-bottom: 8px;">
          🔄 Gravação Interrompida Detectada
        </div>
        <div style="color: #856404; margin-bottom: 12px; font-size: 14px;">
          Uma gravação estava em andamento (${(() => {
            const totalSeconds = Math.ceil(remainingTime/1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
          })()} restantes). O que deseja fazer?
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button id="continueRecording" class="btn btn-primary" style="font-size: 12px; padding: 6px 12px;">
            ▶️ Continuar Gravação
          </button>
          <button id="cancelRecording" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
            ❌ Cancelar
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
      console.warn('[Popup] Botão continueRecording não encontrado');
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.cancelRecording();
      });
    } else {
      console.warn('[Popup] Botão cancelRecording não encontrado');
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
          this.updateCaptureStatus('Gravação finalizada automaticamente', 'warning');
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
          this.updateCaptureStatus('Gravação muito grande (>50MB)', 'error');
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
          this.updateCaptureStatus(`Gravação recuperada com sucesso! (${Math.round(duration)}s)`, 'success');
        };
        reader.readAsDataURL(blob);
      };
      
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.isRecording) {
          this.updateCaptureStatus('Compartilhamento de tela encerrado', 'info');
          this.stopRecording();
        }
      });
      
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      await this.restoreRecordingUI(remainingTime);
      
    } catch (error) {
      console.error('[Popup] Erro ao continuar gravação:', error);
      this.updateCaptureStatus('Erro ao continuar gravação', 'error');
      this.cancelRecording();
    }
  }

  async cancelRecording() {
    try {
      await chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
      this.updateCaptureStatus('Gravação cancelada', 'info');
      this.resetRecordingButton();
    } catch (error) {
      console.error('[Popup] Erro ao cancelar gravação:', error);
    }
  }

  async handleExpiredRecording() {
    try {
      await chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
      this.updateCaptureStatus('Gravação anterior expirou', 'warning');
      this.resetRecordingButton();
    } catch (error) {
      console.error('[Popup] Erro ao limpar gravação expirada:', error);
    }
  }

  async notifyRecordingStart(maxDuration) {
    try {
      await chrome.runtime.sendMessage({
        action: 'START_RECORDING',
        maxDuration: maxDuration
      });
      console.log('[Popup] Background notificado sobre início da gravação');
    } catch (error) {
      console.error('[Popup] Erro ao notificar início da gravação:', error);
    }
  }

  async notifyRecordingStop() {
    try {
      await chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
      console.log('[Popup] Background notificado sobre parada da gravação');
    } catch (error) {
      console.error('[Popup] Erro ao notificar parada da gravação:', error);
    }
  }

  handleBackgroundMessage(message, sender, sendResponse) {
    console.log('[Popup] Mensagem recebida do background:', message);
    
    switch (message.type) {
      case 'VIDEO_ATTACHED':
        this.handleVideoAttached(message);
        break;
      default:
        console.log('[Popup] Tipo de mensagem desconhecido:', message.type);
    }
    
    sendResponse({ success: true });
  }

  async handleVideoAttached(message) {
    try {
      if (message.success && message.videoKey) {
        // Sucesso - carregar o vídeo e adicionar aos anexos
        console.log('[Popup] Vídeo anexado com sucesso:', message.videoKey);
        
        // Recuperar dados do vídeo do storage
        const videoData = await chrome.storage.local.get(message.videoKey);
        if (videoData[message.videoKey]) {
          const storedItem = videoData[message.videoKey];
          // O StorageManager armazena dados com metadados
          const video = storedItem.data || storedItem;
          
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
          this.updateCaptureStatus('Gravação de vídeo concluída com sucesso!', 'success');
          
          // Limpar dados temporários do storage
          await chrome.storage.local.remove(message.videoKey);
        } else {
          throw new Error('Dados do vídeo não encontrados no storage');
        }
      } else {
        // Erro na gravação
        const errorMsg = message.error || 'Erro desconhecido na gravação';
        console.error('[Popup] Erro na gravação:', errorMsg);
        this.updateCaptureStatus(`❌ Falha na gravação: ${errorMsg}`, 'error');
      }
    } catch (error) {
      console.error('[Popup] Erro ao processar vídeo anexado:', error);
      this.updateCaptureStatus('❌ Erro ao processar gravação de vídeo', 'error');
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    window.bugSpotter = new BugSpotter();
    await window.bugSpotter.init();
  } catch (error) {
    console.error('[Popup] Erro na inicialização:', error);
  }
});

// Adicionar error boundary global
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Prevenir que o erro apareça no console
  event.preventDefault();
});