import { chatProxyResponse } from '../../_shared/chat-proxy.js';

export const onRequest = ({ request, env }) => chatProxyResponse(request, env);
