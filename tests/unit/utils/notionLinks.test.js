import { describe, expect, it } from '@jest/globals';
import { extractNotionPageId, isNotionUrl } from '../../../js/utils/helpers.js';

const ROOT_ID = '3a3d4856-c90e-8019-9267-dff41d1609a1';
const LINKED_ID = '3a3d4856-c90e-812c-abe5-d9dd50ed3333';

describe('Notion URL helpers', () => {
  it('reconoce las URLs actuales de app.notion.com', () => {
    expect(isNotionUrl('https://app.notion.com/p/Bajo-el-Hielo-Carmes-3a3d4856c90e80199267dff41d1609a1?source=copy_link')).toBe(true);
    expect(isNotionUrl('https://app.notion.com/p/3a3d4856c90e80199267dff41d1609a1')).toBe(true);
  });

  it('mantiene compatibilidad con notion.so y notion.site', () => {
    expect(isNotionUrl('https://www.notion.so/Page-3a3d4856c90e80199267dff41d1609a1')).toBe(true);
    expect(isNotionUrl('https://campaign.notion.site/Page-3a3d4856c90e80199267dff41d1609a1')).toBe(true);
  });

  it('no acepta dominios que solo contienen el nombre de Notion', () => {
    expect(isNotionUrl('https://notion.so.example.com/page')).toBe(false);
    expect(isNotionUrl('not-a-url-with-notion.so-inside')).toBe(false);
  });

  it('extrae IDs de enlaces compartidos con slug y de rutas /p/id', () => {
    expect(extractNotionPageId(
      'https://app.notion.com/p/Bajo-el-Hielo-Carmes-3a3d4856c90e80199267dff41d1609a1?source=copy_link'
    )).toBe(ROOT_ID);
    expect(extractNotionPageId(
      'https://app.notion.com/p/Monstruos-y-criaturas-3a3d4856c90e812cabe5d9dd50ed3333?source=copy_link'
    )).toBe(LINKED_ID);
    expect(extractNotionPageId(
      'https://app.notion.com/p/3a3d4856c90e812cabe5d9dd50ed3333'
    )).toBe(LINKED_ID);
  });
});
