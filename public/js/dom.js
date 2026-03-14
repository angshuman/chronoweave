/* ChronoWeave -- DOM References */

export const _$ = s => document.querySelector(s);
export const _$$ = s => [...document.querySelectorAll(s)];

export const sidebar       = _$('#sidebar');
export const sessionList   = _$('#sessionList');
export const btnNewSession = _$('#btnNewSession');

export const topbar        = _$('#topbar');
export const topbarTitle   = _$('#topbarTitle');
export const researchForm  = _$('#researchForm');
export const researchInput = _$('#researchInput');
export const btnResearch   = _$('#btnResearch');

export const controlsBar   = _$('#controlsBar');
export const chipScroll    = _$('#chipScroll');
export const btnMerge      = _$('#btnMerge');

export const content       = _$('#content');
export const landing       = _$('#landing');
export const viewContainer = _$('#viewContainer');

export const modalBg    = _$('#modalBg');
export const modalBox   = _$('#modalBox');
export const modalClose = _$('#modalClose');
export const modalDate  = _$('#modalDate');
export const modalTitle = _$('#modalTitle');
export const modalDesc  = _$('#modalDesc');
export const modalMeta  = _$('#modalMeta');

export const reasoningPanel       = _$('#reasoningPanel');
export const reasoningText        = _$('#reasoningText');
export const reasoningStatus      = _$('#reasoningStatus');
export const reasoningProgressBar = _$('#reasoningProgressBar');
export const reasoningSpinner     = _$('#reasoningSpinner');
export const btnReasoningToggle   = _$('#btnReasoningToggle');
