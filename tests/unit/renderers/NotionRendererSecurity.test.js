import { describe, expect, it } from '@jest/globals';
import { NotionRenderer } from '../../../js/renderers/NotionRenderer.js';

const SIGNED_ASSET_URL = 'https://assets.example.com/private/dragon-map.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test%2F20260722%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Signature=deadbeef&X-Amz-Expires=900';
const EXECUTABLE_URLS = [
  'javascript:alert(1)',
  'data:text/html,<svg onload=alert(1)>',
  'vbscript:msgbox(1)'
];

function textItem(plainText, { annotations = {}, href = null } = {}) {
  return {
    type: 'text',
    plain_text: plainText,
    href,
    text: {
      content: plainText,
      link: href ? { url: href } : null
    },
    annotations
  };
}

function fragmentFrom(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

describe('NotionRenderer rich text security', () => {
  it('renders malicious plain_text as one text node instead of creating elements', () => {
    const renderer = new NotionRenderer();
    const payload = '<img src=x onerror="globalThis.__imageXss = true"><script>globalThis.__scriptXss = true</script>';
    const fragment = fragmentFrom(renderer.renderRichText([textItem(payload)]));

    expect(fragment.childNodes).toHaveLength(1);
    expect(fragment.firstChild.nodeType).toBe(Node.TEXT_NODE);
    expect(fragment.textContent).toBe(payload);
    expect(fragment.querySelector('img, script')).toBeNull();
  });

  it('does not turn encoded HTML entities into active markup', () => {
    const renderer = new NotionRenderer();
    const payload = '&#x3C;img src=x onerror=alert(1)&#x3E;';
    const fragment = fragmentFrom(renderer.renderRichText([textItem(payload)]));

    expect(fragment.textContent).toBe(payload);
    expect(fragment.querySelector('img, [onerror]')).toBeNull();
  });

  it('preserves annotations and line breaks after escaping the text', () => {
    const renderer = new NotionRenderer();
    const fragment = fragmentFrom(renderer.renderRichText([
      textItem('first <unsafe>\nsecond & safe', {
        href: 'https://example.com/notes',
        annotations: {
          bold: true,
          italic: true,
          underline: true,
          strikethrough: true,
          code: true
        }
      })
    ]));
    const link = fragment.querySelector('a.notion-text-link');

    expect(link.getAttribute('href')).toBe('https://example.com/notes');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('code.notion-text-code')).not.toBeNull();
    expect(link.querySelector('s.notion-text-strikethrough')).not.toBeNull();
    expect(link.querySelector('u.notion-text-underline')).not.toBeNull();
    expect(link.querySelector('em.notion-text-italic')).not.toBeNull();
    expect(link.querySelector('strong.notion-text-bold')).not.toBeNull();
    expect(link.querySelectorAll('br')).toHaveLength(1);
    expect(link.textContent).toBe('first <unsafe>second & safe');
    expect(link.querySelector('unsafe')).toBeNull();
  });

  it.each(EXECUTABLE_URLS)('does not create a link for %s', unsafeUrl => {
    const renderer = new NotionRenderer();
    const fragment = fragmentFrom(renderer.renderRichText([
      textItem('Untrusted destination', { href: unsafeUrl, annotations: { bold: true } })
    ]));

    expect(fragment.querySelector('a')).toBeNull();
    expect(fragment.textContent).toBe('Untrusted destination');
  });

  it('preserves an HTTPS signed rich-text link', () => {
    const renderer = new NotionRenderer();
    const fragment = fragmentFrom(renderer.renderRichText([
      textItem('Download map', { href: SIGNED_ASSET_URL, annotations: {} })
    ]));

    expect(fragment.querySelector('a').getAttribute('href')).toBe(SIGNED_ASSET_URL);
  });
});

describe('NotionRenderer image security', () => {
  it('keeps caption markup separate from plain-text attributes and creates no inline handlers', () => {
    const renderer = new NotionRenderer();
    const maliciousCaption = '<img src=x onerror="globalThis.__captionXss = true"> Dragon & treasure';
    const maliciousBlockId = 'block" onmouseover="globalThis.__blockXss = true';
    const html = renderer.renderBlock({
      id: maliciousBlockId,
      type: 'image',
      image: {
        type: 'external',
        external: { url: SIGNED_ASSET_URL },
        caption: [textItem(maliciousCaption, { annotations: { bold: true } })]
      }
    });
    const fragment = fragmentFrom(html);
    const wrapper = fragment.querySelector('.notion-image');
    const image = fragment.querySelector('img.notion-image-clickable');
    const caption = fragment.querySelector('.notion-image-caption');

    expect(wrapper.dataset.blockId).toBe(maliciousBlockId);
    expect(image.getAttribute('src')).toBe(SIGNED_ASSET_URL);
    expect(image.dataset.imageUrl).toBe(SIGNED_ASSET_URL);
    expect(image.getAttribute('alt')).toBe(maliciousCaption);
    expect(image.dataset.imageCaption).toBe(maliciousCaption);
    expect(caption.textContent).toBe(maliciousCaption);
    expect(caption.querySelector('strong.notion-text-bold')).not.toBeNull();
    expect(caption.querySelector('img, script, svg')).toBeNull();
    expect(fragment.querySelector('[onerror], [onload], [onclick], [onmouseover]')).toBeNull();
  });

  it.each(EXECUTABLE_URLS)('rejects an image using %s', unsafeUrl => {
    const renderer = new NotionRenderer();
    const fragment = fragmentFrom(renderer.renderBlock({
      id: 'unsafe-image',
      type: 'image',
      image: {
        type: 'external',
        external: { url: unsafeUrl },
        caption: [textItem('Unsafe image')]
      }
    }));

    expect(fragment.querySelector('.notion-image-unavailable')).not.toBeNull();
    expect(fragment.querySelector('img')).toBeNull();
  });
});

describe('NotionRenderer external block URL security', () => {
  const blockFactories = {
    bookmark: url => ({ type: 'bookmark', bookmark: { url, caption: [textItem('Bookmark')] } }),
    link_preview: url => ({ type: 'link_preview', link_preview: { url } }),
    video: url => ({ type: 'video', video: { type: 'external', external: { url } } }),
    embed: url => ({ type: 'embed', embed: { url } })
  };

  for (const [blockType, makeBlock] of Object.entries(blockFactories)) {
    it.each(EXECUTABLE_URLS)(`${blockType} rejects %s`, unsafeUrl => {
      const renderer = new NotionRenderer();
      const fragment = fragmentFrom(renderer.renderBlock(makeBlock(unsafeUrl)));

      expect(fragment.querySelector('a, iframe, video')).toBeNull();
      expect(fragment.querySelector('[href], [src], [srcdoc]')).toBeNull();
    });
  }

  it('preserves safe bookmark, preview, video and embed URLs with defensive attributes', () => {
    const renderer = new NotionRenderer();
    const bookmarkUrl = 'https://example.com/reference?chapter=4&room=12';
    const previewUrl = 'https://example.com/preview?id=dragon';
    const videoUrl = `${SIGNED_ASSET_URL}&format=mp4`;
    const embedUrl = 'https://player.example.com/embed/encounter-1';

    const bookmark = fragmentFrom(renderer.renderBlock(blockFactories.bookmark(bookmarkUrl))).querySelector('a');
    const preview = fragmentFrom(renderer.renderBlock(blockFactories.link_preview(previewUrl))).querySelector('a');
    const video = fragmentFrom(renderer.renderBlock(blockFactories.video(videoUrl))).querySelector('video');
    const embed = fragmentFrom(renderer.renderBlock(blockFactories.embed(embedUrl))).querySelector('iframe');

    expect(bookmark.getAttribute('href')).toBe(bookmarkUrl);
    expect(bookmark.getAttribute('target')).toBe('_blank');
    expect(bookmark.getAttribute('rel')).toBe('noopener noreferrer');
    expect(preview.getAttribute('href')).toBe(previewUrl);
    expect(preview.getAttribute('rel')).toBe('noopener noreferrer');
    expect(video.getAttribute('src')).toBe(videoUrl);
    expect(video.hasAttribute('controls')).toBe(true);
    expect(embed.getAttribute('src')).toBe(embedUrl);
    expect(embed.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(embed.getAttribute('sandbox')).toContain('allow-scripts');
    expect(embed.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('only recognizes exact YouTube hosts and a valid eleven-character ID', () => {
    const renderer = new NotionRenderer();
    const valid = fragmentFrom(renderer.renderBlock(
      blockFactories.video('https://www.youtube.com/watch?v=AbCdEf012_-')
    ));
    const spoofed = fragmentFrom(renderer.renderBlock(
      blockFactories.video('https://youtube.com.evil.example/watch?v=AbCdEf012_-')
    ));
    const injectedId = fragmentFrom(renderer.renderBlock(
      blockFactories.video('https://www.youtube.com/watch?v=abc%22onload')
    ));

    expect(valid.querySelector('iframe')?.src).toBe('https://www.youtube.com/embed/AbCdEf012_-');
    expect(spoofed.querySelector('iframe')).toBeNull();
    expect(spoofed.querySelector('video')?.src).toContain('youtube.com.evil.example');
    expect(injectedId.querySelector('iframe')).toBeNull();
    expect(injectedId.querySelector('[onload]')).toBeNull();
  });
});

describe('NotionRenderer property and attribute security', () => {
  it('escapes property names and values, rejects executable links and allowlists tag colors', () => {
    const renderer = new NotionRenderer();
    const html = renderer.renderPageProperties({
      '"><img src=x onerror="globalThis.__nameXss=1">': {
        type: 'rich_text',
        rich_text: [textItem('<svg onload="globalThis.__valueXss=1">')]
      },
      Website: { type: 'url', url: 'javascript:alert(1)' },
      Status: {
        type: 'select',
        select: { name: '"><script>bad()</script>', color: 'red" onmouseover="alert(1)' }
      },
      Formula: {
        type: 'formula',
        formula: { type: 'string', string: '<img src=x onerror="alert(1)">' }
      }
    });
    const fragment = fragmentFrom(html);

    expect(fragment.querySelector('img, svg, script, [onerror], [onload], [onmouseover]')).toBeNull();
    expect(fragment.querySelector('a')).toBeNull();
    expect(fragment.textContent).toContain('javascript:alert(1)');
    expect(fragment.textContent).toContain('<script>bad()</script>');
    expect(fragment.querySelector('.notion-tag').className).toBe('notion-tag ');
  });

  it('escapes block IDs used in data attributes', () => {
    const renderer = new NotionRenderer();
    const fragment = fragmentFrom(renderer.renderBlock({
      id: 'table" onmouseover="globalThis.__idXss=1',
      type: 'table',
      table: {}
    }));

    expect(fragment.querySelector('.notion-table-container').dataset.tableId)
      .toBe('table" onmouseover="globalThis.__idXss=1');
    expect(fragment.querySelector('[onmouseover]')).toBeNull();
  });
});
