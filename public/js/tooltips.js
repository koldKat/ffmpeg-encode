// Display shared themed hints for static and dynamically rendered dashboard controls.
export function initTooltips(root = document) {
  const doc = root.ownerDocument || root;
  const tip = doc.createElement('div');
  tip.id = 'dashboard-tooltip';
  tip.className = 'dashboard-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  tip.hidden = true;
  doc.body.append(tip);
  let target = null, timer = null;

  function hide() {
    clearTimeout(timer);
    timer = null;
    if (target) {
      const ids = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tip.id);
      if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
      else target.removeAttribute('aria-describedby');
    }
    target = null;
    if (tip.hidePopover && tip.matches(':popover-open')) tip.hidePopover();
    tip.hidden = true;
  }

  function show() {
    if (!target?.isConnected || !target.getClientRects().length) return hide();
    const text = target.dataset.tooltip;
    if (!text) return hide();
    const host = target.closest('dialog') || doc.body;
    if (tip.parentNode !== host) host.append(tip);
    tip.textContent = text;
    tip.hidden = false;
    if (tip.showPopover && !tip.matches(':popover-open')) tip.showPopover();
    const ids = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(tip.id);
    target.setAttribute('aria-describedby', [...ids].join(' '));
    const rect = target.getBoundingClientRect(), bounds = tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, innerWidth - bounds.width - 8));
    const below = rect.bottom + 7;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, below + bounds.height <= innerHeight - 8 ? below : rect.top - bounds.height - 7)}px`;
  }

  function schedule(next, immediate = false) {
    if (next === target) return;
    hide();
    if (!next) return;
    target = next;
    timer = setTimeout(show, immediate ? 0 : 350);
  }

  root.addEventListener('pointerover', event => schedule(event.target.closest?.('[data-tooltip]')));
  root.addEventListener('pointerout', event => {
    if (target && !target.contains(event.relatedTarget)) hide();
  });
  root.addEventListener('focusin', event => schedule(event.target.closest?.('[data-tooltip]'), true));
  root.addEventListener('focusout', hide);
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, true);
  doc.addEventListener('close', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  new MutationObserver(() => { if (target && !target.isConnected) hide(); })
    .observe(doc.body, { childList: true, subtree: true });
}
