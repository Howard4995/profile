const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
// Default pinned to a stable Notion API version; override with NOTION_VERSION if needed.
const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';
// WARNING: Set ALLOWED_ORIGIN in production to restrict CORS.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

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

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(500).json({ error: 'Notion configuration missing' });
  }

  try {
    const response = await fetch(`${NOTION_API_BASE}/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
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
      return res.status(response.status).json({
        error: 'Notion API error',
        details: response.statusText,
      });
    }

    const data = await response.json();
    const entries = (data.results || []).map((page) => ({
      id: page.id,
      title: getTitle(page) || '（無標題）',
      date: getDate(page),
      mood: getSelectName(page, 'Mood'),
      energy: getSelectName(page, 'Energy'),
      tags: getMultiSelectNames(page, 'Tags'),
    }));

    return res.status(200).json({ entries });
  } catch (error) {
    console.error('Failed to fetch journal entries', error);
    return res.status(500).json({
      error: 'Failed to fetch journal entries',
      details: error.message,
    });
  }
}
