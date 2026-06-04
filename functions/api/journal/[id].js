import { DEFAULT_NOTION_VERSION } from '../../_shared/notion.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const TWEET_URL_RE = /(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/;

const buildCorsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

const jsonResponse = (body, status, corsHeaders) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

const textResponse = (body, status, corsHeaders) =>
  new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const wrapAnnotation = (html, annotation, tag) => {
  if (!annotation) return html;
  return `<${tag}>${html}</${tag}>`;
};

const renderRichText = (richText = []) =>
  richText
    .map((item) => {
      const text = escapeHtml(item.plain_text || '');
      const withBreaks = text.split('\n').join('<br />');
      let html = withBreaks;

      if (item.annotations) {
        html = wrapAnnotation(html, item.annotations.code, 'code');
        html = wrapAnnotation(html, item.annotations.bold, 'strong');
        html = wrapAnnotation(html, item.annotations.italic, 'em');
        html = wrapAnnotation(html, item.annotations.underline, 'u');
        html = wrapAnnotation(html, item.annotations.strikethrough, 's');
      }

      if (item.href) {
        html = `<a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
      }

      return html;
    })
    .join('');

// Pull a tweet URL out of whichever Notion block type Notion happened to use
// for an X/Twitter link (embed, bookmark, or link_preview).
const extractTweetUrl = (block) => {
  const candidates = [
    block.embed?.url,
    block.bookmark?.url,
    block.link_preview?.url,
    block.video?.external?.url,
  ];
  for (const url of candidates) {
    if (url && TWEET_URL_RE.test(url)) return url;
  }
  return null;
};

// Tweets become an anchor carrying the tweet id; the client upgrades it into a
// full card via the syndication API, and the anchor stays as a graceful
// fallback if that fetch ever fails.
const renderTweet = (url) => {
  const id = (url.match(TWEET_URL_RE) || [])[1] || '';
  return `<a class="tweet-embed" data-tweet-id="${escapeHtml(id)}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
};

const renderBlock = (block, entryId) => {
  const tweetUrl = extractTweetUrl(block);
  if (tweetUrl) return renderTweet(tweetUrl);

  switch (block.type) {
    case 'paragraph': {
      const content = renderRichText(block.paragraph?.rich_text || []);
      return `<p>${content}</p>`;
    }
    case 'heading_1': {
      const content = renderRichText(block.heading_1?.rich_text || []);
      return `<h1>${content}</h1>`;
    }
    case 'heading_2': {
      const content = renderRichText(block.heading_2?.rich_text || []);
      return `<h2>${content}</h2>`;
    }
    case 'heading_3': {
      const content = renderRichText(block.heading_3?.rich_text || []);
      return `<h3>${content}</h3>`;
    }
    case 'bulleted_list_item': {
      const content = renderRichText(block.bulleted_list_item?.rich_text || []);
      return `<li>${content}</li>`;
    }
    case 'ordered_list_item': {
      const content = renderRichText(block.ordered_list_item?.rich_text || []);
      return `<li>${content}</li>`;
    }
    case 'embed': {
      const url = block.embed?.url || '';
      if (!url) return '';
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    }
    case 'bookmark': {
      const url = block.bookmark?.url || '';
      if (!url) return '';
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    }
    case 'link_preview': {
      const url = block.link_preview?.url || '';
      if (!url) return '';
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    }
    default:
      console.warn('Unsupported Notion block type', { type: block.type, entryId });
      return '';
  }
};

const imageUrl = (block) =>
  block.image?.file?.url || block.image?.external?.url || '';

const renderImage = (block) => {
  const url = imageUrl(block);
  if (!url) return '';
  const captionText = (block.image?.caption || []).map((t) => t.plain_text || '').join('');
  return `<img class="notion-image" src="${escapeHtml(url)}" alt="${escapeHtml(captionText)}" />`;
};

const blocksToHtml = (blocks, entryId) => {
  const htmlParts = [];
  let listItems = [];
  let listType = null;
  let imageGroup = [];

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === 'ordered_list_item' ? 'ol' : 'ul';
    htmlParts.push(`<${tag}>${listItems.join('')}</${tag}>`);
    listItems = [];
    listType = null;
  };

  // Consecutive image blocks become one gallery so the client can lay them out
  // Threads-style (single = framed, multiple = horizontal carousel).
  const flushImages = () => {
    if (!imageGroup.length) return;
    const imgs = imageGroup.map(renderImage).filter(Boolean).join('');
    if (imgs) {
      const multi = imageGroup.length > 1 ? ' is-multi' : '';
      htmlParts.push(`<div class="notion-gallery${multi}">${imgs}</div>`);
    }
    imageGroup = [];
  };

  const isListItem = (block) =>
    block.type === 'bulleted_list_item' || block.type === 'ordered_list_item';

  const pushListItem = (block) => {
    if (!listType) {
      listType = block.type;
    } else if (listType !== block.type) {
      flushList();
      listType = block.type;
    }
    listItems.push(renderBlock(block, entryId));
  };

  blocks.forEach((block) => {
    if (block.type === 'image') {
      flushList();
      imageGroup.push(block);
      return;
    }
    flushImages();

    if (isListItem(block)) {
      pushListItem(block);
      return;
    }

    flushList();
    const rendered = renderBlock(block, entryId);
    if (rendered) htmlParts.push(rendered);
  });

  flushList();
  flushImages();
  return htmlParts.join('');
};

export const onRequest = async ({ request, env, params }) => {
  const corsHeaders = buildCorsHeaders(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const notionToken = env.NOTION_TOKEN;
  const notionVersion = env.NOTION_VERSION || DEFAULT_NOTION_VERSION;
  const entryId = params?.id;

  if (!notionToken) {
    return jsonResponse({ error: 'Notion configuration missing' }, 500, corsHeaders);
  }

  if (!entryId) {
    return jsonResponse({ error: 'Missing journal id' }, 400, corsHeaders);
  }

  try {
    const headers = {
      Authorization: 'Bearer ' + notionToken,
      'Notion-Version': notionVersion,
    };

    const response = await fetch(`${NOTION_API_BASE}/blocks/${entryId}/children`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Notion API error', errorText);
      return jsonResponse(
        { error: 'Notion API error', details: response.statusText },
        response.status,
        corsHeaders,
      );
    }

    const data = await response.json();
    const html = blocksToHtml(data.results || [], entryId);
    return textResponse(html, 200, corsHeaders);
  } catch (error) {
    console.error('Failed to fetch journal entry', error);
    return jsonResponse(
      { error: 'Failed to fetch journal entry', details: error.message },
      500,
      corsHeaders,
    );
  }
};
