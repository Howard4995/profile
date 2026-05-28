const NOTION_API_BASE = 'https://api.notion.com/v1';
const DEFAULT_NOTION_VERSION = '2022-06-28';
const DEFAULT_TITLE = '（無標題）';

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
      'Content-Type': 'application/json',
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

const getTitle = (page) => {
  const titleProp = page?.properties?.['標題'];
  if (!titleProp || !Array.isArray(titleProp.title)) return '';
  return titleProp.title.map((item) => item.plain_text || '').join('').trim();
};

const getDate = (page) => {
  const dateProp = page?.properties?.['日期'];
  return dateProp?.date?.start || '';
};

const getSelectName = (page, propName) => {
  const prop = page?.properties?.[propName];
  return prop?.select?.name || '';
};

const getMultiSelectNames = (page, propName) => {
  const prop = page?.properties?.[propName];
  if (!Array.isArray(prop?.multi_select)) return [];
  return prop.multi_select.map((item) => item.name).filter(Boolean);
};

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

const renderBlock = (block, entryId) => {
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
    default:
      console.warn('Unsupported Notion block type', { type: block.type, entryId });
      return '';
  }
};

const blocksToHtml = (blocks, entryId) => {
  const htmlParts = [];
  let listItems = [];
  let listType = null;

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === 'ordered_list_item' ? 'ol' : 'ul';
    htmlParts.push(`<${tag}>${listItems.join('')}</${tag}>`);
    listItems = [];
    listType = null;
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
    if (isListItem(block)) {
      pushListItem(block);
      return;
    }

    flushList();
    const rendered = renderBlock(block, entryId);
    if (rendered) htmlParts.push(rendered);
  });

  flushList();
  return htmlParts.join('');
};

const handleJournalList = async (request, env) => {
  const corsHeaders = buildCorsHeaders(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const notionToken = env.NOTION_TOKEN;
  const notionDbId = env.NOTION_DB_ID;
  const notionVersion = env.NOTION_VERSION || DEFAULT_NOTION_VERSION;

  if (!notionToken || !notionDbId) {
    return jsonResponse({ error: 'Notion configuration missing' }, 500, corsHeaders);
  }

  try {
    const headers = {
      Authorization: 'Bearer ' + notionToken,
      'Notion-Version': notionVersion,
      'Content-Type': 'application/json',
    };
    const response = await fetch(`${NOTION_API_BASE}/databases/${notionDbId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sorts: [
          {
            property: '日期',
            direction: 'descending',
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Notion API error', errorText);
      return jsonResponse(
        {
          error: 'Notion API error',
          details: response.statusText,
        },
        response.status,
        corsHeaders,
      );
    }

    const data = await response.json();
    const entries = (data.results || []).map((page) => ({
      id: page.id,
      title: getTitle(page) || DEFAULT_TITLE,
      date: getDate(page),
      mood: getSelectName(page, 'Mood'),
      energy: getSelectName(page, 'Energy'),
      tags: getMultiSelectNames(page, 'Tags'),
    }));

    return jsonResponse({ entries }, 200, corsHeaders);
  } catch (error) {
    console.error('Failed to fetch journal entries', error);
    return jsonResponse(
      {
        error: 'Failed to fetch journal entries',
        details: error.message,
      },
      500,
      corsHeaders,
    );
  }
};

const handleJournalEntry = async (request, env, entryId) => {
  const corsHeaders = buildCorsHeaders(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const notionToken = env.NOTION_TOKEN;
  const notionVersion = env.NOTION_VERSION || DEFAULT_NOTION_VERSION;

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
        {
          error: 'Notion API error',
          details: response.statusText,
        },
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
      {
        error: 'Failed to fetch journal entry',
        details: error.message,
      },
      500,
      corsHeaders,
    );
  }
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/journal' || pathname === '/api/journal/') {
      return handleJournalList(request, env);
    }

    const journalMatch = pathname.match(/^\/api\/journal\/([^/]+)\/?$/);
    if (journalMatch) {
      return handleJournalEntry(request, env, journalMatch[1]);
    }

    return env.ASSETS.fetch(request);
  },
};
