const NOTION_API_BASE = 'https://api.notion.com/v1';
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

export const onRequest = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const notionToken = env.NOTION_TOKEN;
  const notionDbId = env.NOTION_DB_ID;
  const notionVersion = env.NOTION_VERSION || '2022-06-28';

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
