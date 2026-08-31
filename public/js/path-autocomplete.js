export function createPathAutocomplete({ apiFetch, escapeHtml }) {
  const timers = new Map();

  function render(menuEl, suggestions, activeIndex = -1) {
    if (!menuEl) return;
    const values = Array.isArray(suggestions) ? suggestions : [];
    if (!values.length) {
      menuEl.innerHTML = '';
      menuEl.hidden = true;
      return;
    }
    menuEl.hidden = false;
    menuEl.innerHTML = values.map((value, index) => `
      <button type="button" class="path-suggestion-item${index === activeIndex ? ' is-active' : ''}" data-path-value="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(value)}</button>
    `).join('');
  }

  async function fetchSuggestions(query) {
    if (!query || query.trim().length < 1) return [];
    const data = await apiFetch(`/api/path-suggest?q=${encodeURIComponent(query)}`);
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  }

  function wire(inputEl, menuEl) {
    if (!inputEl || !menuEl) return;
    let suggestions = [];
    let activeIndex = -1;
    let requestId = 0;
    const close = () => {
      activeIndex = -1;
      suggestions = [];
      render(menuEl, []);
    };
    const revealActive = () => menuEl.querySelector('.path-suggestion-item.is-active')?.scrollIntoView({ block: 'nearest' });
    const redraw = () => {
      render(menuEl, suggestions, activeIndex);
      revealActive();
    };
    const load = async value => {
      const nextRequestId = requestId + 1;
      requestId = nextRequestId;
      if (!value) return close();
      try {
        const next = await fetchSuggestions(value);
        if (requestId !== nextRequestId) return;
        suggestions = next;
        activeIndex = suggestions.length ? 0 : -1;
        redraw();
      } catch {
        if (requestId === nextRequestId) close();
      }
    };
    const apply = value => {
      inputEl.value = /[\\/]$/.test(value) ? value : `${value}/`;
      inputEl.focus();
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      void load(inputEl.value.trim());
    };
    const schedule = () => {
      const timer = timers.get(inputEl);
      if (timer) clearTimeout(timer);
      timers.set(inputEl, setTimeout(() => { void load(inputEl.value.trim()); }, 150));
    };

    menuEl.addEventListener('mousedown', event => event.preventDefault());
    menuEl.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('[data-path-value]') : null;
      if (target instanceof HTMLElement && target.dataset.pathValue) apply(target.dataset.pathValue);
    });
    inputEl.addEventListener('input', schedule);
    inputEl.addEventListener('focus', schedule);
    inputEl.addEventListener('blur', () => window.setTimeout(close, 120));
    inputEl.addEventListener('keydown', event => {
      if (!suggestions.length) return;
      if (event.key === 'ArrowDown') activeIndex = Math.min(suggestions.length - 1, activeIndex + 1);
      else if (event.key === 'ArrowUp') activeIndex = Math.max(0, activeIndex - 1);
      else if (event.key === 'Home') activeIndex = 0;
      else if (event.key === 'End') activeIndex = suggestions.length - 1;
      else if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        apply(suggestions[activeIndex]);
        return;
      } else if (event.key === 'Escape') {
        close();
        return;
      } else return;
      event.preventDefault();
      redraw();
    });
  }

  return { wire };
}
