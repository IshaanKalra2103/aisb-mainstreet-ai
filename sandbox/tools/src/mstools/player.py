"""The run-through player injected into the site-demo page: a cursor clicks, a customer types, the tool answers.

The page marks its steps with `data-step` (a number, or several: "2 6") and `data-act`:
  click  the cursor moves to it and clicks; it gets class `on`. `data-opens`: adds `open` to <html> and the panel
         (`data-panel`) grows in. `data-clears`: empties every typed field (a Send button).
  type   the cursor moves to it and the customer's words are typed into it letter by letter. `data-text` holds them;
         a field used at several steps holds one text per step, separated by `|`.
  show   it appears (hidden until then). `data-typing`: three typing dots first, then the words stream in.
`window.__mt.seek(t)` draws the page exactly as it is at t seconds, so frames are shot one by one, deterministically.
"""

PLAYER_JS = r"""
(() => {
  const H = document.documentElement, B = document.body;
  const els = [...document.querySelectorAll('[data-step]')];
  const steps = els.flatMap((el) => {
    const nums = el.dataset.step.trim().split(/\s+/).map(Number);
    const texts = (el.dataset.text || '').split('|');
    return nums.map((n, k) => ({ el, n, act: el.dataset.act, text: (texts[k] ?? texts[texts.length - 1] ?? '').trim() }));
  }).sort((a, b) => a.n - b.n);
  const panel = document.querySelector('[data-panel]');
  const css = document.createElement('style');
  css.textContent = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}
#mt-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform-origin:3px 3px}
#mt-ring{position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
  border:3px solid rgba(20,20,20,.45);background:rgba(255,255,255,.35);z-index:2147483646;pointer-events:none;opacity:0}
.mt-typed{color:#1a1a1a!important}
.mt-dots{display:inline-flex;gap:6px;align-items:center;height:1.2em;vertical-align:middle}
.mt-dots i{display:block;width:8px;height:8px;border-radius:50%;background:currentColor}`;
  document.head.append(css);
  const cur = document.createElement('div'); cur.id = 'mt-cursor';
  cur.innerHTML = '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M3 3 L3 28 L9.5 22 L14 32.5 L18.5 30.5 L14 20.5 L23 20.5 Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>';
  const ring = document.createElement('div'); ring.id = 'mt-ring';
  B.append(ring, cur);

  const isField = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  const setText = (el, s) => { if (isField(el)) el.value = s; else el.textContent = s; };
  for (const el of els) {
    el._full = el.textContent.trim().replace(/\s+/g, ' ');
    el._hint = isField(el) ? '' : el.textContent;  // a fake field's placeholder, shown until typing starts
  }
  const ease = (p) => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const charT = (ch) => ch === ' ' ? .085 : /[,.?!]/.test(ch) ? .11 : .055;
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width * .5, r.top + r.height * .5]; };
  const scroll = (el) => { if (el.parentElement) el.parentElement.scrollTop = 1e6; };

  function clearFields() {
    for (const s of steps) if (s.act === 'type') { setText(s.el, s.el._hint); s.el.classList.remove('mt-typed'); }
  }
  function reset() {
    H.classList.remove('open');
    if (panel) { panel.style.opacity = ''; panel.style.transform = ''; }
    clearFields();
    for (const s of steps) {
      s.el.classList.remove('on');
      if (s.act === 'show') { s.el.style.display = 'none'; s.el.style.opacity = ''; s.el.style.transform = ''; setText(s.el, s.el._full); }
    }
  }

  // The timeline, built once after fonts and photos are in: each step's start, length and where the cursor goes.
  const plan = []; let total = 0, start = [1040, 470];
  function build() {
    if (plan.length || !steps.length) return;
    let t = .9, pos = start;
    reset();
    for (const st of steps) {
      const el = st.el, s = { ...st, t0: t, from: pos };
      if (s.act === 'click') {
        s.to = centre(el); s.move = .75; s.press = .18; s.len = s.move + s.press + ('opens' in el.dataset ? .7 : 'clears' in el.dataset ? .12 : .4);
        pos = s.to; el.classList.add('on');
        if ('opens' in el.dataset) H.classList.add('open');
        if ('clears' in el.dataset) clearFields();
      } else if (s.act === 'type') {
        const r = el.getBoundingClientRect(); s.to = [r.left + Math.min(40, r.width * .3), r.top + r.height * .5];
        s.chars = [...s.text]; s.move = .6; s.typing = s.chars.reduce((a, c) => a + charT(c), 0);
        s.len = s.move + s.typing + .35; pos = s.to; setText(el, s.text); el.classList.add('mt-typed');
      } else {
        s.words = el._full.split(' '); s.dots = 'typing' in el.dataset ? 1.1 : 0; s.fade = .25;
        s.len = s.dots + s.words.length * (s.dots ? .06 : 0) + s.fade + (s.dots ? Math.max(1.3, s.words.length * .07) : .5);
        s.to = pos; el.style.display = ''; scroll(el);
      }
      plan.push(s); t += s.len;
    }
    total = t + 2.6;
  }

  let ringAt = [0, 0];
  function seek(time) {
    build(); reset();
    let cpos = start, press = false, ringP = -1, openAt = -1;
    for (const s of plan) {
      const u = time - s.t0; if (u < 0) break;
      const el = s.el, moving = u < (s.move || 0);
      if (s.to) cpos = moving ? s.from.map((a, i) => a + (s.to[i] - a) * ease(u / s.move)) : s.to;
      if (s.act === 'click') {
        if (u >= s.move && u < s.move + s.press) press = true;
        if (u >= s.move + s.press * .5) {
          const since = u - s.move - s.press * .5;
          el.classList.add('on'); ringP = since; ringAt = s.to;
          if ('opens' in el.dataset) { H.classList.add('open'); openAt = since; }
          if ('clears' in el.dataset) clearFields();
        }
      } else if (s.act === 'type') {
        if (!moving) {
          let n = 0, acc = s.move; while (n < s.chars.length && acc + charT(s.chars[n]) <= u) acc += charT(s.chars[n++]);
          const caret = n < s.chars.length && Math.floor(time * 2.4) % 2 === 0 ? '▏' : '';
          setText(el, s.chars.slice(0, n).join('') + caret); el.classList.add('mt-typed');
        }
      } else {
        el.style.display = '';
        const p = clamp(u / s.fade); el.style.opacity = String(p); el.style.transform = `translateY(${(1 - p) * 10}px)`;
        if (s.dots && u < s.dots) {
          const k = Math.floor(time * 6) % 3;
          el.innerHTML = '<span class="mt-dots">' + [0, 1, 2].map((i) => `<i style="opacity:${i === k ? .9 : .3}"></i>`).join('') + '</span>';
        } else if (s.dots) {
          setText(el, s.words.slice(0, Math.min(s.words.length, 1 + Math.floor((u - s.dots) / .06))).join(' '));
        }
        scroll(el);
      }
    }
    if (panel && openAt >= 0) {
      const p = ease(clamp(openAt / .32));
      panel.style.opacity = String(p); panel.style.transformOrigin = 'bottom right';
      panel.style.transform = `translateY(${(1 - p) * 18}px) scale(${.94 + .06 * p})`;
    }
    cur.style.transform = `translate(${cpos[0] - 3}px, ${cpos[1] - 3}px) scale(${press ? .88 : 1})`;
    if (ringP >= 0 && ringP < .45) {
      const p = ringP / .45; ring.style.opacity = String(.9 * (1 - p));
      ring.style.transform = `translate(${ringAt[0]}px, ${ringAt[1]}px) scale(${.45 + p})`;
    } else ring.style.opacity = '0';
  }
  window.__mt = { seek, get total() { build(); return total; }, get steps() { return steps.length; } };
})();
"""
