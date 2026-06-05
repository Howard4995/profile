import {
  buildCorsHeaders,
  jsonResponse,
  journalListResponse,
  journalEntryResponse,
} from '../functions/_shared/notion.js';

const TWEETS_KV_KEY = 'tweet_ids';

// Notion content changes infrequently, so let the edge serve cached copies.
// Entry bodies are immutable-ish and get a longer TTL than the list/tweets.
const CACHE_CONTROL_LIST = 'public, max-age=300, s-maxage=300';
const CACHE_CONTROL_ENTRY = 'public, max-age=600, s-maxage=600';
const CACHE_CONTROL_TWEETS = 'public, max-age=300, s-maxage=300';

const withCacheControl = (response, value) => {
  if (response && response.ok) response.headers.set('Cache-Control', value);
  return response;
};

const handleTweets = async (request, env) => {
  const corsHeaders = buildCorsHeaders(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const url = new URL(request.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));

  if (!env.RETWEETS_KV) {
    return jsonResponse({ tweet_ids: [], total: 0, page, limit }, 200, corsHeaders);
  }

  try {
    const raw = await env.RETWEETS_KV.get(TWEETS_KV_KEY);
    const allIds = raw ? (raw.match(/\d{10,}/g) || []) : [];
    const start = page * limit;
    const slice = allIds.slice(start, start + limit);
    return withCacheControl(
      jsonResponse({ tweet_ids: slice, total: allIds.length, page, limit }, 200, corsHeaders),
      CACHE_CONTROL_TWEETS,
    );
  } catch (error) {
    console.error('Failed to read tweets from KV', error);
    return jsonResponse({ tweet_ids: [], total: 0, page, limit }, 200, corsHeaders);
  }
};

const routeApi = async (request, env, pathname) => {
  if (pathname === '/api/journal' || pathname === '/api/journal/') {
    return withCacheControl(await journalListResponse(request, env), CACHE_CONTROL_LIST);
  }

  const journalMatch = pathname.match(/^\/api\/journal\/([^/]+)\/?$/);
  if (journalMatch) {
    return withCacheControl(
      await journalEntryResponse(request, env, journalMatch[1]),
      CACHE_CONTROL_ENTRY,
    );
  }

  if (pathname === '/api/tweets' || pathname === '/api/tweets/') {
    return handleTweets(request, env);
  }

  return null;
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/api/')) {
      // Edge-cache successful GET responses so repeated journal/tweet reads
      // are served from Cloudflare's cache instead of round-tripping to Notion.
      // Handlers opt in by setting Cache-Control on their success responses.
      if (request.method === 'GET') {
        const cache = caches.default;
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await routeApi(request, env, pathname);
        if (response && response.ok && response.headers.has('Cache-Control')) {
          ctx.waitUntil(cache.put(request, response.clone()));
        }
        if (response) return response;
      } else {
        const response = await routeApi(request, env, pathname);
        if (response) return response;
      }
    }

    return env.ASSETS.fetch(request);
  },
};
