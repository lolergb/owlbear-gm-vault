import { describe, expect, it } from '@jest/globals';
import {
  PAGE_TITLE_FALLBACK,
  getUsablePageTitle,
  isPlaceholderPageTitle,
  normalizePageTitle,
  repairPageTitle,
  resolvePageTitle
} from '../../../js/utils/pageTitle.js';

describe('pageTitle helpers', () => {
  it('normaliza espacios exteriores sin alterar el contenido', () => {
    expect(normalizePageTitle('  The   Lost Mine  ')).toBe('The   Lost Mine');
  });

  it.each(['Untitled', ' untitled ', 'UNTITLED', 'Page', ' page ', '', '   ', null, undefined])(
    'reconoce %p como placeholder',
    value => {
      expect(isPlaceholderPageTitle(value)).toBe(true);
    }
  );

  it('elige el primer título real y descarta placeholders', () => {
    expect(getUsablePageTitle('Untitled', '  Cragmaw Hideout  ', 'Old name')).toBe('Cragmaw Hideout');
    expect(resolvePageTitle('Page', 'Untitled', 'Goblin Ambush')).toBe('Goblin Ambush');
  });

  it('usa un fallback neutro si todos los candidatos son inválidos', () => {
    expect(resolvePageTitle('', 'Untitled', null)).toBe(PAGE_TITLE_FALLBACK);
  });

  it('repara una página persistida como Untitled', () => {
    const page = { name: ' untitled ' };
    expect(repairPageTitle(page, 'Phandalin')).toEqual({ title: 'Phandalin', changed: true });
    expect(page.name).toBe('Phandalin');
  });

  it('nunca sobrescribe un título válido persistido', () => {
    const page = { name: 'Existing title' };
    expect(repairPageTitle(page, 'New title')).toEqual({ title: 'New title', changed: false });
    expect(page.name).toBe('Existing title');
  });
});

