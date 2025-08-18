/**
 * @jest-environment jsdom
 */

class BugSpotterBackground {
  async sendToJira(bugData) {
    const settings = await this.getSettings();
    
    if (!settings.jira || !settings.jira.enabled) {
      throw new Error('Jira integration not configured');
    }

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

    return await response.json();
  }

  formatJiraDescription(bugData) {
    return `
*Description:*
${bugData.description}

*Steps to Reproduce:*
${bugData.steps}

*URL:* ${bugData.url}
*Component:* ${bugData.component || 'N/A'}
*Environment:* ${bugData.environment || 'N/A'}
*Priority:* ${bugData.priority || 'Medium'}
*Timestamp:* ${bugData.timestamp}
    `;
  }

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
    return {
      jira: {
        enabled: true,
        baseUrl: 'https://test.atlassian.net',
        email: 'test@test.com',
        apiToken: 'test-token',
        projectKey: 'TEST',
        issueTypeId: '10001'
      }
    };
  }
}

describe('BugSpotterBackground - Background Script', () => {
  let background;

  beforeEach(() => {
    jest.clearAllMocks();
    background = new BugSpotterBackground();
  });

  describe('Jira Integration', () => {
    test('should send bug to Jira successfully', async () => {
      const bugData = {
        title: 'Test Bug',
        description: 'Test Description',
        steps: 'Test Steps',
        url: 'https://test.com',
        priority: 'High',
        timestamp: new Date().toISOString()
      };

      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ key: 'TEST-123', id: '12345' })
      };
      
      fetch.mockResolvedValue(mockResponse);

      const result = await background.sendToJira(bugData);
      
      expect(fetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/2/issue',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic'),
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('Test Bug')
        })
      );
      
      expect(result.key).toBe('TEST-123');
    });

    test('should handle Jira API errors', async () => {
      const bugData = { title: 'Test Bug' };
      
      fetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request'
      });

      await expect(background.sendToJira(bugData)).rejects.toThrow('Jira API error: Bad Request');
    });

    test('should handle disabled Jira integration', async () => {
      background.getSettings = jest.fn().mockResolvedValue({
        jira: { enabled: false }
      });

      const bugData = { title: 'Test Bug' };
      
      await expect(background.sendToJira(bugData)).rejects.toThrow('Jira integration not configured');
    });
  });

  describe('Description Formatting', () => {
    test('should format Jira description correctly', () => {
      const bugData = {
        description: 'Test Description',
        steps: 'Test Steps',
        url: 'https://test.com',
        component: 'Header',
        environment: 'Production',
        priority: 'High',
        timestamp: '2023-01-01T00:00:00.000Z'
      };

      const formatted = background.formatJiraDescription(bugData);
      
      expect(formatted).toContain('*Description:*');
      expect(formatted).toContain('Test Description');
      expect(formatted).toContain('*Steps to Reproduce:*');
      expect(formatted).toContain('Test Steps');
      expect(formatted).toContain('*URL:* https://test.com');
      expect(formatted).toContain('*Component:* Header');
      expect(formatted).toContain('*Environment:* Production');
      expect(formatted).toContain('*Priority:* High');
    });
  });

  describe('Priority Mapping', () => {
    test('should map priorities correctly', () => {
      expect(background.mapPriorityToJira('Highest')).toBe('Highest');
      expect(background.mapPriorityToJira('High')).toBe('High');
      expect(background.mapPriorityToJira('Medium')).toBe('Medium');
      expect(background.mapPriorityToJira('Low')).toBe('Low');
      expect(background.mapPriorityToJira('Lowest')).toBe('Lowest');
      expect(background.mapPriorityToJira('Invalid')).toBe('Medium');
      expect(background.mapPriorityToJira(undefined)).toBe('Medium');
    });
  });
});