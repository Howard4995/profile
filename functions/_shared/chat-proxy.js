// Shared OpenAI-compatible chat proxy.
//
// The browser cannot call arbitrary third-party OpenAI-compatible endpoints
// directly when those endpoints don't send permissive CORS headers. This proxy
// runs at the edge (same-origin as the site), forwards the request to the
// target API, and streams the response back — sidestepping the CORS problem.
//
// Both the Cloudflare Worker (src/index.js) and the Pages Function
// (functions/api/chat/proxy.js) import this module so behaviour is identical.

// Hosts the proxy is allowed to forward to. Extend via the
// CHAT_PROXY_ALLOWED_HOSTS env var (comma-separated hostnames) so the endpoint
// can't be abused as a general-purpose open relay.
const DEFAULT_ALLOWED_HOSTS = ['token-plan-sgp.xiaomimimo.com', 'api.openai.com'];

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-Url',
});

const errorResponse = (message, status) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });

const allowedHosts = (env) => {
  const extra = (env && env.CHAT_PROXY_ALLOWED_HOSTS) || '';
  const fromEnv = extra.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_HOSTS, ...fromEnv]);
};

// Handles GET (e.g. /models) and POST (e.g. /chat/completions). The full target
// URL is supplied by the client in the `X-Target-Url` header; the caller's
// Authorization header is forwarded untouched (keys never touch our storage).
export const chatProxyResponse = async (request, env) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const target = request.headers.get('X-Target-Url');
  if (!target) {
    return errorResponse('Missing X-Target-Url header', 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (_) {
    return errorResponse('Invalid X-Target-Url', 400);
  }

  if (targetUrl.protocol !== 'https:') {
    return errorResponse('Only https targets are allowed', 400);
  }
  if (!allowedHosts(env).has(targetUrl.hostname.toLowerCase())) {
    return errorResponse(`Host not allowed: ${targetUrl.hostname}`, 403);
  }

  const auth = request.headers.get('Authorization');

  const init = {
    method: request.method,
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      'Content-Type': 'application/json',
      Accept: request.headers.get('Accept') || 'application/json',
    },
  };
  if (request.method === 'POST') {
    init.body = await request.text();
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), init);
  } catch (err) {
    return errorResponse(`Upstream fetch failed: ${err.message}`, 502);
  }

  // Stream the upstream body straight back, preserving SSE streaming and the
  // upstream status/content-type so the client parses it exactly as if direct.
  // Intentionally no Cache-Control header: the Worker only edge-caches /api GET
  // responses that carry one, so omitting it keeps proxied traffic uncached.
  const headers = new Headers(corsHeaders());
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  return new Response(upstream.body, { status: upstream.status, headers });
};
