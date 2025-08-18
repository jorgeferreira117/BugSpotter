/**
 * @jest-environment jsdom
 */

class BugSpotterSettings {
  constructor() {
    this.defaultSettings = {
      jira: {
        enabled: false,
        baseUrl: 'https://test.atlassian.net',
        email: '',
        apiToken: '',
        projectKey: '',
        issueTypeId: ''
      }
    };
  }

  async testJiraConnection() {
    const jiraConfig = {
      baseUrl: document.getElementById('jiraUrl').value,
      email: document.getElementById('jiraEmail').value,
      apiToken: document.getElementById('jiraApiToken').value,
      projectKey: document.getElementById('jiraProjectKey').value
    };

    // Validation
    if (!jiraConfig.baseUrl || !jiraConfig.email || !jiraConfig.apiToken || !jiraConfig.projectKey) {
      throw new Error('Required field missing');
    }

    const auth = btoa(`${jiraConfig.email}:${jiraConfig.apiToken}`);
    
    const response = await fetch(`${jiraConfig.baseUrl}/rest/api/3/project/${jiraConfig.projectKey}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid credentials');
      } else if (response.status === 404) {
        throw new Error('Project not found');
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    }

    return await response.json();
  }

  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  validateUrl(url) {
    try {
      new URL(url);
      return url.includes('atlassian.net') || url.includes('jira');
    } catch {
      return false;
    }
  }

  async saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ bugSpotterSettings: settings }, resolve);
    });
  }
}

describe('BugSpotterSettings - Settings Functionality', () => {
  let settings;

  beforeEach(() => {
    jest.clearAllMocks();
    
    document.body.innerHTML = `
      <form id="jiraForm">
        <input id="jiraUrl" type="url" value="https://test.atlassian.net" />
        <input id="jiraEmail" type="email" value="test@test.com" />
        <input id="jiraApiToken" type="password" value="test-token" />
        <input id="jiraProjectKey" type="text" value="TEST" />
        <input id="jiraIssueType" type="text" value="10001" />
      </form>
      <div id="statusMessage"></div>
    `;

    settings = new BugSpotterSettings();
  });

  describe('Validation Functions', () => {
    test('should validate email correctly', () => {
      expect(settings.validateEmail('test@test.com')).toBe(true);
      expect(settings.validateEmail('invalid-email')).toBe(false);
      expect(settings.validateEmail('test@')).toBe(false);
      expect(settings.validateEmail('@test.com')).toBe(false);
    });

    test('should validate Jira URL correctly', () => {
      expect(settings.validateUrl('https://test.atlassian.net')).toBe(true);
      expect(settings.validateUrl('https://company.jira.com')).toBe(true);
      expect(settings.validateUrl('invalid-url')).toBe(false);
      expect(settings.validateUrl('https://google.com')).toBe(false);
    });
  });

  describe('Jira Connection Testing', () => {
    test('should test connection successfully', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ name: 'Test Project', key: 'TEST' })
      };
      
      fetch.mockResolvedValue(mockResponse);

      const result = await settings.testJiraConnection();
      
      expect(fetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/3/project/TEST',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic'),
            'Accept': 'application/json'
          })
        })
      );
      
      expect(result.name).toBe('Test Project');
    });

    test('should handle missing required fields', async () => {
      document.getElementById('jiraEmail').value = '';
      
      await expect(settings.testJiraConnection()).rejects.toThrow('Required field missing');
    });

    test('should handle 401 unauthorized error', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 401
      });

      await expect(settings.testJiraConnection()).rejects.toThrow('Invalid credentials');
    });

    test('should handle 404 project not found error', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      await expect(settings.testJiraConnection()).rejects.toThrow('Project not found');
    });

    test('should handle other HTTP errors', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      await expect(settings.testJiraConnection()).rejects.toThrow('HTTP 500');
    });
  });

  describe('Settings Management', () => {
    test('should save settings successfully', async () => {
      const testSettings = {
        jira: {
          enabled: true,
          baseUrl: 'https://test.atlassian.net',
          email: 'test@test.com'
        }
      };

      chrome.storage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      await settings.saveSettings(testSettings);
      
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        { bugSpotterSettings: testSettings },
        expect.any(Function)
      );
    });
  });
});