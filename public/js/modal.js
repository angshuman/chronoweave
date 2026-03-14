/* ChronoWeave -- Modal */

import { _$, modalBg } from './dom.js';
import { formatDateRange, sourceLabel, parseTags, impOpacity, eventColor } from './helpers.js';

export function initModal() {
  _$('#modalClose').addEventListener('click', closeModal);
  modalBg.addEventListener('click', (e) => {
    if (e.target === modalBg) closeModal();
  });
}

export function openModal(ev) {
  _$('#modalDate').textContent  = formatDateRange(ev.start_date, ev.end_date, ev.date_precision);
  _$('#modalTitle').textContent = ev.title || '';
  _$('#modalDesc').textContent  = ev.description || '';

  const meta = _$('#modalMeta');
  meta.innerHTML = '';

  const tags = parseTags(ev.tags);
  tags.forEach(t => {
    const span = document.createElement('span');
    span.className = 'modal-tag';
    span.textContent = t;
    meta.appendChild(span);
  });

  if (ev.category) {
    const span = document.createElement('span');
    span.className = 'modal-tag';
    span.textContent = ev.category;
    meta.appendChild(span);
  }

  const src = sourceLabel(ev);
  if (src) {
    const span = document.createElement('span');
    span.className = 'modal-tag';
    span.style.color = eventColor(ev);
    span.textContent = src;
    meta.appendChild(span);
  }

  const imp = document.createElement('span');
  imp.className = 'modal-tag';
  imp.textContent = `Importance: ${ev.importance || 5}`;
  meta.appendChild(imp);

  const box = _$('#modalBox');
  box.style.borderTop = `3px solid ${eventColor(ev)}`;
  box.style.opacity = String(impOpacity(ev.importance));

  modalBg.classList.remove('hidden');
}

export function closeModal() {
  modalBg.classList.add('hidden');
}
