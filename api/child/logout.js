import { clearChildSessionCookie, requireMethod, sendJson } from '../_lib/server.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  clearChildSessionCookie(res);
  return sendJson(res, 200, { success: true });
}
