/**
 * Minimal element builder for the vanilla-DOM HUD.
 *
 *   h('div', { class: 'panel', onClick: fn }, 'text', childEl)
 *
 * Props: `class`, `dataset`, `style` (object), `html` (trusted static markup
 * only, e.g. inline SVG icons), `on<Event>` listeners, anything else becomes an
 * attribute. `null`, `undefined` and `false` props/children are skipped.
 *
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v); // custom properties need setProperty
        else el.style[/** @type {any} */ (prop)] = v;
      }
    }
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/**
 * Panel header in the technical-manual style: `01 / GESTURES ........ META`.
 * @param {string} num
 * @param {string} name
 * @param {string | Node} [meta]
 */
export function panelHead(num, name, meta) {
  return h(
    'header',
    { class: 'panel__head label' },
    h('span', { class: 'panel__num' }, num),
    h('span', { class: 'panel__sep' }, '/'),
    h('span', { class: 'panel__name' }, name),
    meta != null && h('span', { class: 'panel__meta' }, meta),
  );
}
