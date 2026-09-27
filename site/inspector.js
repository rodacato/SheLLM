'use strict';

// Plays site/inspector.json, which test/site/inspector.test.js produces by running each request
// through the app. This file only decides the order and the pace; it never writes content.
(async () => {
  const root = document.getElementById('inside');
  if (!root) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel) => root.querySelector(sel);
  const out = (name) => root.querySelector(`[data-out="${name}"]`);
  const node = (name) => root.querySelector(`[data-node="${name}"]`);
  const rig = $('.rig');
  const svg = $('.rig svg');
  const packet = $('.packet');

  let data;
  try {
    data = await (await fetch('inspector.json')).json();
  } catch {
    root.querySelector('.ins-foot p').textContent = 'The recorded requests could not be loaded.';
    return;
  }

  // Prose the data cannot carry. Every figure in it is either in the scenario or measured in
  // docs/guides/benchmarks.md.
  const NOTES = {
    'openai-stream': 'The CLI\'s stream-json events become OpenAI chunks as they arrive. Measured on the server: the CLI starts in about 0.9 s, and claude-sonnet\'s first words reach the app at 1.7 s of 5.8 s. Played here at an illustrative pace.',
    'anthropic-stream': 'The same argv and the same CLI events as the OpenAI request; only the translation differs. message_start leaves before the CLI has started. opus[1m] is the 1M-context variant, used by default wherever the account has one.',
    'codex-schema': 'The schema goes to a file in the temp dir and reaches codex as --output-schema. codex reports tokens but no cost, so the log says not priced. The 13,563 input tokens for a one-line prompt are mostly codex\'s own instructions. Measured: 4.5 s median.',
    'tools-refused': 'No CLI starts. SheLLM answers with text only, so a request carrying tools gets the 400 an SDK can handle instead of prose its code cannot parse.',
  };
  const CLAUDE_COST = ' The $0.44 comes from a recording made before ADR-0002 switched the CLI\'s tools off; most of it is context the CLI no longer loads.';

  const esc = (text) => String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const json = (value) => esc(JSON.stringify(value));
  // Short objects and arrays stay on one line, so a schema reads like the code that sent it.
  function inline(value) {
    if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value).map(([k, v]) => `<span class="k">${json(k)}</span>: ${inline(v)}`).join(', ')}}`;
    }
    return typeof value === 'string' ? `<span class="s">${json(value)}</span>` : json(value);
  }
  function pretty(value, indent = '') {
    if (value === null || typeof value !== 'object' || JSON.stringify(value).length <= 44) return inline(value);
    const inner = indent + '  ';
    const parts = Array.isArray(value)
      ? value.map((v) => inner + pretty(v, inner))
      : Object.entries(value).map(([k, v]) => `${inner}<span class="k">${json(k)}</span>: ${pretty(v, inner)}`);
    const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
    return `${open}\n${parts.join(',\n')}\n${indent}${close}`;
  }

  // --- Compact views of each line: the kind in colour, then the part that changed ----------------

  function cliLine(event) {
    if (event.type === 'stream_event') {
      const e = event.event;
      const tail = e.delta?.type === 'text_delta' ? json(e.delta.text)
        : e.type === 'message_delta' ? json({ stop_reason: e.delta.stop_reason })
          : e.type === 'message_start' ? json({ model: e.message.model }) : '';
      return { html: `<span class="k">${e.type}</span> ${tail}`, text: e.delta?.type === 'text_delta' };
    }
    if (event.type === 'result') {
      return { html: `<span class="k">result</span> ${json({ subtype: event.subtype, output_tokens: event.usage.output_tokens, total_cost_usd: +event.total_cost_usd.toFixed(2) })}` };
    }
    if (event.type === 'item.completed') return { html: `<span class="k">item.completed</span> ${json(event.item.text)}`, text: true };
    if (event.type === 'turn.completed') return { html: `<span class="k">turn.completed</span> ${json({ input_tokens: event.usage.input_tokens, output_tokens: event.usage.output_tokens })}` };
    return { html: `<span class="k">${esc(event.type)}</span>` };
  }

  function sseLine(item, api) {
    if (item.data === '[DONE]') return `<span class="m">data:</span> [DONE]`;
    if (api === 'openai') {
      const choice = item.data.choices[0];
      const shown = choice.finish_reason ? { delta: choice.delta, finish_reason: choice.finish_reason } : { delta: choice.delta };
      return `<span class="m">data:</span> ${json(shown)}`;
    }
    const d = item.data;
    const tail = d.delta?.text !== undefined ? json({ text: d.delta.text })
      : d.delta?.stop_reason ? json({ stop_reason: d.delta.stop_reason }) : '';
    return `<span class="k">${esc(item.event)}</span> ${tail}`;
  }

  // Which CLI event each response line waits for: -1 is before the CLI starts, Infinity after it ends.
  function triggers(scenario) {
    const sse = scenario.response.sse;
    if (!sse) return [Infinity];
    const textEvents = scenario.events.map((e, i) => (cliLine(e).text ? i : -1)).filter((i) => i >= 0);
    const firstOf = (type) => scenario.events.findIndex((e) => e.event?.type === type);
    let text = 0;
    return sse.map((item) => {
      if (scenario.api === 'openai') {
        if (item.data === '[DONE]' || item.data.choices[0].finish_reason) return Infinity;
        if (item.data.choices[0].delta.content !== undefined) return textEvents[text++];
        return firstOf('message_start');
      }
      if (item.event === 'message_start') return -1;
      if (item.event === 'content_block_delta') return textEvents[text++];
      if (item.event === 'content_block_start' || item.event === 'content_block_stop') return firstOf(item.event);
      return Infinity;
    });
  }

  // --- The rig: paths between nodes, and a packet that travels them ------------------------------

  function centre(el, side) {
    const r = el.getBoundingClientRect();
    const o = rig.getBoundingClientRect();
    const x = side === 'left' ? r.left - o.left : side === 'right' ? r.right - o.left : r.left - o.left + r.width / 2;
    return { x, y: r.top - o.top + r.height / 2 };
  }

  const LINKS = [['openai', 'core'], ['anthropic', 'core'], ['core', 'claude'], ['core', 'codex']];
  function drawPaths() {
    svg.innerHTML = LINKS.map(([from, to]) => {
      const a = centre(node(from), 'right');
      const b = centre(node(to), 'left');
      const mid = (a.x + b.x) / 2;
      return `<path data-link="${from}-${to}" d="M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}"/>`;
    }).join('');
  }

  function travel(from, to, { back = false, fail = false } = {}) {
    if (still || getComputedStyle(packet).display === 'none') return;
    const a = back ? centre(node(to), 'left') : centre(node(from), 'right');
    const b = back ? centre(node(from), 'right') : centre(node(to), 'left');
    packet.classList.toggle('fail', fail);
    packet.animate([
      { transform: `translate(${a.x}px,${a.y}px)`, opacity: 1 },
      { transform: `translate(${b.x}px,${b.y}px)`, opacity: 1, offset: 0.92 },
      { transform: `translate(${b.x}px,${b.y}px)`, opacity: 0 },
    ], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)' });
  }

  // --- Playing a scenario -------------------------------------------------------------------------

  let timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, still ? 0 : ms));

  function reset(scenario) {
    timers.forEach(clearTimeout);
    timers = [];
    root.querySelectorAll('.node').forEach((n) => n.classList.remove('on', 'fail'));
    root.querySelectorAll('.core li').forEach((li) => li.classList.remove('ok', 'fail'));
    svg.querySelectorAll('path').forEach((p) => p.classList.remove('hot', 'fail'));
    out('log').classList.remove('in');

    const r = scenario.request;
    out('route').textContent = `${r.method} ${r.path}`;
    const headers = Object.entries(r.headers).map(([k, v]) => `<span class="m">${esc(k)}: ${esc(v)}</span>`).join('\n');
    out('request').innerHTML = `${headers}\n\n${pretty(r.body)}`;
    out('argv').innerHTML = scenario.argv ? '' : '<span class="m">nothing — the request was refused before a CLI was started</span>';
    out('cwd').textContent = scenario.argv ? 'cwd /tmp/shellm-XXXXXX, empty' : '';
    out('format').textContent = scenario.engine === 'claude' ? 'stream-json, abridged' : scenario.engine === 'codex' ? '--json, abridged' : '';
    out('status').textContent = '';
    out('events').innerHTML = scenario.events.map((e) => `<li>${cliLine(e).html}</li>`).join('') || '<li class="m">nothing — no CLI was started</li>';
    const lines = scenario.response.sse
      ? scenario.response.sse.map((item) => `<li>${sseLine(item, scenario.api)}</li>`)
      : pretty(scenario.response.json).split('\n').map((line) => `<li class="wrap">${line}</li>`);
    out('response').innerHTML = lines.join('');
    out('log').innerHTML = logCells(scenario.log).map(([k, v]) => `<div><em>${k}</em>${v}</div>`).join('');
    out('note').textContent = NOTES[scenario.id] + (scenario.engine === 'claude' ? CLAUDE_COST : '');
  }

  function logCells(log) {
    const cost = log.status >= 400 ? '—' : log.cost_usd === null ? 'not priced' : `$${log.cost_usd.toFixed(2)}`;
    return [
      ['key', esc(log.client_name)],
      ['route', esc(log.path)],
      ['provider', log.provider ? esc(log.provider) : '—'],
      ['status', log.status >= 400 ? `<span class="x">${log.status}</span>` : `<span class="s">${log.status}</span>`],
      ['streamed', log.streamed ? 'yes' : 'no'],
      ['tokens in · out', log.tokens_in === null ? '—' : `${log.tokens_in.toLocaleString('en')} · ${log.tokens_out}`],
      ['cost', cost],
      ['error', log.error_code ? `<span class="x">${esc(log.error_code)}</span>` : '—'],
    ];
  }

  function argvLines(argv) {
    const quote = (t) => (t === '' || /[{}"\s]/.test(t) ? `'${t}'` : t);
    const lines = [];
    let i = 0;
    lines.push(`<span class="m">$</span> ${esc(argv[0])} ${esc(argv[1])}`);
    for (i = 2; i < argv.length; i++) {
      const flag = argv[i];
      const next = argv[i + 1];
      const takesValue = flag.startsWith('-') && next !== undefined && !next.startsWith('-');
      const value = takesValue ? ` ${esc(quote(next))}` : '';
      const hot = /\[1m\]/.test(next || '') || flag === '--tools' || flag === '--output-schema';
      const line = `<span class="flag">${esc(flag)}</span>${value}`;
      lines.push(`  ${hot ? `<span class="hl">${line}</span>` : line}`);
      if (takesValue) i++;
    }
    return lines;
  }

  function play(scenario) {
    reset(scenario);
    const api = scenario.api;
    const refused = !scenario.engine;
    const steps = [...root.querySelectorAll('.core li')];
    const light = (name, cls = 'ok') => steps.find((li) => li.dataset.step === name).classList.add(cls);
    const link = (name, cls = 'hot') => svg.querySelector(`[data-link="${name}"]`)?.classList.add(...cls.split(' '));
    const eventLis = [...out('events').children];
    const responseLis = [...out('response').children];
    const show = (li) => { li.classList.add('in', 'flash'); };
    const when = triggers(scenario);

    at(0, () => { node(api).classList.add('on'); link(`${api}-core`); travel(api, 'core'); });
    at(500, () => { node('core').classList.add('on'); light('key'); });

    if (refused) {
      at(750, () => {
        light('fields', 'fail');
        node('core').classList.add('fail');
        svg.querySelector(`[data-link="${api}-core"]`).classList.add('fail');
        travel(api, 'core', { back: true, fail: true });
      });
      at(1300, () => {
        out('status').textContent = String(scenario.status);
        responseLis.forEach(show);
        eventLis.forEach((li) => li.classList.add('in'));
      });
      at(1800, () => out('log').classList.add('in'));
      return;
    }

    at(750, () => light('fields'));
    at(1000, () => light('route'));
    at(1250, () => light('queue'));
    // The Anthropic format sends message_start before the CLI exists.
    responseLis.forEach((li, i) => { if (when[i] === -1) at(1350, () => show(li)); });

    const argv = argvLines(scenario.argv);
    const spawnAt = 1500;
    argv.forEach((line, i) => at(spawnAt + i * 70, () => {
      out('argv').innerHTML = argv.slice(0, i + 1).join('\n') + (i < argv.length - 1 ? '<span class="caret"></span>' : '');
    }));
    const spawned = spawnAt + argv.length * 70;
    at(spawned, () => {
      light('spawn');
      link(`core-${scenario.engine}`);
      travel('core', scenario.engine);
    });
    at(spawned + 450, () => node(scenario.engine).classList.add('on'));

    const first = spawned + 700;
    const gap = 380;
    let firstText = true;
    eventLis.forEach((li, i) => at(first + i * gap, () => {
      show(li);
      if (cliLine(scenario.events[i]).text && firstText) {
        firstText = false;
        light('translate');
        travel('core', scenario.engine, { back: true });
      }
      responseLis.forEach((r, j) => { if (when[j] === i) at(150, () => show(r)); });
    }));
    const done = first + eventLis.length * gap;
    at(done, () => {
      if (firstText) light('translate');
      responseLis.forEach((r, j) => { if (when[j] === Infinity || when[j] === undefined) show(r); });
      out('status').textContent = String(scenario.status);
      travel(api, 'core', { back: true });
    });
    at(done + 500, () => out('log').classList.add('in'));
  }

  // --- The picker ---------------------------------------------------------------------------------

  const picker = $('.ins-picker');
  picker.innerHTML = data.scenarios.map((s, i) => `<button type="button" role="tab" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-id="${s.id}">${esc(s.label)}</button>`).join('');
  const tabs = [...picker.children];
  let current = data.scenarios[0];

  function choose(tab, focus) {
    tabs.forEach((t) => { const on = t === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    if (focus) tab.focus();
    current = data.scenarios.find((s) => s.id === tab.dataset.id);
    play(current);
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => choose(tab));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) choose(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });
  $('.ins-replay').addEventListener('click', () => play(current));

  drawPaths();
  addEventListener('resize', drawPaths);
  reset(current);

  const watch = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    watch.disconnect();
    play(current);
  }, { threshold: .35 });
  watch.observe(rig);
})();
