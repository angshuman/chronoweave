/* ChronoWeave -- Research via SSE streaming */

import { S } from './state.js';
import { renderChips } from './sessions.js';
import { renderView } from './render.js';
import { reasoningStart, reasoningToken, reasoningDone, reasoningError } from './reasoning.js';
import { controlsBar, landing } from './dom.js';

export async function doResearch(query) {
  if (!S.sessionId) return;

  reasoningStart();
  controlsBar.classList.remove('hidden');
  landing.classList.add('hidden');

  const color = S.nextColor();
  const url = `/api/research/stream?session_id=${encodeURIComponent(S.sessionId)}&query=${encodeURIComponent(query)}&color=${encodeURIComponent(color)}`;

  const es = new EventSource(url);

  es.addEventListener('token', (e) => {
    const d = JSON.parse(e.data);
    reasoningToken(d.text || '');
  });

  es.addEventListener('timeline', (e) => {
    const tl = JSON.parse(e.data);
    S.timelines.push(tl);
    S.visibleTimelines.push(tl.id);
    renderChips();
    renderView();
    reasoningDone();
    es.close();
  });

  es.addEventListener('error', (e) => {
    let msg = 'Unknown error';
    try { msg = JSON.parse(e.data).message; } catch {}
    reasoningError(msg);
    es.close();
  });

  es.addEventListener('done', () => {
    reasoningDone();
    es.close();
  });

  es.onerror = () => {
    reasoningError('Connection error');
    es.close();
  };
}
