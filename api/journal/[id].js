const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!NOTION_TOKEN) {
    return res.status(500).json({ error: 'Notion configuration missing' });
  }

  const { id } = req.query || {};
  if (!id) {
    return res.status(400).json({ error: 'Missing journal id' });
  }

  try {
    const response = await fetch(`${NOTION_API_BASE}/blocks/${id}/children`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: 'Notion API error', details: errorText });
    }

    const data = await response.json();
    const html = blocksToHtml(data.results || []);

    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch journal entry' });
  }
}
