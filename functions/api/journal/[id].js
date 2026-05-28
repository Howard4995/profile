const NOTION_API_BASE = 'https://api.notion.com/v1';

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

const renderBlock = (block) => {
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
      console.warn('Unsupported Notion block type', block.type);
      return '';
  }
};

const blocksToHtml = (blocks) => {
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
    listItems.push(renderBlock(block));
  };

  blocks.forEach((block) => {
    if (isListItem(block)) {
      pushListItem(block);
      return;
    }

    flushList();
    const rendered = renderBlock(block);
    if (rendered) htmlParts.push(rendered);
  });

  flushList();
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
  const notionVersion = env.NOTION_VERSION || '2022-06-28';
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
        {
          error: 'Notion API error',
          details: response.statusText,
        },
        response.status,
        corsHeaders,
      );
    }

    const data = await response.json();
    const html = blocksToHtml(data.results || []);
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
