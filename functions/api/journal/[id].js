const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const buildCorsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env?.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

const jsonResponse = (env, body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(env),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

const htmlResponse = (env, body, status = 200) =>
  new Response(body, {
    status,
    headers: {
      ...buildCorsHeaders(env),
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
      return `<p>${content || ''}</p>`;
    }
    case 'heading_1': {
      const content = renderRichText(block.heading_1?.rich_text || []);
      return `<h2>${content}</h2>`;
    }
    case 'heading_2': {
      const content = renderRichText(block.heading_2?.rich_text || []);
      return `<h3>${content}</h3>`;
    }
    case 'heading_3': {
      const content = renderRichText(block.heading_3?.rich_text || []);
      return `<h4>${content}</h4>`;
    }
    case 'bulleted_list_item': {
      const content = renderRichText(block.bulleted_list_item?.rich_text || []);
      return `<li>${content}</li>`;
    }
    default:
      return '';
  }
};

const blocksToHtml = (blocks) => {
  const htmlParts = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length) {
      htmlParts.push(`<ul>${listItems.join('')}</ul>`);
      listItems = [];
    }
  };

  blocks.forEach((block) => {
    if (block.type === 'bulleted_list_item') {
      listItems.push(renderBlock(block));
      return;
    }

    flushList();
    const rendered = renderBlock(block);
    if (rendered) htmlParts.push(rendered);
  });

  flushList();
  return htmlParts.join('');
};

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(env) });
  }

  if (request.method !== 'GET') {
    return jsonResponse(env, { error: 'Method not allowed' }, 405);
  }

  const notionToken = env?.NOTION_TOKEN;
  if (!notionToken) {
    return jsonResponse(env, { error: 'Notion configuration missing' }, 500);
  }

  const entryId = params?.id;
  if (!entryId) {
    return jsonResponse(env, { error: 'Missing journal id' }, 400);
  }

  try {
    const response = await fetch(`${NOTION_API_BASE}/blocks/${entryId}/children`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': NOTION_VERSION,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Notion API error', errorText);
      return jsonResponse(
        env,
        {
          error: 'Notion API error',
          details: response.statusText,
        },
        response.status,
      );
    }

    const data = await response.json();
    const html = blocksToHtml(data.results || []);

    return htmlResponse(env, html);
  } catch (error) {
    console.error('Failed to fetch journal entry', error);
    return jsonResponse(
      env,
      {
        error: 'Failed to fetch journal entry',
        details: error.message,
      },
      500,
    );
  }
}
