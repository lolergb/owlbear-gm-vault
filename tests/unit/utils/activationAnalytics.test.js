import { describe, expect, it } from '@jest/globals';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import {
  getVaultState,
  markContentOrigin,
  normalizeContentOrigin
} from '../../../js/utils/activationAnalytics.js';

describe('activation analytics helpers', () => {
  it('recognizes demo pages saved by older versions', () => {
    expect(normalizeContentOrigin(
      undefined,
      'https://www.youtube.com/watch?v=YE7VzlLtp-4'
    )).toBe('demo');
  });

  it('distinguishes a demo-only vault from one with user content', () => {
    const parser = new ConfigParser();
    const demo = parser.parse({
      categories: [{
        name: 'Demo',
        pages: [{
          name: 'Quick Start',
          url: 'https://www.youtube.com/watch?v=YE7VzlLtp-4'
        }]
      }]
    });
    expect(getVaultState(demo)).toBe('demo');

    demo.categories[0].pages.push(parser._parsePage({
      name: 'My map',
      url: 'https://example.com/map.png'
    }));
    expect(getVaultState(demo)).toBe('configured');
  });

  it('marks imported pages in both supported config formats', () => {
    const categories = [
      { name: 'Legacy', pages: [{ name: 'A', url: 'https://example.com/a' }] },
      { name: 'Items', items: [{ type: 'page', name: 'B', url: 'https://example.com/b' }] }
    ];
    const pages = [{ name: 'Root', url: 'https://example.com/root' }];

    markContentOrigin(categories, pages, 'import');

    expect(categories[0].pages[0].origin).toBe('import');
    expect(categories[1].items[0].origin).toBe('import');
    expect(pages[0].origin).toBe('import');
  });
});
