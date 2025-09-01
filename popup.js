class BugSpotter {
  constructor() {
    this.attachments = [];
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.reportStatusTimeout = null;
    this.captureStatusTimeout = null;
    this.cachedSettings = null; // Adicionar cache das configurações
  }
  
  async init() {
    // Carregar configurações no cache
    this.cachedSettings = await this.getSettings();
    await this.loadBugHistory();
    this.setupEventListeners();
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
        const index = e.target.closest('.send-btn').dataset.index;
        this.retryJiraSubmission(parseInt(index));
      }
      if (e.target.closest('.delete-btn')) {
        const index = e.target.closest('.delete-btn').dataset.index;
        this.deleteReport(parseInt(index));
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
    const statusText = statusElement.querySelector('.status-text');
    const statusIcon = statusElement.querySelector('.status-icon');
    
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
    console.log('captureScreenshot started');
    const button = document.getElementById('captureScreenshot');
    const btnText = button.querySelector('.btn-text');
    
    // Check only if already in process
    if (button.disabled) {
      return;
    }
    
    console.log('Elements found:', { button, btnText });
    
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
      console.error('Error capturing screenshot:', error);
      this.updateCaptureStatus('Error capturing screenshot', 'error');
    } finally {
      button.disabled = false;
      btnText.textContent = 'Screenshot';
    }
  }

  async captureLogs() {
    console.log('captureLogs started');
    const button = document.getElementById('captureLogs');
    const btnText = button.querySelector('.btn-text');
    
    // Check only if already in process
    if (button.disabled) {
      return;
    }
    
    console.log('Elements found:', { button, btnText });
    
    button.disabled = true;
    btnText.textContent = 'Capturing...';
    
    this.updateCaptureStatus('Capturing logs...', 'loading');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Tentar usar Chrome Debugger API primeiro
      let logData = await this.captureLogsWithDebugger(tab.id);
      
      // Se falhar, usar método tradicional como fallback
      if (!logData || logData.length === 0) {
        console.log('Debugger API failed, using fallback method');
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
      console.log('[DEBUG] Iniciando captura com Chrome Debugger API para tab:', tabId);
      
      // Anexar debugger
      console.log('[DEBUG] Tentando anexar debugger...');
      const attachResult = await chrome.runtime.sendMessage({
        action: 'ATTACH_DEBUGGER',
        tabId: tabId
      });
      
      console.log('[DEBUG] Resultado do attach:', attachResult);
      
      if (!attachResult.success) {
        console.error('[DEBUG] Falha ao anexar debugger:', attachResult.error);
        throw new Error(attachResult.error || 'Failed to attach debugger');
      }
      
      console.log('[DEBUG] Debugger anexado com sucesso, aguardando logs...');
      
      // Aguardar um pouco para capturar logs
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Obter logs do debugger
      console.log('[DEBUG] Solicitando logs do debugger...');
      const logsResult = await chrome.runtime.sendMessage({
        action: 'GET_DEBUGGER_LOGS',
        tabId: tabId
      });
      
      console.log('[DEBUG] Resultado dos logs:', logsResult);
      
      if (!logsResult.success) {
        console.error('[DEBUG] Falha ao obter logs:', logsResult.error);
        throw new Error(logsResult.error || 'Failed to get debugger logs');
      }
      
      console.log('[DEBUG] Logs obtidos, quantidade:', logsResult.data?.logs?.length || 0);
      
      // Formatar logs para exibição
      const formattedLogs = [];
      
      if (logsResult.data.logs) {
        logsResult.data.logs.forEach(log => {
          const timestamp = new Date(log.timestamp).toISOString();
          
          if (log.type === 'console') {
            // Correção: verificar se log.level existe antes de usar toUpperCase()
            const level = log.level ? log.level.toUpperCase() : 'LOG';
            const text = log.text || '';
            formattedLogs.push(`[${level}] ${timestamp}: ${text}`);
          } else if (log.type === 'console-api') {
            // Correção: verificar se log.level existe antes de usar toUpperCase()
            const level = log.level ? log.level.toUpperCase() : 'LOG';
            const args = log.args ? log.args.map(arg => arg.value || arg.description || JSON.stringify(arg)).join(' ') : '';
            formattedLogs.push(`[${level}] ${timestamp}: ${args}`);
          }
        });
      }
      
      if (logsResult.data.networkRequests) {
        logsResult.data.networkRequests.forEach(req => {
          const timestamp = new Date(req.timestamp).toISOString();
          // 🆕 CORREÇÃO: Acessar propriedades corretas dos logs de rede
          let method = 'Unknown';
          let status = 'Unknown';
          let url = req.url || 'Unknown URL';
          
          // Se for uma requisição (Network.requestWillBeSent)
          if (req.method) {
            method = req.method;
          }
          
          // Se for uma resposta (Network.responseReceived) ou combinado
          if (req.status) {
            status = req.status;
          }
          
          // Se tiver texto formatado, usar ele
          if (req.text) {
            formattedLogs.push(`${timestamp}: ${req.text}`);
          } else {
            // Fallback para formatação manual
            formattedLogs.push(`[NETWORK] ${timestamp}: ${method} ${status} ${url}`);
          }
        });
      }
      
      console.log('[DEBUG] Logs formatados:', formattedLogs.length, 'entradas');
      
      // Desanexar debugger após captura
      try {
        await chrome.runtime.sendMessage({
          action: 'DETACH_DEBUGGER',
          tabId: tabId
        });
        console.log('[DEBUG] Debugger desanexado com sucesso');
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
          
          // If no captured logs, initialize capture
          window.capturedLogs = [];
          
          // Override console methods to capture logs
          console.log = function(...args) {
            window.capturedLogs.push(`[LOG] ${new Date().toISOString()}: ${args.join(' ')}`);
            originalLog.apply(console, args);
          };
          
          console.error = function(...args) {
            window.capturedLogs.push(`[ERROR] ${new Date().toISOString()}: ${args.join(' ')}`);
            originalError.apply(console, args);
          };
          
          console.warn = function(...args) {
            window.capturedLogs.push(`[WARN] ${new Date().toISOString()}: ${args.join(' ')}`);
            originalWarn.apply(console, args);
          };
          
          console.info = function(...args) {
            window.capturedLogs.push(`[INFO] ${new Date().toISOString()}: ${args.join(' ')}`);
            originalInfo.apply(console, args);
          };
          
          // Capture JavaScript errors
          window.addEventListener('error', (event) => {
            window.capturedLogs.push(`[JS ERROR] ${new Date().toISOString()}: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
          });
          
          // Capture rejected Promise errors
          window.addEventListener('unhandledrejection', (event) => {
            window.capturedLogs.push(`[PROMISE ERROR] ${new Date().toISOString()}: ${event.reason}`);
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
      console.error('Traditional capture failed:', error);
      return null;
    }
  }

  async captureDOM() {
    console.log('captureDOM started');
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
      console.error('Error capturing DOM:', error);
      this.updateCaptureStatus('Error capturing DOM', 'error');
    } finally {
      button.disabled = false;
      btnText.textContent = 'DOM';
    }
  }

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen' },
        audio: true
      });
      
      this.mediaRecorder = new MediaRecorder(stream);
      this.recordedChunks = [];
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          this.addAttachment({
            type: 'recording',
            name: `screen_recording_${Date.now()}.webm`,
            data: reader.result,
            size: blob.size
          });
          this.updateCaptureStatus('Recording saved successfully!', 'success');
        };
        reader.readAsDataURL(blob);
      };
      
      this.mediaRecorder.start();
      this.isRecording = true;
      
      const button = document.getElementById('startRecording');
      const btnText = button.querySelector('.btn-text');
      btnText.textContent = 'Stop';
      button.classList.add('recording');
      
      this.updateCaptureStatus('Recording screen...', 'loading');
    } catch (error) {
      console.error('Error starting recording:', error);
      this.updateCaptureStatus('Error starting recording', 'error');
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      
      const button = document.getElementById('startRecording');
      const btnText = button.querySelector('.btn-text');
      btnText.textContent = 'Video';
      button.classList.remove('recording');
      
      this.updateCaptureStatus('Finalizing recording...', 'loading');
    }
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
        recording: 'videocam'
      };
      
      item.innerHTML = `
        <div class="attachment-info">
          <span class="material-icons attachment-icon">${typeIcons[attachment.type]}</span>
          <div class="attachment-details">
            <div class="attachment-name">${attachment.name}</div>
            <div class="attachment-size">${this.formatFileSize(attachment.size)}</div>
          </div>
        </div>
        <button class="btn-icon remove-attachment" data-index="${index}" title="Remove attachment">
          <span class="material-icons">delete</span>
        </button>
      `;
      
      container.appendChild(item);
    });
  }

  async submitBug(event) {
    event.preventDefault();
    
    // Protection against multiple clicks
    const submitBtn = event.target.querySelector('.submit-btn');
    if (submitBtn.disabled) {
      return; // Already processing
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
    
    const formData = new FormData(event.target);
    const bugData = {
      title: formData.get('title'),
      description: formData.get('description'),
      steps: formData.get('steps'),
      expectedBehavior: formData.get('expectedBehavior'),
      actualBehavior: formData.get('actualBehavior'),
      priority: formData.get('priority'),
      environment: formData.get('environment'),
      component: formData.get('component'),
      url: await this.getCurrentTabUrl(),
      attachments: this.attachments,
      timestamp: new Date().toISOString(),
      jiraAttempted: false
    };
  
    try {
      // Try to send to Jira if configured
      const settings = await this.getSettings();
      if (settings.jira && settings.jira.enabled) {
        try {
          bugData.jiraAttempted = true;
          const jiraResponse = await this.sendToJira(bugData);
          console.log('Jira response:', jiraResponse);
          
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
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['settings'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Error loading settings:', chrome.runtime.lastError.message);
          resolve({}); // Return empty object on error
          return;
        }
        // Return complete settings or empty object
        resolve(result.settings || {});
      });
    });
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
      chrome.storage.local.get(['bugReports'], (result) => {
        const reports = result.bugReports || [];
        this.displayBugHistory(reports);
        resolve();
      });
    });
  }

  // Tornar getJiraTicketUrl síncrono usando o cache
  getJiraTicketUrl(ticketKey) {
    const baseUrl = this.cachedSettings?.jira?.baseUrl || 'https://jorgealijo.atlassian.net';
    return `${baseUrl}/browse/${ticketKey}`;
  }

  // Modificar displayBugHistory para usar o método síncrono
  displayBugHistory(reports) {
    const container = document.getElementById('bugHistory');
    container.innerHTML = '';
    
    if (reports.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="material-icons empty-icon">history</span>
          <p>No bugs registered yet</p>
        </div>
      `;
      return;
    }
    
    reports.forEach((report, index) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      
      let content = '';
      
      if (report.jiraKey) {
        // Agora usando o método síncrono
        const jiraUrl = this.getJiraTicketUrl(report.jiraKey);
        content = `
          <div class="history-content-jira">
            <a href="${jiraUrl}" target="_blank" class="jira-link-full">
              ${report.jiraKey} - ${report.title}
            </a>
          </div>
          <div class="history-actions-single">
            <button class="delete-btn" data-index="${index}" title="Delete">
              <span class="material-icons">delete</span>
            </button>
          </div>
        `;
      } else if (report.jiraAttempted === false) {
        // Ticket not sent to Jira: title + send icon
        content = `
          <div class="history-content-pending">
            <span class="history-title-only">${report.title}</span>
          </div>
          <div class="history-actions-single">
            <button class="send-btn" data-index="${index}" title="Send to Jira">
              <span class="material-icons">send</span>
            </button>
          </div>
        `;
      } else {
        // Unknown status: title + delete and send buttons
        content = `
          <div class="history-content-unknown">
            <span class="history-title-only">${report.title}</span>
          </div>
          <div class="history-actions-double">
            <button class="send-btn" data-index="${index}" title="Send to Jira">
              <span class="material-icons">send</span>
            </button>
            <button class="delete-btn" data-index="${index}" title="Delete">
              <span class="material-icons">delete</span>
            </button>
          </div>
        `;
      }
      
      item.innerHTML = content;
      container.appendChild(item);
    });
  }

  // New method for Jira submission retry
  async retryJiraSubmission(index) {
    try {
      this.updateHistoryStatus('Resending to Jira...', 'loading');
      
      // Use chrome.storage.local instead of localStorage
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['bugReports'], resolve);
      });
      
      const reports = result.bugReports || [];
      const report = reports[index];
      
      if (!report) {
        throw new Error('Report not found');
      }
      
      const jiraResponse = await this.sendToJira(report);
      
      // Update report with jiraKey using chrome.storage.local
      reports[index].jiraKey = jiraResponse.key;
      chrome.storage.local.set({ bugReports: reports }, () => {
        this.updateHistoryStatus(`Sent successfully! Ticket: ${jiraResponse.key}`, 'success');
        
        // Update only the specific card instead of reloading the entire list
        this.updateHistoryCard(index, reports[index]);
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
    if (confirm('Are you sure you want to clear all history?')) {
      chrome.storage.local.set({ bugReports: [] }, () => {
        this.loadBugHistory();
        this.updateCaptureStatus('History cleared', 'info');
      });
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
        // Here you can implement a modal or new page to view the report
        console.log('Viewing report:', report);
        alert(`Report: ${report.title}\n\nDescription: ${report.description}\n\nPriority: ${report.priority}\n\nAttachments: ${report.attachments.length}`);
      }
    });
  }

  openSettings() {
    // Open settings page
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }

  saveSettings() {
    const settings = {
      autoCapture: document.getElementById('autoCapture').checked,
      includeConsole: document.getElementById('includeConsole').checked,
      maxFileSize: document.getElementById('maxFileSize').value
    };
    
    chrome.storage.local.set({ settings }, () => {
      this.updateCaptureStatus('Settings saved', 'success');
    });
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
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.bugSpotter = new BugSpotter();
  window.bugSpotter.init(); // Add this line!
});