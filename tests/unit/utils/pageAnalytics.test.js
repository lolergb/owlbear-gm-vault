import { describe, expect, it } from '@jest/globals';
import { buildPageAddedMetadata } from '../../../js/utils/pageAnalytics.js';

describe('page analytics metadata', () => {
  it('classifies common embed providers with controlled values', () => {
    expect(buildPageAddedMetadata({
      url: 'https://www.google.com/maps/embed?pb=private',
      pageType: 'iframe',
      creationMethod: 'manual'
    })).toEqual({
      url_domain: 'google.com',
      embed_provider: 'maps',
      creation_method: 'manual',
      is_embed_code: false
    });

    expect(buildPageAddedMetadata({
      url: 'https://campaign.notion.site/secret-page',
      pageType: 'notion',
      creationMethod: 'notion'
    })).toEqual({
      url_domain: 'notion.site',
      embed_provider: 'notion',
      creation_method: 'notion',
      is_embed_code: false
    });
  });

  it('does not expose private or invalid hostnames', () => {
    expect(buildPageAddedMetadata({
      url: 'http://192.168.1.5/private',
      creationMethod: 'custom'
    })).toEqual({
      url_domain: 'private_or_local',
      embed_provider: 'generic_web',
      creation_method: 'unknown',
      is_embed_code: false
    });

    expect(buildPageAddedMetadata({ url: 'not-a-url' })).toEqual({
      url_domain: 'unknown',
      embed_provider: 'other',
      creation_method: 'manual',
      is_embed_code: false
    });
  });
});
