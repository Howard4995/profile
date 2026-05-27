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

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(env) });
  }

  if (request.method !== 'GET') {
    return jsonResponse(env, { error: 'Method not allowed' }, 405);
  }

  const notionToken = env?.NOTION_TOKEN;
  const notionDbId = env?.NOTION_DB_ID;

  if (!notionToken || !notionDbId) {
    return jsonResponse(env, { error: 'Notion configuration missing' }, 500);
  }

  try {
    const response = await fetch(`${NOTION_API_BASE}/databases/${notionDbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionToken}`,
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
    const entries = (data.results || []).map((page) => ({
      id: page.id,
      title: getTitle(page) || '（無標題）',
      date: getDate(page),
      mood: getSelectName(page, 'Mood'),
      energy: getSelectName(page, 'Energy'),
      tags: getMultiSelectNames(page, 'Tags'),
    }));

    return jsonResponse(env, { entries });
  } catch (error) {
    console.error('Failed to fetch journal entries', error);
    return jsonResponse(
      env,
      {
        error: 'Failed to fetch journal entries',
        details: error.message,
      },
      500,
    );
  }
}
