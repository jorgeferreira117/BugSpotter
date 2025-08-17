class BugSpotter {
  constructor() {
    this.attachments = [];
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.reportStatusTimeout = null;
    this.captureStatusTimeout = null;
  }
  
  async init() {
    await this.loadBugHistory();
    this.setupEventListeners();
    // Remover esta linha:
    // this.updateCaptureStatus('Pronto para capturar evidências', 'info');
  }

  setupEventListeners() {
    // Event listeners para botões principais
    document.getElementById('captureScreenshot').addEventListener('click', () => this.captureScreenshot());
    document.getElementById('captureLogs').addEventListener('click', () => this.captureLogs());
    document.getElementById('captureDOM').addEventListener('click', () => this.captureDOM());
    document.getElementById('startRecording').addEventListener('click', () => this.startRecording());
    document.getElementById('clearHistory').addEventListener('click', () => this.clearHistory());
    document.getElementById('openSettings').addEventListener('click', () => this.openSettings());
    
    // Event listener para o formulário de bug
    document.getElementById('bugForm').addEventListener('submit', (e) => this.submitBug(e));
    
    // Event listener para remoção de anexos e botões do histórico
    document.addEventListener('click', (e) => {
      // Corrigir event listener para remoção de anexos
      if (e.target.closest('.remove-attachment')) {
        const index = e.target.closest('.remove-attachment').dataset.index;
        this.removeAttachment(parseInt(index));
      }
      // Event listeners para botões do histórico
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
    
    // Aplicar filtros aos relatórios
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
    
    // Se não há mensagem, ocultar completamente a div
    if (!message || message.trim() === '') {
      statusElement.style.display = 'none';
      return;
    }
    
    // Mostrar a div e atualizar conteúdo
    statusElement.style.display = 'block';
    statusText.textContent = message;
    
    // Limpar classes anteriores
    statusElement.className = 'capture-status';
    
    // Aplicar classe baseada no tipo
    statusElement.classList.add(`status-${type}`);
    
    // Definir ícone baseado no tipo
    const icons = {
      info: 'info',
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      loading: 'hourglass_empty'
    };
    
    statusIcon.textContent = icons[type] || 'info';
    
    // Auto-hide para todas as mensagens exceto loading
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
    
    // Mostrar a div de status
    statusElement.style.display = 'block';
    
    // Remover classes de status anteriores
    statusElement.classList.remove('status-info', 'status-success', 'status-error', 'status-warning', 'status-loading');
    
    // Adicionar nova classe de status
    statusElement.classList.add(`status-${type}`);
    
    // Atualizar texto
    statusText.textContent = message;
    
    // Atualizar ícone baseado no tipo
    const icons = {
      info: 'info',
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      loading: 'hourglass_empty'
    };
    
    statusIcon.textContent = icons[type] || 'info';
    
    // Limpar timeout anterior se existir
    if (this.reportStatusTimeout) {
      clearTimeout(this.reportStatusTimeout);
    }
    
    // Auto-ocultar mensagens de sucesso após 5 segundos
    if (type === 'success') {
      this.reportStatusTimeout = setTimeout(() => {
        statusElement.style.display = 'none';
      }, 5000);
    }
  }

  async captureScreenshot() {
    console.log('captureScreenshot iniciado');
    const button = document.getElementById('captureScreenshot');
    const btnText = button.querySelector('.btn-text');
    
    // Verificar apenas se já está em processo
    if (button.disabled) {
      return;
    }
    
    console.log('Elementos encontrados:', { button, btnText });
    
    button.disabled = true;
    btnText.textContent = 'Capturando...';
    
    this.updateCaptureStatus('Capturando screenshot...', 'loading');
    
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
        this.updateCaptureStatus('Screenshot capturado com sucesso!', 'success');
      }
    } catch (error) {
      console.error('Erro ao capturar screenshot:', error);
      this.updateCaptureStatus('Erro ao capturar screenshot', 'error');
    } finally {
      button.disabled = false;
      btnText.textContent = 'Screenshot';
    }
  }

  async captureLogs() {
    console.log('captureLogs iniciado');
    const button = document.getElementById('captureLogs');
    const btnText = button.querySelector('.btn-text');
    
    // Verificar apenas se já está em processo
    if (button.disabled) {
      return;
    }
    
    console.log('Elementos encontrados:', { button, btnText });
    
    button.disabled = true;
    btnText.textContent = 'Capturando...';
    
    this.updateCaptureStatus('Capturando logs...', 'loading');
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const logs = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          // Capturar logs do console
          const logs = [];
          
          // Interceptar console.log, console.error, console.warn, console.info
          const originalLog = console.log;
          const originalError = console.error;
          const originalWarn = console.warn;
          const originalInfo = console.info;
          
          // Verificar se já existem logs armazenados
          if (window.capturedLogs && window.capturedLogs.length > 0) {
            return window.capturedLogs;
          }
          
          // Se não há logs capturados, inicializar captura
          window.capturedLogs = [];
          
          // Sobrescrever métodos do console para capturar logs
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
          
          // Capturar erros JavaScript
          window.addEventListener('error', (event) => {
            window.capturedLogs.push(`[JS ERROR] ${new Date().toISOString()}: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
          });
          
          // Capturar erros de Promise rejeitadas
          window.addEventListener('unhandledrejection', (event) => {
            window.capturedLogs.push(`[PROMISE ERROR] ${new Date().toISOString()}: ${event.reason}`);
          });
          
          // Retornar logs existentes ou uma mensagem indicativa
          if (window.capturedLogs.length === 0) {
            return [`[INFO] ${new Date().toISOString()}: Sistema de captura de logs inicializado. Interaja com a página para gerar logs.`];
          }
          
          return window.capturedLogs;
        }
      });
      
      const logData = logs[0].result;
      
      if (logData && logData.length > 0) {
        const attachment = {
          type: 'logs',
          name: `console_logs_${Date.now()}.txt`,
          data: logData.join('\n'),
          size: new Blob([logData.join('\n')]).size
        };
        
        const added = this.addAttachment(attachment);
        
        if (added) {
          this.updateCaptureStatus('Logs capturados com sucesso!', 'success');
        }
      } else {
        this.updateCaptureStatus('Nenhum log encontrado', 'warning');
      }
    } catch (error) {
      console.error('Erro ao capturar logs:', error);
      this.updateCaptureStatus('Erro ao capturar logs', 'error');
    } finally {
      button.disabled = false;
      btnText.textContent = 'Logs';
    }
  }

  async captureDOM() {
    console.log('captureDOM iniciado');
    const button = document.getElementById('captureDOM');
    const btnText = button.querySelector('.btn-text');
    
    if (button.disabled) {
      return;
    }
    
    button.disabled = true;
    btnText.textContent = 'Capturando...';
    
    this.updateCaptureStatus('Capturando DOM...', 'loading');
    
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
        throw new Error('Falha ao capturar conteúdo DOM');
      }
      
      const attachment = {
        type: 'dom',
        name: `dom_snapshot_${Date.now()}.html`,
        data: htmlContent,
        size: new Blob([htmlContent]).size
      };
      
      const added = this.addAttachment(attachment);
      
      if (added) {
        this.updateCaptureStatus('DOM capturado com sucesso!', 'success');
      }
    } catch (error) {
      console.error('Erro ao capturar DOM:', error);
      this.updateCaptureStatus('Erro ao capturar DOM', 'error');
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
          this.updateCaptureStatus('Gravação salva com sucesso!', 'success');
        };
        reader.readAsDataURL(blob);
      };
      
      this.mediaRecorder.start();
      this.isRecording = true;
      
      const button = document.getElementById('startRecording');
      const btnText = button.querySelector('.btn-text');
      btnText.textContent = 'Parar';
      button.classList.add('recording');
      
      this.updateCaptureStatus('Gravando tela...', 'loading');
    } catch (error) {
      console.error('Erro ao iniciar gravação:', error);
      this.updateCaptureStatus('Erro ao iniciar gravação', 'error');
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      
      const button = document.getElementById('startRecording');
      const btnText = button.querySelector('.btn-text');
      btnText.textContent = 'Vídeo';
      button.classList.remove('recording');
      
      this.updateCaptureStatus('Finalizando gravação...', 'loading');
    }
  }

  addAttachment(attachment) {
    // Verificar se já existe um anexo do mesmo tipo capturado recentemente (últimos 3 segundos)
    const now = Date.now();
    const recentDuplicate = this.attachments.find(existing => 
      existing.type === attachment.type && 
      (now - parseInt(existing.name.match(/_(\d+)\./)?.[1] || 0)) < 3000
    );
    
    if (recentDuplicate) {
      this.updateCaptureStatus(`${attachment.type} já foi capturado recentemente. Aguarde alguns segundos.`, 'warning');
      return false;
    }
    
    this.attachments.push(attachment);
    this.updateAttachmentsList();
    return true;
  }

  removeAttachment(index) {
    this.attachments.splice(index, 1);
    this.updateAttachmentsList();
    this.updateReportStatus('Anexo removido', 'info');
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
        <button class="btn-icon remove-attachment" data-index="${index}" title="Remover anexo">
          <span class="material-icons">delete</span>
        </button>
      `;
      
      container.appendChild(item);
    });
  }

  async submitBug(event) {
    event.preventDefault();
    
    // Proteção contra múltiplos cliques
    const submitBtn = event.target.querySelector('.submit-btn');
    if (submitBtn.disabled) {
      return; // Já está processando
    }
    
    // Desabilitar botão e mostrar feedback visual
    submitBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = `
      <span class="material-icons">hourglass_empty</span>
      Enviando...
    `;
    submitBtn.classList.add('loading');
    
    // Mostrar status de processamento
    this.updateReportStatus('Processando relatório...', 'loading');
    
    const formData = new FormData(event.target);
    const bugData = {
      title: formData.get('title'),
      description: formData.get('description'),
      steps: formData.get('steps'),
      priority: formData.get('priority'),
      environment: formData.get('environment'),
      component: formData.get('component'),
      url: await this.getCurrentTabUrl(),
      attachments: this.attachments,
      timestamp: new Date().toISOString(),
      jiraAttempted: false
    };
  
    try {
      // Tentar enviar para Jira se configurado
      const settings = await this.getSettings();
      if (settings.jira && settings.jira.enabled) {
        try {
          bugData.jiraAttempted = true;
          const jiraResponse = await this.sendToJira(bugData);
          console.log('Resposta do Jira:', jiraResponse);
          
          if (jiraResponse && jiraResponse.key) {
            // Adicionar chave do Jira ao relatório antes de salvar
            bugData.jiraKey = jiraResponse.key;
            this.updateReportStatus(`Relatório enviado com sucesso! Ticket: ${jiraResponse.key}`, 'success');
          } else {
            this.updateReportStatus('Salvo localmente. Erro ao enviar para Jira: Resposta inválida', 'warning');
          }
        } catch (jiraError) {
          console.error('Erro ao enviar para Jira:', jiraError);
          this.updateReportStatus('Salvo localmente. Erro ao enviar para Jira: ' + jiraError.message, 'warning');
        }
      } else {
        this.updateReportStatus('Relatório salvo localmente!', 'success');
      }
      
      // Salvar apenas UMA vez, com ou sem jiraKey
      await this.saveBugReport(bugData);
      
      // Limpar formulário e anexos
      event.target.reset();
      this.attachments = [];
      this.updateAttachmentsList();
      
      // Atualizar histórico
      this.loadBugHistory();
      
    } catch (error) {
      console.error('Erro ao salvar relatório:', error);
      this.updateReportStatus('Erro ao salvar relatório: ' + error.message, 'error');
    } finally {
      // Restaurar botão sempre, independente do resultado
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        submitBtn.classList.remove('loading');
      }, 1000); // Pequeno delay para mostrar o resultado
    }
  }

  async getSettings() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['settings'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Erro ao carregar configurações:', chrome.runtime.lastError.message);
          resolve({}); // Retorna objeto vazio em caso de erro
          return;
        }
        // Retorna as configurações completas ou objeto vazio
        resolve(result.settings || {});
      });
    });
  }

  async sendToJira(bugData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'SEND_TO_JIRA',
        data: bugData
      }, (response) => {
        // Verificar se houve erro de runtime
        if (chrome.runtime.lastError) {
          reject(new Error(`Erro de comunicação: ${chrome.runtime.lastError.message}`));
          return;
        }
        
        // Verificar se response existe e tem a estrutura esperada
        if (!response) {
          reject(new Error('Nenhuma resposta recebida do background script'));
          return;
        }
        
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error || 'Erro desconhecido'));
        }
      });
    });
  }

  async getCurrentTabUrl() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab.url;
    } catch (error) {
      return 'URL não disponível';
    }
  }

  async saveBugReport(bugData) {
    return new Promise((resolve) => {
      // Primeiro, verificar o uso atual do storage
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        const maxBytes = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB
        const usagePercent = (bytesInUse / maxBytes) * 100;
        
        // Se o uso estiver acima de 70%, limpar dados primeiro
        if (usagePercent > 70) {
          chrome.storage.local.get(['bugReports'], (result) => {
            let reports = result.bugReports || [];
            // Manter apenas os 5 relatórios mais recentes
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
      
      // Criar uma versão otimizada do bugData (sem anexos grandes)
      const optimizedBugData = {
        ...bugData,
        attachments: bugData.attachments ? bugData.attachments.map(att => {
          if (att.type === 'screenshot' && att.data) {
            // Reduzir qualidade de screenshots se necessário
            return {
              ...att,
              data: att.data.length > 500000 ? null : att.data, // Remove screenshots > 500KB
              note: att.data.length > 500000 ? 'Screenshot removido para economizar espaço' : att.note
            };
          }
          return att;
        }) : []
      };
      
      reports.unshift(optimizedBugData);
      
      // Limitar a 10 relatórios para ser mais conservador
      if (reports.length > 10) {
        reports = reports.slice(0, 10);
      }
      
      chrome.storage.local.set({ bugReports: reports }, () => {
        if (chrome.runtime.lastError) {
          console.error('Erro ao salvar relatório:', chrome.runtime.lastError.message);
          // Última tentativa: salvar apenas os dados essenciais
          const essentialData = {
            title: bugData.title,
            description: bugData.description,
            priority: bugData.priority,
            environment: bugData.environment,
            timestamp: bugData.timestamp,
            attachments: [] // Remove todos os anexos
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

  displayBugHistory(reports) {
    const container = document.getElementById('bugHistory');
    container.innerHTML = '';
    
    if (reports.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="material-icons empty-icon">history</span>
          <p>Nenhum bug registrado ainda</p>
        </div>
      `;
      return;
    }
    
    reports.forEach((report, index) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      
      let content = '';
      
      if (report.jiraKey) {
        // Ticket criado no Jira: IdJira-título com link + ícone apagar
        content = `
          <div class="history-content-jira">
            <a href="${this.getJiraTicketUrl(report.jiraKey)}" target="_blank" class="jira-link-full">
              ${report.jiraKey} - ${report.title}
            </a>
          </div>
          <div class="history-actions-single">
            <button class="delete-btn" data-index="${index}" title="Excluir">
              <span class="material-icons">delete</span>
            </button>
          </div>
        `;
      } else if (report.jiraAttempted === false) {
        // Ticket não enviado para Jira: título + ícone enviar
        content = `
          <div class="history-content-pending">
            <span class="history-title-only">${report.title}</span>
          </div>
          <div class="history-actions-single">
            <button class="send-btn" data-index="${index}" title="Enviar para Jira">
              <span class="material-icons">send</span>
            </button>
          </div>
        `;
      } else {
        // Status desconhecido: título + botões apagar e enviar
        content = `
          <div class="history-content-unknown">
            <span class="history-title-only">${report.title}</span>
          </div>
          <div class="history-actions-double">
            <button class="send-btn" data-index="${index}" title="Enviar para Jira">
              <span class="material-icons">send</span>
            </button>
            <button class="delete-btn" data-index="${index}" title="Excluir">
              <span class="material-icons">delete</span>
            </button>
          </div>
        `;
      }
      
      item.innerHTML = content;
      container.appendChild(item);
    });
  }

  // Novo método para obter URL do ticket Jira
  async getJiraTicketUrl(ticketKey) {
    const settings = await this.getSettings();
    return `${settings.jira.baseUrl}/browse/${ticketKey}`;
  }

  // Novo método para retry de envio para Jira
  async retryJiraSubmission(index) {
    try {
      this.updateHistoryStatus('Reenviando para Jira...', 'loading');
      
      // Usar chrome.storage.local em vez de localStorage
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['bugReports'], resolve);
      });
      
      const reports = result.bugReports || [];
      const report = reports[index];
      
      if (!report) {
        throw new Error('Relatório não encontrado');
      }
      
      const jiraResponse = await this.sendToJira(report);
      
      // Atualizar o relatório com o jiraKey usando chrome.storage.local
      reports[index].jiraKey = jiraResponse.key;
      chrome.storage.local.set({ bugReports: reports }, () => {
        this.updateHistoryStatus(`Enviado com sucesso! Ticket: ${jiraResponse.key}`, 'success');
        
        // Atualizar apenas o card específico em vez de recarregar toda a lista
        this.updateHistoryCard(index, reports[index]);
      });
      
    } catch (error) {
      console.error('Erro ao reenviar para Jira:', error);
      this.updateHistoryStatus('Erro ao reenviar: ' + error.message, 'error');
    }
  }

  // Novo método para atualizar um card específico do histórico
  updateHistoryCard(index, report) {
    const historyContainer = document.getElementById('bugHistory');
    const cards = historyContainer.querySelectorAll('.history-item');
    
    if (cards[index]) {
      const card = cards[index];
      
      // Atualizar status do Jira
      const jiraStatus = card.querySelector('.jira-status');
      if (jiraStatus) {
        if (report.jiraKey) {
          jiraStatus.innerHTML = `
            <span class="material-icons status-icon success">check_circle</span>
            <span class="status-text">Enviado: ${report.jiraKey}</span>
          `;
          jiraStatus.className = 'jira-status success';
        }
      }
      
      // Atualizar botões de ação
      const actionButtons = card.querySelector('.action-buttons');
      if (actionButtons && report.jiraKey) {
        const sendBtn = actionButtons.querySelector('.send-btn');
        if (sendBtn) {
          sendBtn.style.display = 'none'; // Ocultar botão de reenvio
        }
      }
    }
  }

  // Novo método para status do histórico
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
    
    // Auto-hide para todas as mensagens exceto loading
    if (type !== 'loading') {
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 3000);
    }
  }

  async clearHistory() {
    if (confirm('Tem certeza que deseja limpar todo o histórico?')) {
      chrome.storage.local.set({ bugReports: [] }, () => {
        this.loadBugHistory();
        this.updateCaptureStatus('Histórico limpo', 'info');
      });
    }
  }

  async deleteReport(index) {
    if (confirm('Tem certeza que deseja excluir este relatório?')) {
      chrome.storage.local.get(['bugReports'], (result) => {
        const reports = result.bugReports || [];
        reports.splice(index, 1);
        
        chrome.storage.local.set({ bugReports: reports }, () => {
          this.loadBugHistory();
          this.updateHistoryStatus('Relatório excluído', 'success');
        });
      });
    }
  }

  viewReport(index) {
    chrome.storage.local.get(['bugReports'], (result) => {
      const reports = result.bugReports || [];
      const report = reports[index];
      
      if (report) {
        // Aqui você pode implementar uma modal ou nova página para visualizar o relatório
        console.log('Visualizando relatório:', report);
        alert(`Relatório: ${report.title}\n\nDescrição: ${report.description}\n\nPrioridade: ${report.priority}\n\nAnexos: ${report.attachments.length}`);
      }
    });
  }

  openSettings() {
    // Abrir página de configurações
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }

  saveSettings() {
    const settings = {
      autoCapture: document.getElementById('autoCapture').checked,
      includeConsole: document.getElementById('includeConsole').checked,
      maxFileSize: document.getElementById('maxFileSize').value
    };
    
    chrome.storage.local.set({ settings }, () => {
      this.updateCaptureStatus('Configurações salvas', 'success');
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

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  window.bugSpotter = new BugSpotter();
  window.bugSpotter.init(); // Adicionar esta linha!
});