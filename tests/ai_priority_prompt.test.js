
const AIService = require('../src/modules/AIService.js');

// Mock chrome API
global.chrome = {
  runtime: {
    lastError: null
  },
  storage: {
    local: {
      get: jest.fn().mockImplementation((keys, callback) => {
        callback({});
      }),
      set: jest.fn()
    }
  }
};

describe('AIService Priority Prompt', () => {
  let aiService;

  beforeEach(() => {
    aiService = new AIService();
  });

  test('should include default priorities in prompt when availablePriorities is missing', () => {
    const payload = {
      fields: { title: 'Test Bug' }
    };

    const prompt = aiService.buildEnhancementPrompt(payload);
    expect(prompt).toContain('Suggest a \'priority\' level from the following options: Lowest|Low|Medium|High|Highest');
  });

  test('should include custom priorities in prompt when availablePriorities is provided', () => {
    const payload = {
      fields: { 
        title: 'Test Bug',
        availablePriorities: ['Critical', 'Major', 'Minor']
      }
    };

    const prompt = aiService.buildEnhancementPrompt(payload);
    expect(prompt).toContain('Suggest a \'priority\' level from the following options: Critical|Major|Minor');
  });

  test('should handle empty availablePriorities array by using defaults', () => {
    const payload = {
      fields: { 
        title: 'Test Bug',
        availablePriorities: []
      }
    };

    const prompt = aiService.buildEnhancementPrompt(payload);
    expect(prompt).toContain('Suggest a \'priority\' level from the following options: Lowest|Low|Medium|High|Highest');
  });

  test('should redact sensitive data in enhancement prompt', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const payload = {
      fields: {
        title: 'Login issue',
        description: `User email john.doe@example.com and token=${jwt}`,
        steps: ['Open https://app.test/login?token=supersecrettoken&x=1']
      },
      interactions: [
        { type: 'input', selector: '#email', value: 'john.doe@example.com' },
        { type: 'input', selector: '#password', value: 'MyS3cretPassword' },
        { type: 'click', selector: '#submit', url: 'https://app.test/login?access_token=abcd1234&foo=bar' }
      ],
      context: {
        pageUrl: 'https://app.test/login?refresh_token=abcd1234&foo=bar',
        pageTitle: 'Login'
      }
    };

    const prompt = aiService.buildEnhancementPrompt(payload);
    expect(prompt).not.toContain('john.doe@example.com');
    expect(prompt).toContain('j***@example.com');
    expect(prompt).not.toContain('supersecrettoken');
    expect(prompt).toContain('token=[REDACTED]');
    expect(prompt).toMatch(/access_token=(?:%5B|\[)REDACTED(?:%5D|\])/i);
    expect(prompt).toMatch(/refresh_token=(?:%5B|\[)REDACTED(?:%5D|\])/i);
    expect(prompt).not.toContain(jwt);
  });

  test('should redact sensitive data in bug report prompt', () => {
    const errorData = {
      error: {
        url: 'https://api.test/resource?session=abcd1234&x=1',
        method: 'POST',
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          Authorization: 'Bearer my.super.secret.token',
          'Set-Cookie': 'sid=abcd1234; HttpOnly'
        },
        responseBody: {
          email: 'john.doe@example.com',
          accessToken: 'abcd1234abcd1234abcd1234abcd1234',
          nested: { password: 'MyS3cretPassword' }
        }
      },
      context: {
        referrer: 'https://app.test/?token=abcd1234'
      }
    };

    const prompt = aiService.buildPrompt(errorData);
    expect(prompt).not.toContain('john.doe@example.com');
    expect(prompt).toContain('"email": "[REDACTED]"');
    expect(prompt).toMatch(/session=(?:%5B|\[)REDACTED(?:%5D|\])/i);
    expect(prompt).toContain('token=[REDACTED]');
    expect(prompt).not.toContain('my.super.secret.token');
    expect(prompt).toContain('"Authorization": "[REDACTED]"');
    expect(prompt).not.toContain('MyS3cretPassword');
    expect(prompt).toContain('"password": "[REDACTED]"');
  });
});
