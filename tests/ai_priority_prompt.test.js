
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
});
