/* ChronoWeave -- View Dispatcher */

import { S } from './state.js';
import { gatherEvents, filterByImportance } from './helpers.js';
import { viewContainer } from './dom.js';

export async function renderView() {
  const events = filterByImportance(gatherEvents());
  viewContainer.innerHTML = '';

  if (!events.length) {
    viewContainer.innerHTML = '<div class="empty-state"><p>No events to display. Research a topic above.</p></div>';
    return;
  }

  if (S.view === 'list') {
    const { renderList } = await import('./views/list.js');
    renderList(events, viewContainer);
  } else if (S.view === 'horizontal') {
    const { renderHorizontal } = await import('./views/horizontal.js');
    renderHorizontal(events, viewContainer);
  } else {
    const { renderVertical } = await import('./views/vertical.js');
    renderVertical(events, viewContainer);
  }
}
