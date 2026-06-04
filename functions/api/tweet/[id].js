// Same-origin proxy for X/Twitter's syndication API.
//
// The syndication endpoint (cdn.syndication.twimg.com) is the same source
// react-tweet uses, but it is NOT CORS-enabled, so a browser cannot fetch it
// directly. This Worker runs server-side on Cloudflare's edge where CORS does
// not apply, fetches the tweet, and returns trimmed JSON to the page.

const SYNDICATION_URL = 'https://cdn.syndication.twimg.com/tweet-result';

// Mirrors vercel/react-tweet's getToken().
const getToken = (id) =>
  ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');

const FEATURES = [
  'tfw_timeline_list:',
  'tfw_follower_count_sunset:true',
  'tfw_tweet_edit_backend:on',
  'tfw_refsrc_session:on',
  'tfw_fosnr_soft_interventions_enabled:on',
  'tfw_show_birdwatch_pivots_enabled:on',
  'tfw_show_business_verified_badge:on',
  'tfw_duplicate_scribes_to_settings:on',
  'tfw_use_profile_image_shape_enabled:on',
  'tfw_show_blue_verified_badge:on',
  'tfw_legacy_timeline_sunset:true',
  'tfw_show_gov_verified_badge:on',
  'tfw_show_business_affiliate_badge:on',
  'tfw_tweet_edit_frontend:on',
].join(';');

const buildCorsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

const jsonResponse = (body, status, corsHeaders, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...extra,
    },
  });

// Trim the syndication payload down to just what the tweet card needs.
const normalize = (data) => ({
  id_str: data.id_str || '',
  text: data.text || data.full_text || '',
  created_at: data.created_at || '',
  user: {
    name: data.user?.name || '',
    screen_name: data.user?.screen_name || '',
    profile_image_url_https: data.user?.profile_image_url_https || '',
    is_blue_verified: !!data.user?.is_blue_verified,
    verified: !!data.user?.verified,
  },
  mediaDetails: Array.isArray(data.mediaDetails)
    ? data.mediaDetails
        .filter((m) => m && m.media_url_https)
        .map((m) => ({ type: m.type || 'photo', media_url_https: m.media_url_https }))
    : [],
});

export const onRequest = async ({ request, env, params }) => {
  const corsHeaders = buildCorsHeaders(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const id = params?.id || '';
  if (!/^[0-9]+$/.test(id) || id.length > 40) {
    return jsonResponse({ error: 'Invalid tweet id' }, 400, corsHeaders);
  }

  try {
    const url = new URL(SYNDICATION_URL);
    url.searchParams.set('id', id);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('features', FEATURES);
    url.searchParams.set('token', getToken(id));

    const res = await fetch(url.toString(), {
      headers: {
        // A UA + accept header keeps the undocumented endpoint happy.
        'User-Agent':
          'Mozilla/5.0 (compatible; ProfileBot/1.0; +https://howardx.me)',
        Accept: 'application/json',
      },
    });

    if (res.status === 404) {
      return jsonResponse({ error: 'Tweet not found' }, 404, corsHeaders);
    }
    if (!res.ok) {
      return jsonResponse(
        { error: 'Syndication API error', status: res.status },
        502,
        corsHeaders,
      );
    }

    const data = await res.json();
    if (!data || data.__typename === 'TweetTombstone' || !data.id_str) {
      return jsonResponse({ error: 'Tweet unavailable' }, 404, corsHeaders);
    }

    // Cache at the edge for an hour to avoid rate limiting / IP blocks.
    return jsonResponse(normalize(data), 200, corsHeaders, {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    });
  } catch (error) {
    console.error('Failed to fetch tweet', error);
    return jsonResponse(
      { error: 'Failed to fetch tweet', details: error.message },
      500,
      corsHeaders,
    );
  }
};
