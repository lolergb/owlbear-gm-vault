import { describe, expect, it } from '@jest/globals';
import { prepareBackup, MAX_BACKUP_BYTES } from '../../../js/utils/cloudBackup.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { canPlayerAccessPage } from '../../../js/utils/playerAccess.js';

const parser = new ConfigParser();
const value = () => ({
  categories: [{ id: 'folder-1', name: 'Campaign', items: [
    { type: 'page', id: 'page-1', name: 'Private', htmlContent: '<p>Notes</p>', sharedWithPlayerIds: ['player-1'] },
    { type: 'category', id: 'folder-2', name: 'Handouts', items: [
      { type: 'page', id: 'page-2', name: 'Map', url: 'https://example.test/map.png', visibleToPlayers: true, blockTypes: ['paragraph'], icon: 'test' }
    ] }
  ] }],
  pages: [{ id: 'root', name: 'Root', url: 'https://example.test' }],
  order: [{ type: 'page', index: 0 }, { type: 'category', index: 0 }],
  token: 'never-upload', access_token: 'never-upload', email: 'never-upload'
});

describe('cloud backup contract', () => {
  it('round trips structure, IDs, mixed order, HTML and configured audiences without credentials', () => {
    const { payload, warnings } = prepareBackup(value(), parser);
    const model = parser.parse(payload);
    expect(model.findPageById('page-1').htmlContent).toBe('<p>Notes</p>');
    expect(model.findPageById('page-1').sharedWithPlayerIds).toEqual(['player-1']);
    expect(payload.categories[0].order).toEqual([{ type: 'page', index: 0 }, { type: 'category', index: 0 }]);
    expect(payload.order).toEqual(value().order);
    expect(JSON.stringify(payload)).not.toContain('never-upload');
    expect(warnings.length).toBeGreaterThan(0);
    expect(prepareBackup(payload, parser).payload).toEqual(payload);
  });
  it('disables player access on every restored page while preserving configured audience', () => {
    const { payload } = prepareBackup(value(), parser, { restoring: true });
    const model = parser.parse(payload);
    for (const id of ['page-1', 'page-2', 'root']) {
      expect(model.findPageById(id).playerAccessEnabled).toBe(false);
      expect(canPlayerAccessPage(model.findPageById(id), 'player-1')).toBe(false);
    }
    expect(model.findPageById('page-2').visibleToPlayers).toBe(true);
  });
  it.each([null, {}, { categories: 'bad' }, { categories: [], pages: [{ name: 'Missing URL' }] }])('rejects invalid copies', bad => {
    expect(() => prepareBackup(bad, parser)).toThrow('could not be validated');
  });
  it('rejects future versions, empty copies, excessive nesting and oversized UTF-8 payloads', () => {
    expect(() => prepareBackup(value(), parser, { schema: 2 })).toThrow('newer');
    expect(() => prepareBackup({ categories: [] }, parser)).toThrow('no folders or pages');
    expect(() => prepareBackup({ categories: [], pages: [{ name: 'Big', htmlContent: 'á'.repeat(MAX_BACKUP_BYTES) }] }, parser)).toThrow('2 MiB');
    const deep = { categories: [] }; let cursor = deep;
    for (let i = 0; i < 100; i++) { const child = { name: 'Nested', categories: [] }; cursor.categories.push(child); cursor = child; }
    expect(() => prepareBackup(deep, parser)).toThrow('could not be validated');
  });
});
