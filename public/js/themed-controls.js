// Keep the original inputs/selects as the application's source of values and events.
export function initThemedControls(root = document) {
  const document = root.ownerDocument || root;
  const popup = document.createElement('div');
  popup.id = 'themed-options';
  popup.className = 'themed-options';
  popup.setAttribute('role', 'listbox');
  popup.hidden = true;
  popup.setAttribute('popover', 'manual');
  document.body.append(popup);
  let current = null, options = [], active = -1, serial = 0;

  function close() {
    if (popup.hidePopover && popup.matches(':popover-open')) popup.hidePopover();
    popup.hidden = true;
    current?.control.setAttribute('aria-expanded', 'false');
    current?.control.removeAttribute('aria-activedescendant');
    current = null;
    options = [];
    active = -1;
  }
  function highlight(index) {
    active = index;
    for (const [i, option] of [...popup.children].entries()) {
      option.classList.toggle('is-active', i === active);
      option.setAttribute('aria-selected', String(i === active));
    }
    const option = popup.children[active];
    if (option) {
      current.control.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else current.control.removeAttribute('aria-activedescendant');
  }
  function open(record, filter = '') {
    if (record.source.disabled) return close();
    if (current && current !== record) close();
    current = record;
    const values = record.values();
    const query = filter.trim().toLowerCase();
    options = values.filter(option => !option.disabled && (!query || values.some(item => item.value.toLowerCase() === query) || option.label.toLowerCase().includes(query)));
    if (!options.length) return close();
    popup.replaceChildren(...options.map((option, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'themed-option';
      row.id = `themed-option-${i}`;
      row.setAttribute('role', 'option');
      row.tabIndex = -1;
      row.textContent = option.label;
      row.dataset.index = String(i);
      return row;
    }));
    // Popovers remain above modal dialogs and are not clipped by queue panels.
    if (!popup.showPopover) (record.control.closest('dialog') || document.body).append(popup);
    popup.hidden = false;
    if (popup.showPopover && !popup.matches(':popover-open')) popup.showPopover();
    const rect = record.control.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
    const upward = below < 160 && above > below;
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    popup.style.maxHeight = `${Math.max(32, Math.min(272, upward ? above : below))}px`;
    popup.style.top = upward ? 'auto' : `${rect.bottom + 5}px`;
    popup.style.bottom = upward ? `${window.innerHeight - rect.top + 5}px` : 'auto';
    record.control.setAttribute('aria-expanded', 'true');
    highlight(options.findIndex(option => option.value === record.source.value));
  }
  function choose(index) {
    if (!current || !options[index]) return;
    const record = current, value = options[index].value;
    close();
    record.source.value = value;
    record.sync?.();
    record.source.dispatchEvent(new Event('input', { bubbles: true }));
    record.source.dispatchEvent(new Event('change', { bubbles: true }));
    record.control.focus();
    // A select proxy stays closed after focus; editable inputs may reopen on focus.
    close();
  }
  function bind(record) {
    const { control, source } = record;
    control.setAttribute('role', 'combobox');
    control.setAttribute('aria-controls', popup.id);
    control.setAttribute('aria-haspopup', 'listbox');
    control.setAttribute('aria-expanded', 'false');
    control.addEventListener('keydown', event => {
      if (event.key === 'Escape' && current === record) { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const wasOpen = current === record;
        if (!wasOpen) open(record, record.editable ? source.value : '');
        if (current !== record) return;
        highlight(wasOpen ? (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : active >= 0 ? active : event.key === 'ArrowDown' ? 0 : options.length - 1);
      } else if (!record.editable && (event.key === 'Home' || event.key === 'End')) {
        event.preventDefault(); open(record); highlight(event.key === 'Home' ? 0 : options.length - 1);
      } else if (event.key === 'Enter' && current === record && active >= 0) {
        event.preventDefault(); choose(active);
      } else if (!record.editable && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault(); current === record ? close() : open(record);
      } else if (!record.editable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        record.typed = Date.now() - (record.typedAt || 0) < 700 ? (record.typed || '') + event.key : event.key;
        record.typedAt = Date.now(); open(record);
        const index = options.findIndex(option => option.label.toLowerCase().startsWith(record.typed.toLowerCase()));
        if (index >= 0) highlight(index);
      }
    });
  }
  for (const source of root.querySelectorAll('input[list]')) {
    const list = document.getElementById(source.getAttribute('list'));
    if (!list) continue;
    source.removeAttribute('list');
    source.autocomplete = 'off';
    source.classList.add('themed-combobox');
    source.setAttribute('aria-autocomplete', 'list');
    const record = { source, control: source, editable: true, values: () => [...list.options].map(option => ({ value: option.value, label: option.label || option.value, disabled: option.disabled })) };
    bind(record);
    source.addEventListener('focus', () => open(record, source.value));
    source.addEventListener('click', () => { if (current !== record) open(record, source.value); });
    source.addEventListener('input', () => open(record, source.value));
  }
  for (const source of root.querySelectorAll('select')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'themed-select';
    source.before(wrapper); wrapper.append(source);
    const control = document.createElement('button');
    control.type = 'button'; control.className = 'themed-select-button';
    control.id = `themed-select-${++serial}`;
    control.setAttribute('aria-label', source.getAttribute('aria-label') || source.labels?.[0]?.textContent.trim() || 'Choose an option');
    wrapper.append(control);
    source.classList.add('themed-native-select'); source.tabIndex = -1; source.setAttribute('aria-hidden', 'true');
    const record = { source, control, values: () => [...source.options].map(option => ({ value: option.value, label: option.label || option.textContent, disabled: option.disabled || Boolean(option.closest('optgroup')?.disabled) })) };
    record.sync = () => {
      control.textContent = source.selectedOptions[0]?.label || source.selectedOptions[0]?.textContent || 'Choose an option';
      control.disabled = source.disabled;
      if (current === record) source.disabled ? close() : open(record);
    };
    bind(record); record.sync();
    control.addEventListener('click', () => current === record ? close() : open(record));
    source.addEventListener('change', record.sync);
    source.addEventListener('focus', () => control.focus());
    new MutationObserver(record.sync).observe(source, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label', 'value', 'selected'] });
  }
  popup.addEventListener('mousedown', event => event.preventDefault());
  popup.addEventListener('click', event => { const option = event.target.closest('[data-index]'); if (option) choose(Number(option.dataset.index)); });
  document.addEventListener('pointerdown', event => { if (current && !current.control.contains(event.target) && !popup.contains(event.target)) close(); }, true);
  document.addEventListener('focusin', event => { if (current && event.target !== current.control && !popup.contains(event.target)) close(); });
  window.addEventListener('resize', close);
  window.addEventListener('scroll', event => { if (current && event.target !== popup && !popup.contains(event.target)) close(); }, true);
  document.addEventListener('close', close, true);
}
