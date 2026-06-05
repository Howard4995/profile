import { journalEntryResponse } from '../../_shared/notion.js';

export const onRequest = ({ request, env, params }) =>
  journalEntryResponse(request, env, params?.id);
