import { describe, expect, it } from '@jest/globals';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import {
  PLAYER_ACCESS_MODE,
  applyPlayerAccess,
  canPlayerAccessPage,
  filterConfigForPlayer,
  getPlayerAudienceMode,
  getPlayerAccessMode,
  isPlayerAccessEnabled,
  setPlayerAccessEnabled,
  normalizePlayerIds
} from '../../../js/utils/playerAccess.js';

describe('player access', () => {
  it('normalizes, deduplicates and bounds stored player ids', () => {
    const ids = normalizePlayerIds([' player-1 ', '', 'player-1', null, 'player-2']);

    expect(ids).toEqual(['player-1', 'player-2']);
  });

  it('keeps everyone and selected-player modes mutually exclusive', () => {
    const page = new Page('Secret', 'https://example.com/secret');

    applyPlayerAccess(page, PLAYER_ACCESS_MODE.SELECTED, ['player-1']);
    expect(getPlayerAccessMode(page)).toBe(PLAYER_ACCESS_MODE.SELECTED);
    expect(page.visibleToPlayers).toBe(false);
    expect(page.sharedWithPlayerIds).toEqual(['player-1']);

    applyPlayerAccess(page, PLAYER_ACCESS_MODE.EVERYONE, ['player-1']);
    expect(getPlayerAccessMode(page)).toBe(PLAYER_ACCESS_MODE.EVERYONE);
    expect(page.sharedWithPlayerIds).toEqual([]);
  });

  it('toggles visibility without changing the configured audience', () => {
    const page = new Page('Secret', 'https://example.com/secret', {
      sharedWithPlayerIds: ['player-1']
    });

    setPlayerAccessEnabled(page, false);
    expect(isPlayerAccessEnabled(page)).toBe(false);
    expect(getPlayerAccessMode(page)).toBe(PLAYER_ACCESS_MODE.GM_ONLY);
    expect(getPlayerAudienceMode(page)).toBe(PLAYER_ACCESS_MODE.SELECTED);
    expect(page.sharedWithPlayerIds).toEqual(['player-1']);

    setPlayerAccessEnabled(page, true);
    expect(isPlayerAccessEnabled(page)).toBe(true);
    expect(getPlayerAccessMode(page)).toBe(PLAYER_ACCESS_MODE.SELECTED);
    expect(page.sharedWithPlayerIds).toEqual(['player-1']);
  });

  it('does not authorize a configured player while visibility is disabled', () => {
    const page = new Page('Secret', 'https://example.com/secret', {
      id: 'secret',
      sharedWithPlayerIds: ['player-1'],
      playerAccessEnabled: false
    });
    const config = new Config({ pages: [page] });

    expect(canPlayerAccessPage(config, 'secret', 'player-1')).toBe(false);
    expect(filterConfigForPlayer(config, 'player-1')).toEqual({ categories: [] });

    setPlayerAccessEnabled(page, true);
    expect(canPlayerAccessPage(config, 'secret', 'player-1')).toBe(true);
  });

  it('ignores legacy folder grants and authorizes pages individually', () => {
    const nestedPage = new Page('Nested', 'https://example.com/nested', { id: 'nested' });
    const futurePage = new Page('Future', 'https://example.com/future', {
      id: 'future',
      sharedWithPlayerIds: ['player-1']
    });
    const child = new Category('Child', { pages: [nestedPage] });
    const sharedFolder = new Category('Shared folder', {
      id: 'shared-folder',
      categories: [child],
      sharedWithPlayerIds: ['player-1']
    });
    sharedFolder.addPage(futurePage);
    const config = new Config({ categories: [sharedFolder] });

    expect(canPlayerAccessPage(config, 'nested', 'player-1')).toBe(false);
    expect(canPlayerAccessPage(config, 'future', 'player-1')).toBe(true);
    expect(canPlayerAccessPage(config, 'nested', 'player-2')).toBe(false);

    const filtered = filterConfigForPlayer(config, 'player-1');
    expect(filtered.categories[0].pages.map(page => page.id)).toEqual(['future']);
    expect(filtered.categories[0].categories).toBeUndefined();
  });

  it('returns only authorized content and never exposes ACL arrays', () => {
    const selected = new Page('Selected', 'https://example.com/selected', {
      id: 'selected',
      sharedWithPlayerIds: ['player-1', 'player-2']
    });
    const hidden = new Page('Hidden', 'https://example.com/hidden', { id: 'hidden' });
    const config = new Config({
      categories: [new Category('Secrets', {
        pages: [hidden, selected],
        order: [
          { type: 'page', index: 0 },
          { type: 'page', index: 1 }
        ]
      })]
    });

    const filtered = filterConfigForPlayer(config, 'player-1');
    const serialized = JSON.stringify(filtered);

    expect(filtered.categories[0].pages).toHaveLength(1);
    expect(filtered.categories[0].pages[0]).toMatchObject({
      id: 'selected',
      visibleToPlayers: true
    });
    expect(filtered.categories[0].order).toEqual([{ type: 'page', index: 0 }]);
    expect(serialized).not.toContain('sharedWithPlayerIds');
    expect(serialized).not.toContain('player-2');
    expect(serialized).not.toContain('Hidden');
  });

  it('returns an empty vault for an unauthorized player', () => {
    const config = new Config({
      categories: [new Category('Secrets', {
        pages: [new Page('Hidden', 'https://example.com/hidden')]
      })]
    });

    expect(filterConfigForPlayer(config, 'player-9')).toEqual({ categories: [] });
  });
});
