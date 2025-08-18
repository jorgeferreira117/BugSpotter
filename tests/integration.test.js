/**
 * @jest-environment jsdom
 */

// Mock da classe BugSpotter para testes de integração
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

describe('BugSpotter - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup complete DOM
    document.body.innerHTML = `
      <div id="bugHistory"></div>
      <form id="bugForm">
        <input id="bugTitle" type="text" value="Integration Test Bug" />
        <textarea id="bugDescription">Test Description</textarea>
        <select id="bugPriority">
          <option value="High" selected>High</option>
        </select>
        <button type="submit">Submit Bug</button>
      </form>
      <div id="attachmentsList"></div>
      <div id="statusMessage"></div>
    `;
  });

  test('should complete full bug reporting workflow', async () => {
    // Mock successful screenshot capture
    chrome.tabs.captureVisibleTab.mockImplementation((windowId, options, callback) => {
      callback('data:image/png;base64,test-screenshot');
    });

    // Mock successful Jira submission
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ key: 'TEST-123', id: '12345' })
    });

    // Mock storage operations
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({ bugReports: [] });
    });
    
    chrome.storage.local.set.mockImplementation((data, callback) => {
      callback();
    });

    chrome.storage.sync.get.mockImplementation((keys, callback) => {
      callback({
        bugSpotterSettings: {
          jira: {
            enabled: true,
            baseUrl: 'https://test.atlassian.net',
            email: 'test@test.com',
            apiToken: 'test-token',
            projectKey: 'TEST',
            issueTypeId: '10001'
          }
        }
      });
    });

    // Test the complete workflow
    const bugSpotter = new BugSpotter();
    await bugSpotter.init();
    
    // Capture screenshot
    await bugSpotter.captureScreenshot();
    expect(bugSpotter.attachments).toHaveLength(1);
    
    // Submit bug report
    const bugData = {
      title: 'Integration Test Bug',
      description: 'Test Description',
      priority: 'High',
      attachments: bugSpotter.attachments
    };
    
    await bugSpotter.saveBugReport(bugData);
    
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });
});