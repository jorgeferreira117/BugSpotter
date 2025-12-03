// Minimal mocks for Chrome APIs used in background-refactored
global.chrome = global.chrome || {
  runtime: { getURL: jest.fn() },
  storage: { local: { set: jest.fn(), get: jest.fn() } },
  notifications: { create: jest.fn() }
};

describe('formatJiraDescription (background-refactored)', () => {
  let background;

  beforeAll(() => {
    // Ensure jsdom window exists and load the module
    // The module attaches an instance to window.bugSpotterBackground
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/background/background-refactored.js');
    background = window.bugSpotterBackground;
    expect(background).toBeTruthy();
    expect(typeof background.formatJiraDescription).toBe('function');
  });

  const extractStepsBlock = (desc) => {
    const match = desc.match(/\*Steps to Reproduce:\*\n([\s\S]*?)\n\n/);
    return match ? match[1].split('\n') : [];
  };

  it('removes existing numeric and bullet prefixes before renumbering', () => {
    const bugData = {
      description: 'Test',
      url: 'https://example.com',
      environment: 'Chrome',
      timestamp: Date.now(),
      steps: ['1. Open app', '2) Click button', '- Submit form', '• See result'],
      attachments: []
    };

    const desc = background.formatJiraDescription(bugData);
    const steps = extractStepsBlock(desc);
    expect(steps).toEqual([
      '1. Open app',
      '2. Click button',
      '3. Submit form',
      '4. See result'
    ]);
  });

  it('renumbers clean steps without adding duplicate prefixes', () => {
    const bugData = {
      description: 'Test',
      url: 'https://example.com',
      environment: 'Chrome',
      timestamp: Date.now(),
      steps: ['Open app', 'Click button', 'Submit form'],
      attachments: []
    };

    const desc = background.formatJiraDescription(bugData);
    const steps = extractStepsBlock(desc);
    expect(steps).toEqual([
      '1. Open app',
      '2. Click button',
      '3. Submit form'
    ]);
  });

  it('trims whitespace around steps before numbering', () => {
    const bugData = {
      description: 'Test',
      url: 'https://example.com',
      environment: 'Chrome',
      timestamp: Date.now(),
      steps: ['   1.   Open app   ', '   -   Click button', '  Submit form  '],
      attachments: []
    };

    const desc = background.formatJiraDescription(bugData);
    const steps = extractStepsBlock(desc);
    expect(steps).toEqual([
      '1. Open app',
      '2. Click button',
      '3. Submit form'
    ]);
  });

  it('handles hyphen and dash formats like "1 - Step" and "1 — Step"', () => {
    const bugData = {
      description: 'Test',
      url: 'https://example.com',
      environment: 'Chrome',
      timestamp: Date.now(),
      steps: ['1 - Open app', '1 — Click button', '1 – Submit form'],
      attachments: []
    };

    const desc = background.formatJiraDescription(bugData);
    const steps = extractStepsBlock(desc);
    expect(steps).toEqual([
      '1. Open app',
      '2. Click button',
      '3. Submit form'
    ]);
  });

  it('handles parenthesized and asterisk bullet formats like "(1) Step" and "* Step"', () => {
    const bugData = {
      description: 'Test',
      url: 'https://example.com',
      environment: 'Chrome',
      timestamp: Date.now(),
      steps: ['(1) Open app', '* Click button', '(2) - Submit form'],
      attachments: []
    };

    const desc = background.formatJiraDescription(bugData);
    const steps = extractStepsBlock(desc);
    expect(steps).toEqual([
      '1. Open app',
      '2. Click button',
      '3. Submit form'
    ]);
  });
});