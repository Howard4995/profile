import { journalListResponse } from '../_shared/notion.js';

export const onRequest = ({ request, env }) => journalListResponse(request, env);
