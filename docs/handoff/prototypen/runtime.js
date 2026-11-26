// Mini-Laufzeit für die exportierten Mockups (Teilmenge des .dc.html-Formats):
// {{holes}}, <template data-k="for|if">, Events (onClick, onChange, onPointer*), setState mit Re-Render.
(function () {
  const EVENTS = { onclick: 'click', onchange: 'input', onpointerdown: 'pointerdown', onpointermove: 'pointermove', onpointerup: 'pointerup', onpointerleave: 'pointerleave' };
  window.DCLogic = class {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(upd) {
      const patch = typeof upd === 'function' ? upd(this.state) : upd;
      if (!patch || patch === this.state) return;
      this.state = Object.assign({}, this.state, patch);
      this.__schedule && this.__schedule();
    }
    forceUpdate() { this.__schedule && this.__schedule(); }
  };
  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const p of path.split('.')) { if (v == null) return undefined; v = v[p]; }
    return v;
  }
  const RAW = /^\s*\{\{([^}]+)\}\}\s*$/;
  const attrVal = (str, scope) => { const m = str.match(RAW); if (m) return lookup(m[1], scope); return str.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); }); };
  const textVal = (str, scope) => str.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); });
  function process(node, scope, out, path) {
    if (node.nodeType === 3) { out.push(document.createTextNode(textVal(node.textContent, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'template') {
      const kind = node.getAttribute('data-k'), kids = Array.from(node.content.childNodes);
      if (kind === 'for') {
        const list = lookup(node.getAttribute('list').replace(/[{}]/g, ''), scope) || [];
        const as = node.getAttribute('as');
        list.forEach((item, i) => { const s = Object.create(scope); s[as] = item; s.$index = i; kids.forEach((k, j) => process(k, s, out, path + '.' + i + '_' + j)); });
      } else if (lookup(node.getAttribute('value').replace(/[{}]/g, ''), scope)) kids.forEach((k, j) => process(k, scope, out, path + '.' + j));
      return;
    }
    if (tag === 'dc-import') return;
    const el = node.cloneNode(false);
    el.setAttribute('data-dck', path);
    let value, checked;
    for (const a of Array.from(node.attributes)) {
      const n = a.name;
      if (n.startsWith('hint-')) { el.removeAttribute(n); continue; }
      const v = attrVal(a.value, scope);
      if (/^on/i.test(n)) { el.removeAttribute(n); const ev = EVENTS[n.toLowerCase()]; if (ev && typeof v === 'function') el.addEventListener(tag === 'select' && ev === 'input' ? 'change' : ev, v); continue; }
      if (n === 'value') { value = v; if (tag === 'textarea') { el.removeAttribute(n); continue; } }
      if (n === 'checked') checked = v;
      if (n === 'href' && typeof v === 'string' && v.endsWith('.dc.html')) { el.setAttribute('href', v.replace(/\.dc\.html$/, '.html')); continue; }
      if (v === false || v == null) el.removeAttribute(n);
      else if (v === true) el.setAttribute(n, '');
      else el.setAttribute(n, String(v));
    }
    Array.from(node.childNodes).forEach((k, j) => { const o = []; process(k, scope, o, path + '/' + j); o.forEach(x => el.appendChild(x)); });
    if (value !== undefined && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = value == null ? '' : String(value);
    if (checked !== undefined) el.checked = checked === true || checked === 'true';
    out.push(el);
  }
  window.mountDC = function (tpl, code) {
    const Component = new Function(code + '\n;return Component;')();
    const c = new Component({});
    const t = document.createElement('template');
    t.innerHTML = tpl;
    const root = document.getElementById('root');
    let queued = false;
    const render = () => {
      queued = false;
      const a = document.activeElement, key = a && a.getAttribute && a.getAttribute('data-dck');
      const sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
      const vals = c.renderVals();
      const frag = document.createDocumentFragment();
      Array.from(t.content.childNodes).forEach((k, j) => { const o = []; process(k, vals, o, 'r' + j); o.forEach(x => frag.appendChild(x)); });
      root.replaceChildren(frag);
      if (key) { const n = root.querySelector('[data-dck="' + key + '"]'); if (n) { n.focus(); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
    };
    c.__schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };
    render();
    if (c.componentDidMount) c.componentDidMount();
  };
})();
