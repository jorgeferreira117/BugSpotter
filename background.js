class BugSpotterBackground {
  constructor() {
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupContextMenus();
  }

  setupEventListeners() {
    // Listener para instalação da extensão
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === 'install') {
        this.onFirstInstall();
      }
    });

    // Listener para mensagens do content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Indica resposta assíncrona
    });

    // Listener para mudanças de aba
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.onTabActivated(activeInfo);
    });

    // Listener para atualizações de aba
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        this.onTabCompleted(tabId, tab);
      }
    });
  }

  async setupContextMenus() {
    try {
      // Tentar remover menus existentes
      await chrome.contextMenus.removeAll();
      
      // Criar novos menus
      chrome.contextMenus.create({
        id: 'bugspotter-capture',
        title: '🐛 Reportar Bug nesta Página',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'bugspotter-screenshot',
        title: '📸 Capturar Screenshot',
        contexts: ['page']
      });

      // Configurar listener apenas uma vez
      chrome.contextMenus.onClicked.addListener((info, tab) => {
        this.handleContextMenuClick(info, tab);
      });
      
    } catch (error) {
      console.error('Erro ao configurar menus de contexto:', error);
    }
  }

  async onFirstInstall() {
    // Configurações padrão
    const defaultSettings = {
      autoCaptureLogs: true,
      maxVideoLength: 30,
      screenshotFormat: 'png',
      jira: {
        enabled: false,
        baseUrl: '',
        email: '',
        apiToken: '',
        projectKey: ''
      }
    };

    await chrome.storage.local.set({ settings: defaultSettings });
    
    // Abre página de boas-vindas
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'CAPTURE_SCREENSHOT':
          const screenshot = await this.captureScreenshot(sender.tab.id);
          sendResponse({ success: true, data: screenshot });
          break;

        case 'GET_CONSOLE_LOGS':
          const logs = await this.getConsoleLogs(sender.tab.id);
          sendResponse({ success: true, data: logs });
          break;

        case 'SAVE_BUG':
          await this.saveBug(message.data);
          sendResponse({ success: true });
          break;

        case 'SEND_TO_JIRA':
          const jiraResult = await this.sendToJira(message.data);
          sendResponse({ success: true, data: jiraResult });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async captureScreenshot(tabId) {
    try {
      const screenshot = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 90
      });
      return screenshot;
    } catch (error) {
      throw new Error(`Failed to capture screenshot: ${error.message}`);
    }
  }

  async getConsoleLogs(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        function: () => {
          // Retorna logs capturados pelo content script
          return window.bugSpotterLogs || [];
        }
      });
      return results[0].result;
    } catch (error) {
      throw new Error(`Failed to get console logs: ${error.message}`);
    }
  }

  async saveBug(bugData) {
    try {
      const result = await chrome.storage.local.get(['bugs']);
      const bugs = result.bugs || [];
      
      bugData.id = Date.now().toString();
      bugData.timestamp = new Date().toISOString();
      
      bugs.push(bugData);
      await chrome.storage.local.set({ bugs });
      
      // Notifica o usuário
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'BugSpotter',
        message: 'Bug salvo com sucesso!'
      });
      
    } catch (error) {
      throw new Error(`Failed to save bug: ${error.message}`);
    }
  }

  async sendToJira(bugData) {
    try {
      const settings = await this.getSettings();
      
      if (!settings.jira || !settings.jira.enabled) {
        throw new Error('Jira integration not configured');
      }
  
      // Primeiro, criar o issue
      const jiraIssue = {
        fields: {
          project: { key: settings.jira.projectKey },
          summary: bugData.title,
          description: this.formatJiraDescription(bugData),
          issuetype: { id: settings.jira.issueTypeId || '10035' },
          priority: { name: this.mapPriorityToJira(bugData.priority) }
        }
      };
  
      const response = await fetch(`${settings.jira.baseUrl}/rest/api/2/issue`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${settings.jira.email}:${settings.jira.apiToken}`)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(jiraIssue)
      });
  
      if (!response.ok) {
        throw new Error(`Jira API error: ${response.statusText}`);
      }
  
      const result = await response.json();
      
      // Segundo, anexar os arquivos se existirem
      if (bugData.attachments && bugData.attachments.length > 0) {
        await this.attachFilesToJiraIssue(result.key, bugData.attachments, settings);
      }
  
      // Notifica sucesso
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'BugSpotter',
        message: `Bug enviado para Jira: ${result.key} com ${bugData.attachments?.length || 0} anexo(s)`
      });
  
      return result;
      
    } catch (error) {
      throw new Error(`Failed to send to Jira: ${error.message}`);
    }
  }
  
  // Novo método para anexar arquivos
  async attachFilesToJiraIssue(issueKey, attachments, settings) {
    console.log(`Iniciando envio de ${attachments.length} anexo(s) para issue ${issueKey}`);
    
    // No método attachFilesToJiraIssue, linha ~240
    for (const attachment of attachments) {
    // Validação mais robusta
    if (!attachment || !attachment.data || typeof attachment.data !== 'string' || attachment.data.trim() === '') {
    console.warn(`Anexo ${attachment?.name || 'desconhecido'} não possui dados válidos ou não é uma string`);
    continue; // Pular este anexo em vez de falhar
    }
    
    let blob;
    
    // Verificar se é base64 (screenshot) ou texto puro (DOM/console)
    if (attachment.data.startsWith('data:')) {
      // É base64 (screenshot)
      console.log('Processando anexo base64 (screenshot)');
      const base64Data = attachment.data.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: this.getMimeType(attachment.type) });
    } else {
      // É texto puro (DOM/console)
      console.log('Processando anexo de texto (DOM/console)');
      blob = new Blob([attachment.data], { type: this.getMimeType(attachment.type) });
    }
    
    console.log(`Blob criado: ${blob.size} bytes, tipo: ${blob.type}`);
    
    // Criar FormData para multipart/form-data
    const formData = new FormData();
    formData.append('file', blob, attachment.name);
    
    console.log(`Enviando anexo para: ${settings.jira.baseUrl}/rest/api/2/issue/${issueKey}/attachments`);
    
    // Enviar anexo para Jira
    const attachResponse = await fetch(`${settings.jira.baseUrl}/rest/api/2/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${settings.jira.email}:${settings.jira.apiToken}`)}`,
        'X-Atlassian-Token': 'nocheck'
        // Não definir Content-Type - deixar o browser definir com boundary
      },
      body: formData
    });
    
    console.log(`Resposta do anexo ${attachment.name}: ${attachResponse.status} ${attachResponse.statusText}`);
    
    if (!attachResponse.ok) {
      const errorText = await attachResponse.text();
      console.error(`Erro ao anexar ${attachment.name}:`, attachResponse.statusText, errorText);
    } else {
      const responseData = await attachResponse.json();
      console.log(`Anexo ${attachment.name} enviado com sucesso:`, responseData);
    }
    }
    
    console.log('Finalizado envio de anexos');
  }
  
  // Método auxiliar para determinar MIME type
  getMimeType(attachmentType) {
    const mimeTypes = {
      'screenshot': 'image/png',
      'logs': 'application/json',  // Corrigido: logs são JSON
      'dom': 'text/html',
      'recording': 'video/webm'
    };
    return mimeTypes[attachmentType] || 'application/octet-stream';
  }

  formatJiraDescription(bugData) {
    return `
*Descrição:*
${bugData.description}

*Passos para Reproduzir:*
${bugData.steps}

*URL:* ${bugData.url}
*Componente:* ${bugData.component || 'N/A'}
*Ambiente:* ${bugData.environment || 'N/A'}
*Prioridade:* ${bugData.priority || 'Medium'}
*Timestamp:* ${bugData.timestamp}
*Evidências:* ${bugData.attachments?.length || 0} arquivo(s) anexado(s) a este ticket
    `;
  }

  // Remover este método obsoleto:
  // mapSeverityToPriority(severity) { ... }

  mapPriorityToJira(priority) {
    const mapping = {
      'Highest': 'Highest',
      'High': 'High',
      'Medium': 'Medium', 
      'Low': 'Low',
      'Lowest': 'Lowest'
    };
    return mapping[priority] || 'Medium';
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {});
      });
    });
  }

  onTabActivated(activeInfo) {
    // Implementar lógica quando aba é ativada
  }

  onTabCompleted(tabId, tab) {
    // Remover a injeção manual - o manifest já cuida disso
    // O content script será injetado automaticamente pelo manifest
  }

  handleContextMenuClick(info, tab) {
    switch (info.menuItemId) {
      case 'bugspotter-capture':
        chrome.action.openPopup();
        break;
      case 'bugspotter-screenshot':
        this.captureScreenshot(tab.id);
        break;
    }
  }
}

// Inicializa o background script
new BugSpotterBackground();