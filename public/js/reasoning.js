/* ChronoWeave -- Reasoning Panel Logic */

import {
  reasoningPanel, reasoningText, reasoningStatus,
  reasoningProgressBar, reasoningSpinner, btnReasoningToggle,
} from './dom.js';

let _open = false;

export function initReasoning() {
  if (!btnReasoningToggle) return;
  btnReasoningToggle.addEventListener('click', () => {
    _open = !_open;
    reasoningPanel.classList.toggle('open', _open);
    btnReasoningToggle.classList.toggle('open', _open);
  });
}

export function reasoningStart() {
  if (!reasoningText) return;
  reasoningText.textContent = '';
  reasoningProgressBar.style.width = '0%';
  reasoningStatus.textContent = 'Researching...';
  reasoningSpinner.style.display = 'inline-block';

  // Auto-show panel
  _open = true;
  reasoningPanel.classList.add('open');
  btnReasoningToggle.classList.remove('hidden');
  btnReasoningToggle.classList.add('open');
}

export function reasoningToken(text) {
  if (!reasoningText) return;
  reasoningText.textContent += text;
  // Auto-scroll
  const scroll = reasoningText.closest('.reasoning-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;

  // Animate progress bar heuristically
  const cur = parseFloat(reasoningProgressBar.style.width) || 0;
  if (cur < 90) {
    reasoningProgressBar.style.width = Math.min(cur + 0.5, 90) + '%';
  }
}

export function reasoningDone() {
  if (!reasoningText) return;
  reasoningProgressBar.style.width = '100%';
  reasoningStatus.textContent = 'Done';
  reasoningSpinner.style.display = 'none';

  // Collapse after 3s
  setTimeout(() => {
    _open = false;
    reasoningPanel.classList.remove('open');
    btnReasoningToggle.classList.remove('open');
  }, 3000);
}

export function reasoningError(msg) {
  if (!reasoningStatus) return;
  reasoningStatus.textContent = 'Error: ' + msg;
  reasoningSpinner.style.display = 'none';
}
