/**
 * @jest-environment jsdom
 */

// Mock do popup.js
class BugSpotter {
  constructor() {
    this.attachments = [];
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.reportStatusTimeout = null;
    this.captureStatusTimeout = null;
    this.cachedSettings = null;
  }

  async init() {
    this.cachedSettings = await this.getSettings();
    await this.loadBugHistory();
    this.setupEventListeners();
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
    const historyDiv = document.getElementById('bugHistory');
    if (historyDiv) {
      historyDiv.innerHTML = reports.map(report => 
        `<div class="bug-item">${report.title}</div>`
      ).join('');
    }
  }

  setupEventListeners() {
    // Mock implementation
  }

  // CORRIGIR: Fazer com que use chrome.storage.sync.get
  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['bugSpotterSettings'], (result) => {
        resolve(result.bugSpotterSettings || {
          jira: {
            enabled: true,
            baseUrl: 'https://test.atlassian.net',
            email: 'test@test.com',
            apiToken: 'test-token',
            projectKey: 'TEST',
            issueTypeId: '10001'
          }
        });
      });
    });
  }

  getJiraTicketUrl(ticketKey) {
    const baseUrl = this.cachedSettings?.jira?.baseUrl || 'https://test.atlassian.net';
    return `${baseUrl}/browse/${ticketKey}`;
  }

  async captureScreenshot() {
    return new Promise((resolve) => {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (dataUrl) {
          this.addAttachment({
            name: `screenshot-${Date.now()}.png`,
            data: dataUrl,
            type: 'image/png'
          });
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  addAttachment(attachment) {
    this.attachments.push(attachment);
  }

  removeAttachment(index) {
    this.attachments.splice(index, 1);
  }

  async saveBugReport(bugData) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['bugReports'], (result) => {
        const reports = result.bugReports || [];
        reports.push(bugData);
        chrome.storage.local.set({ bugReports: reports }, resolve);
      });
    });
  }
}

describe('BugSpotter - Popup Functionality', () => {
  let bugSpotter;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup DOM
    document.body.innerHTML = `
      <div id="bugHistory"></div>
      <form id="bugForm">
        <input id="bugTitle" type="text" />
        <textarea id="bugDescription"></textarea>
        <button type="submit">Submit</button>
      </form>
      <div id="attachmentsList"></div>
    `;

    bugSpotter = new BugSpotter();
  });

  describe('Initialization', () => {
    test('should initialize with default values', () => {
      expect(bugSpotter.attachments).toEqual([]);
      expect(bugSpotter.isRecording).toBe(false);
      expect(bugSpotter.cachedSettings).toBeNull();
    });

    test('should load settings and history on init', async () => {
      chrome.storage.sync.get.mockImplementation((keys, callback) => {
        callback({ bugSpotterSettings: { jira: { enabled: true } } });
      });
      
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ bugReports: [] });
      });

      await bugSpotter.init();
      
      expect(bugSpotter.cachedSettings).toBeTruthy();
      expect(chrome.storage.sync.get).toHaveBeenCalled();
      expect(chrome.storage.local.get).toHaveBeenCalled();
    });
  });

  describe('Screenshot Capture', () => {
    test('should capture screenshot successfully', async () => {
      const mockDataUrl = 'data:image/png;base64,test';
      chrome.tabs.captureVisibleTab.mockImplementation((windowId, options, callback) => {
        callback(mockDataUrl);
      });

      const result = await bugSpotter.captureScreenshot();
      
      expect(result).toBe(true);
      expect(bugSpotter.attachments).toHaveLength(1);
      expect(bugSpotter.attachments[0].data).toBe(mockDataUrl);
      expect(bugSpotter.attachments[0].type).toBe('image/png');
    });

    test('should handle screenshot capture failure', async () => {
      chrome.tabs.captureVisibleTab.mockImplementation((windowId, options, callback) => {
        callback(null);
      });

      const result = await bugSpotter.captureScreenshot();
      
      expect(result).toBe(false);
      expect(bugSpotter.attachments).toHaveLength(0);
    });
  });

  describe('Attachment Management', () => {
    test('should add attachment correctly', () => {
      const attachment = {
        name: 'test.png',
        data: 'data:image/png;base64,test',
        type: 'image/png'
      };

      bugSpotter.addAttachment(attachment);
      
      expect(bugSpotter.attachments).toHaveLength(1);
      expect(bugSpotter.attachments[0]).toEqual(attachment);
    });

    test('should remove attachment by index', () => {
      bugSpotter.attachments = [
        { name: 'test1.png' },
        { name: 'test2.png' },
        { name: 'test3.png' }
      ];

      bugSpotter.removeAttachment(1);
      
      expect(bugSpotter.attachments).toHaveLength(2);
      expect(bugSpotter.attachments[0].name).toBe('test1.png');
      expect(bugSpotter.attachments[1].name).toBe('test3.png');
    });
  });

  describe('Jira URL Generation', () => {
    test('should generate correct Jira URL', async () => {
      await bugSpotter.init();
      
      const url = bugSpotter.getJiraTicketUrl('TEST-123');
      
      expect(url).toBe('https://test.atlassian.net/browse/TEST-123');
    });

    test('should use default URL when settings not available', () => {
      const url = bugSpotter.getJiraTicketUrl('TEST-123');
      
      expect(url).toBe('https://test.atlassian.net/browse/TEST-123');
    });
  });

  describe('Bug Report Saving', () => {
    test('should save bug report successfully', async () => {
      const bugData = {
        title: 'Test Bug',
        description: 'Test Description',
        timestamp: new Date().toISOString()
      };

      chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({ bugReports: [] });
      });
      
      chrome.storage.local.set.mockImplementation((data, callback) => {
        callback();
      });

      await bugSpotter.saveBugReport(bugData);
      
      expect(chrome.storage.local.get).toHaveBeenCalledWith(['bugReports'], expect.any(Function));
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });
});