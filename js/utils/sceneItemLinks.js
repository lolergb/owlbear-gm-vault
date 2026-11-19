import { METADATA_KEY } from './constants.js?v=2.1.5';

const layers = ['CHARACTER', 'MAP'];
export const linkKeys = Object.fromEntries(
  ['pageId', 'pageUrl', 'pageName', 'pageIcon', 'pageVisible'].map(key => [key, `${METADATA_KEY}/${key}`])
);

export function isLinkableItem(item) {
  return layers.includes(item?.layer);
}

export function hasPageLink(item) {
  return Boolean(item.metadata?.[linkKeys.pageId] || item.metadata?.[linkKeys.pageUrl]);
}

export function clearPageLink(item) {
  for (const key of Object.values(linkKeys)) delete item.metadata[key];
}

export function selectionLabel(items) {
  let noun = 'item';
  if (items.every(item => item.layer === 'MAP')) noun = 'map';
  else if (items.every(item => item.layer === 'CHARACTER')) noun = 'token';
  return items.length === 1 ? noun : `${items.length} ${noun}s`;
}

function metadataFilter(key, value, operator = '==') {
  return { key: ['metadata', linkKeys[key]], value, operator };
}

const layerFilter = [
  { key: 'layer', value: 'CHARACTER', coordinator: '||' },
  { key: 'layer', value: 'MAP' }
];

export function gmLinkFilter(linked = false) {
  const filter = { roles: ['GM'], every: layerFilter };
  if (linked) {
    filter.some = [
      { ...metadataFilter('pageId', undefined, '!='), coordinator: '||' },
      metadataFilter('pageUrl', undefined, '!=')
    ];
  }
  return filter;
}

// Each player's SDK registers only references present in their own vault.
// URL-only links are from older versions. A stored ID always takes precedence.
export function playerViewIcons(pages) {
  const icons = [];
  for (const key of ['pageId', 'pageUrl']) {
    const values = new Set(pages.map(page => key === 'pageId' ? page.id : page.url).filter(Boolean));
    if (!values.size) continue;
    const some = Array.from(values, value => ({ ...metadataFilter(key, value), coordinator: '||' }));
    for (const layer of layers) {
      const every = [{ key: 'layer', value: layer }];
      if (key === 'pageUrl') {
        every.push(metadataFilter('pageId', undefined), metadataFilter('pageVisible', true));
      }
      icons.push({
        icon: '/img/icon-view-page.svg', label: 'View linked page',
        filter: { roles: ['PLAYER'], max: 1, every, some }
      });
    }
  }
  return icons;
}

export function findLinkedPage(container, pageId, url, path = []) {
  if (!container) return null;
  const index = (container.pages || []).findIndex(page => pageId ? page.id === pageId : url && page.url === url);
  if (index >= 0) return { page: container.pages[index], path, index };
  for (const folder of container.categories || []) {
    const match = findLinkedPage(folder, pageId, url, [...path, folder.name]);
    if (match) return match;
  }
  return null;
}
