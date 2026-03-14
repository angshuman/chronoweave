/* ChronoWeave -- List View Renderer */

import { formatDate, formatDateRange, impOpacity, eventColor, parseTags, sourceLabel } from '../helpers.js';
import { openModal } from '../modal.js';

export function renderList(events, container) {
  const wrap = document.createElement('div');
  wrap.className = 'list-view';

  // Group by decade
  const groups = {};
  events.forEach(ev => {
    const d = new Date(ev.start_date + (ev.start_date.length === 4 ? '-01-01' : ''));
    const decade = Math.floor((isNaN(d) ? 0 : d.getFullYear()) / 10) * 10;
    const key = isNaN(d) ? 'Unknown' : `${decade}s`;
    (groups[key] = groups[key] || []).push(ev);
  });

  Object.entries(groups).forEach(([label, evs]) => {
    const grp = document.createElement('div');
    grp.className = 'list-group';
    grp.innerHTML = `<div class="list-group-label">${label}</div>`;

    evs.forEach(ev => {
      const color = eventColor(ev);
      const opacity = impOpacity(ev.importance);
      const tags = parseTags(ev.tags);
      const row = document.createElement('div');
      row.className = 'list-event';
      row.style.borderLeftColor = color;
      row.style.opacity = String(opacity);
      row.innerHTML = `
        <div class="list-date">${formatDateRange(ev.start_date, ev.end_date, ev.date_precision)}</div>
        <div class="list-body">
          <div class="list-title">${esc(ev.title)}</div>
          <div class="list-desc">${esc(ev.description || '')}</div>
          ${tags.length ? '<div class="list-tags">' + tags.map(t => `<span class="list-tag">${esc(t)}</span>`).join('') + '</div>' : ''}
        </div>
      `;
      row.addEventListener('click', () => openModal(ev));
      grp.appendChild(row);
    });
    wrap.appendChild(grp);
  });

  container.appendChild(wrap);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
