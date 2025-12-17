
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

describe('AIService Deterministic Steps Generation (Un-numbered)', () => {
  let aiService;

  beforeEach(() => {
    aiService = new AIService();
    // Force isConfigured to false to trigger deterministic logic
    aiService.isConfigured = () => false;
  });

  const extractSteps = async (interactions) => {
    const payload = {
      fields: { title: '', description: '', steps: [] },
      interactions: interactions
    };
    const result = await aiService.enhanceBugFields(payload);
    return result.stepsToReproduce;
  };

  it('should generate steps without numbering', async () => {
    const interactions = [
      { type: 'navigate', url: 'http://a.com', timestamp: 100 },
      { type: 'click', selector: '#btn', timestamp: 200 },
      { type: 'input', selector: '#inp', value: 'text', timestamp: 300 }
    ];

    const steps = await extractSteps(interactions);
    expect(steps).toEqual([
      'Navigate to http://a.com',
      'Click on #btn',
      'Enter value in #inp (text)'
    ]);
  });

  it('should skip duplicate navigations', async () => {
    const interactions = [
      { type: 'navigate', url: 'http://a.com', timestamp: 100 },
      { type: 'navigate', url: 'http://a.com', timestamp: 101 }, // Duplicate
      { type: 'click', selector: '#btn', timestamp: 200 }
    ];

    const steps = await extractSteps(interactions);
    expect(steps).toEqual([
      'Navigate to http://a.com',
      'Click on #btn'
    ]);
  });

  it('should handle navigation changes correctly', async () => {
    const interactions = [
      { type: 'navigate', url: 'http://a.com', timestamp: 100 },
      { type: 'click', selector: '#btn', timestamp: 200 },
      { type: 'navigate', url: 'http://b.com', timestamp: 300 }
    ];

    const steps = await extractSteps(interactions);
    expect(steps).toEqual([
      'Navigate to http://a.com',
      'Click on #btn',
      'Navigate to http://b.com'
    ]);
  });

  it('should handle implicit navigation (url change without navigate type)', async () => {
    const interactions = [
      { type: 'click', selector: '#btn1', url: 'http://a.com', timestamp: 100 },
      { type: 'click', selector: '#btn2', url: 'http://b.com', timestamp: 200 } // URL changed
    ];

    const steps = await extractSteps(interactions);
    expect(steps).toEqual([
      'Navigate to http://a.com',
      'Click on #btn1',
      'Navigate to http://b.com',
      'Click on #btn2'
    ]);
  });

  it('should handle unknown types with title case', async () => {
    const interactions = [
      { type: 'navigate', url: 'http://a.com', timestamp: 100 },
      { type: 'scroll', selector: 'body', timestamp: 200 }
    ];

    const steps = await extractSteps(interactions);
    expect(steps).toEqual([
      'Navigate to http://a.com',
      'Scroll on body'
    ]);
  });

  it('should not exceed 20 steps', async () => {
    const interactions = [];
    for (let i = 0; i < 25; i++) {
      interactions.push({ type: 'click', selector: `#btn${i}`, timestamp: 100 + i });
    }

    const steps = await extractSteps(interactions);
    expect(steps.length).toBe(20);
    expect(steps[0]).toBe('Click on #btn0');
    expect(steps[19]).toBe('Click on #btn19');
  });
});
