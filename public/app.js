// aicoach frontend — vanilla ES modules, no build step, no framework.

const app = document.getElementById('app');
const tooltip = document.getElementById('tooltip');

// ---------------------------------------------------------------- utilities

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(3)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (v, dp = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(dp));
const sgn = (v, dp = 0) => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(dp));

function showTooltip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.classList.add('show');
  const pad = 14;
  const r = tooltip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}
function hideTooltip() {
  tooltip.classList.remove('show');
}

// ------------------------------------------------------- minimal markdown

/** Renders the subset this app generates: h1-h3, tables, lists, bold, italic. */
function markdown(md) {
  const lines = String(md || '').split('\n');
  let out = '';
  let i = 0;
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }

    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out += '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      out += rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('');
      out += '</tbody></table>';
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      out += '<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>';
      continue;
    }

    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|\s*\||\s*[-*]\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out += `<p>${inline(para.join(' '))}</p>`;
  }
  return out;
}

// ------------------------------------------------------------------ charts

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids.flat(2)) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

function legend(items) {
  return el(
    'div.legend',
    {},
    items.map((it) =>
      el('span.item', {}, el('span.swatch', { style: `background:${it.color}` }), it.label)
    )
  );
}

/** Round axis bounds to a 1/2/5 × 10^n step so ticks read as whole numbers. */
function niceScale(min, max, targetTicks = 4) {
  const span = Math.max(max - min, 1);
  const raw = span / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

/**
 * Fitness chart: CTL, ATL and TSB share one y-axis (all in TSS units — TSB is
 * literally CTL−ATL, so a second axis would be a lie). Direct labels at the
 * right edge carry identity alongside the legend.
 */
function fitnessChart(series, { height = 220 } = {}) {
  if (!series.length) return el('p.muted', {}, 'No fitness data yet — sync from intervals.icu.');
  const W = 900;
  const H = height;
  const m = { top: 12, right: 54, bottom: 22, left: 34 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const vals = series.flatMap((d) => [d.ctl, d.atl, d.tsb]).filter((v) => v != null);
  const scale = niceScale(Math.min(0, ...vals), Math.max(...vals, 10), 4);
  const y = (v) => m.top + ih - ((v - scale.lo) / (scale.hi - scale.lo)) * ih;
  const x = (i) => m.left + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);

  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img' });
  const gridG = s('g');
  for (let v = scale.lo; v <= scale.hi + 1e-9; v += scale.step) {
    const yy = y(v);
    gridG.append(s('line', { x1: m.left, x2: W - m.right, y1: yy, y2: yy, stroke: 'var(--grid)', 'stroke-width': 1 }));
    gridG.append(
      s('text', { x: m.left - 6, y: yy + 3.5, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted)' }, Math.round(v))
    );
  }
  if (scale.lo < 0) {
    gridG.append(s('line', { x1: m.left, x2: W - m.right, y1: y(0), y2: y(0), stroke: 'var(--axis)', 'stroke-width': 1 }));
  }
  svg.append(gridG);

  const defs = [
    { key: 'ctl', label: 'CTL (fitness)', color: 'var(--series-1)' },
    { key: 'atl', label: 'ATL (fatigue)', color: 'var(--series-2)' },
    { key: 'tsb', label: 'TSB (form)', color: 'var(--series-3)' },
  ];
  for (const d of defs) {
    const pts = series.map((row, i) => (row[d.key] == null ? null : `${x(i)},${y(row[d.key])}`)).filter(Boolean);
    if (!pts.length) continue;
    svg.append(s('polyline', { points: pts.join(' '), fill: 'none', stroke: d.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = series[series.length - 1];
    if (last[d.key] != null) {
      svg.append(
        s('text', { x: W - m.right + 6, y: y(last[d.key]) + 3.5, 'font-size': 11, 'font-weight': 600, fill: d.color }, Math.round(last[d.key]))
      );
    }
  }

  // x labels: first, middle, last
  for (const idx of [0, Math.floor(series.length / 2), series.length - 1]) {
    if (!series[idx]) continue;
    svg.append(
      s('text', {
        x: Math.min(Math.max(x(idx), m.left + 16), W - m.right - 16),
        y: H - 6, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)',
      }, series[idx].date.slice(5))
    );
  }

  // crosshair + tooltip
  const cross = s('line', { y1: m.top, y2: m.top + ih, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0 });
  svg.append(cross);
  const hit = s('rect', { x: m.left, y: m.top, width: iw, height: ih, fill: 'transparent' });
  hit.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - m.left) / iw) * (series.length - 1));
    const row = series[Math.max(0, Math.min(series.length - 1, i))];
    if (!row) return;
    cross.setAttribute('x1', x(series.indexOf(row)));
    cross.setAttribute('x2', x(series.indexOf(row)));
    cross.setAttribute('opacity', 1);
    showTooltip(
      e,
      `<b>${row.date}</b><br>CTL ${fmt(row.ctl, 1)} · ATL ${fmt(row.atl, 1)}<br>TSB ${sgn(row.tsb, 1)} · load ${fmt(row.load, 0)}`
    );
  });
  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('opacity', 0);
    hideTooltip();
  });
  svg.append(hit);

  return el('div', {}, legend(defs.map((d) => ({ label: d.label, color: d.color }))), el('div.chart-wrap', {}, svg));
}

function roundedTop(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, Math.max(0, h));
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Planned vs actual weekly TSS. Grouped bars, 2px surface gap, 4px rounded tops. */
function plannedActualChart(weeks, { height = 200 } = {}) {
  if (!weeks.length) return el('p.muted', {}, 'No weeks to compare yet.');
  const W = 900;
  const H = height;
  const m = { top: 12, right: 12, bottom: 26, left: 38 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const maxV = Math.max(10, ...weeks.flatMap((w) => [w.planned?.tss || 0, w.actual?.tss || 0])) * 1.1;
  const y = (v) => m.top + ih - (v / maxV) * ih;
  const bandW = iw / weeks.length;
  const barW = Math.max(4, (bandW - 8) / 2 - 1); // 2px gap between the pair

  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img' });
  for (let t = 0; t <= 4; t++) {
    const v = (maxV * t) / 4;
    svg.append(s('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    svg.append(s('text', { x: m.left - 6, y: y(v) + 3.5, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted)' }, Math.round(v)));
  }
  svg.append(s('line', { x1: m.left, x2: W - m.right, y1: y(0), y2: y(0), stroke: 'var(--axis)', 'stroke-width': 1 }));

  weeks.forEach((w, i) => {
    const x0 = m.left + i * bandW + 4;
    const p = w.planned?.tss || 0;
    const a = w.actual?.tss || 0;
    const mk = (val, xx, color, label) => {
      if (val <= 0) return;
      const path = s('path', { d: roundedTop(xx, y(val), barW, y(0) - y(val), 4), fill: color });
      path.addEventListener('mousemove', (e) =>
        showTooltip(
          e,
          `<b>Week of ${w.weekStart}</b><br>${label}: ${Math.round(val)} TSS` +
            (w.planned ? `<br>planned ${Math.round(w.planned.tss || 0)} · actual ${Math.round(w.actual?.tss || 0)}` : '') +
            (w.comparison?.tssPct != null ? ` (${w.comparison.tssPct}%)` : '') +
            (w.planned?.phase ? `<br>${w.planned.phase}${w.planned.is_recovery ? ' · recovery' : ''}` : '')
        )
      );
      path.addEventListener('mouseleave', hideTooltip);
      svg.append(path);
    };
    mk(p, x0, 'var(--series-1)', 'Planned');
    mk(a, x0 + barW + 2, 'var(--series-2)', 'Actual');
    if (i % Math.ceil(weeks.length / 8) === 0) {
      svg.append(
        s('text', { x: x0 + barW, y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, w.weekStart.slice(5))
      );
    }
  });

  return el(
    'div',
    {},
    legend([{ label: 'Planned TSS', color: 'var(--series-1)' }, { label: 'Actual TSS', color: 'var(--series-2)' }]),
    el('div.chart-wrap', {}, svg)
  );
}

// ------------------------------------------------------------------- views

const views = {};

views['/brief'] = async () => {
  const [status, brief, readiness] = await Promise.all([api('/api/status'), api('/api/brief'), api('/api/readiness')]);
  const root = el('div');

  if (status.jobFailures?.length) root.append(jobFailuresBanner(status.jobFailures));
  if (!status.hasApiKey) root.append(setupNotice());
  if (!status.goal) {
    root.append(
      el('div.notice', {}, 'No active goal yet. ', el('a', { href: '#/goals' }, 'Create one'), ' to get a periodized plan.')
    );
  }

  const readinessEl = readinessCard(readiness);
  if (readinessEl) root.append(readinessEl);

  const m = brief.metrics || {};
  root.append(
    el(
      'div.tiles',
      {},
      tile('Form (TSB)', sgn(m.tsb, 0), tsbNote(m.tsb), 'accent-3'),
      tile('Fitness (CTL)', fmt(m.ctl, 1), m.ramp == null ? '' : `ramp ${sgn(m.ramp, 1)}/wk`, 'accent-1'),
      tile('Fatigue (ATL)', fmt(m.atl, 1), '', 'accent-2'),
      tile(
        'EF trend',
        m.ef?.reliable ? `${sgn(m.ef.changePct, 1)}%` : '—',
        m.ef?.reliable ? `${fmt(m.ef.recent, 3)} vs ${fmt(m.ef.baseline, 3)}` : 'not enough matched rides'
      ),
      tile('Days to event', m.daysToEvent == null ? '—' : m.daysToEvent, status.goal?.name || '')
    )
  );

  root.append(
    el(
      'div.toolbar',
      { style: 'margin-top:16px' },
      el('button', {
        onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Working…';
          try {
            await api('/api/brief/run', { method: 'POST', body: {} });
            render();
          } catch (err) {
            alert(err.message);
            e.target.disabled = false;
            e.target.textContent = 'Regenerate plan + brief';
          }
        },
      }, 'Regenerate plan + brief'),
      el('span.muted', {}, brief.generated_at || brief.generatedAt ? `generated ${(brief.generated_at || brief.generatedAt).slice(0, 16).replace('T', ' ')}` : '')
    )
  );

  if (brief.actions?.length) {
    root.append(
      el('div.card', {}, el('h3', {}, 'Do this week'), el('ul', {}, brief.actions.map((a) => el('li', {}, a))))
    );
  }

  if (brief.flags?.length) {
    const shown = brief.flags.filter((f) => f.severity !== 'good');
    if (shown.length) {
      root.append(
        el(
          'div',
          {},
          el('h2', {}, 'Flags'),
          shown.map((f) =>
            el(
              `div.flag.${f.severity}`,
              {},
              el('span.icon', {}, f.severity === 'critical' ? '🔴' : f.severity === 'warn' ? '🟠' : '🔵'),
              el(
                'div',
                {},
                el('div.title', {}, f.title),
                el('div', {}, f.text),
                f.framework && f.framework !== 'monitoring' ? el('div.fw', {}, `framework: ${f.framework}`) : null
              )
            )
          )
        )
      );
    }
  }

  root.append(el('div.card.brief', { html: markdown(brief.body || brief.body_md || '') }));

  const hist = await api('/api/briefs?limit=20');
  if (hist.length > 1) {
    root.append(
      el(
        'details',
        { class: 'card' },
        el('summary', {}, `Previous briefs (${hist.length - 1})`),
        el(
          'div',
          { style: 'margin-top:10px' },
          hist.slice(1).map((b) =>
            el(
              'details',
              { style: 'margin-bottom:8px' },
              el('summary', {}, `${b.week_start} — ${b.headline}`),
              el('div.brief', { style: 'margin-top:8px', html: markdown(b.body_md) })
            )
          )
        )
      )
    );
  }
  return root;
};

function tsbNote(tsb) {
  if (tsb == null) return '';
  if (tsb <= -30) return 'deep fatigue';
  if (tsb <= -20) return 'high fatigue';
  if (tsb <= -10) return 'productive load';
  if (tsb < 5) return 'neutral';
  if (tsb < 20) return 'fresh';
  return 'detraining risk';
}

function tile(label, value, sub, cls = '') {
  return el(`div.tile${cls ? '.' + cls : ''}`, {}, el('div.label', {}, label), el('div.value', {}, value), sub ? el('div.sub', {}, sub) : null);
}

const SUBJECTIVE_LABELS = {
  soreness: 'Soreness', fatigue: 'Fatigue', stress: 'Stress', mood: 'Mood',
  motivation: 'Motivation', injury: 'Injury', readiness: 'Readiness (intervals.icu)',
};

/** Today's HRV/resting-HR/sleep check, quiet when there's no recent wellness
 * sync to read (see server/readiness.js for why the subjective 1-4/1-5
 * fields are shown as logged rather than scored). */
function readinessCard(r) {
  if (!r?.hasData) return null;
  const stats = [];
  if (r.hrv != null) stats.push(`HRV ${fmt(r.hrv, 0)}`);
  if (r.restingHr != null) stats.push(`Resting HR ${fmt(r.restingHr, 0)}`);
  if (r.sleepHours != null) stats.push(`Sleep ${fmt(r.sleepHours, 1)}h`);

  const subjParts = r.subjective
    ? Object.entries(r.subjective)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${SUBJECTIVE_LABELS[k] || k} ${v}`)
    : [];

  return el(
    'div.card',
    {},
    el('h3', {}, `Today — ${r.date}`),
    el('p', { style: 'font-size:16px' }, r.headline),
    stats.length ? el('p.muted', {}, stats.join(' · ')) : null,
    r.flags.length
      ? el(
          'div',
          {},
          r.flags.map((f) =>
            el(
              `div.flag.${f.severity}`,
              {},
              el('span.icon', {}, f.severity === 'critical' ? '🔴' : f.severity === 'warn' ? '🟠' : f.severity === 'good' ? '🟢' : '🔵'),
              el('div', {}, el('div.title', {}, f.title), el('div', {}, f.text))
            )
          )
        )
      : null,
    subjParts.length
      ? el('p.muted', { style: 'margin-top:8px' }, `Logged: ${subjParts.join(' · ')} — self-rated in intervals.icu, shown as logged rather than scored.`)
      : null
  );
}

/** The coach's explanation of the whole arc — why the plan is shaped this way, not just what the numbers are. */
function explainPlan(plan, params) {
  const counts = {};
  for (const w of plan.weeks) counts[w.phase] = (counts[w.phase] || 0) + 1;
  const baseWeeks = (counts.prep || 0) + (counts.base1 || 0) + (counts.base2 || 0) + (counts.base3 || 0);
  const buildWeeks = (counts.build1 || 0) + (counts.build2 || 0) + (counts.peak || 0);
  const taperWeeks = counts.taper || 0;
  const cls = params.demand.class;
  const clsLabel = { sprint: 'a short, high-intensity', middle: 'a middle-distance', long: 'a long', ultra: 'an ultra-distance' }[cls] || 'this';

  let s = `This is built around ${clsLabel} event: roughly ${fmt(params.demand.hours, 1)}h and ${fmt(params.demand.eventTss, 0)} TSS on the day. `;
  s += `${baseWeeks} weeks of base come first — that's where the aerobic engine actually gets built, before anything specific to the event is layered on. `;
  s += `Then ${buildWeeks} weeks of build and peak, where the work gets progressively more event-specific`;
  s += (cls === 'ultra' || cls === 'long') ? ' — for an event this long, "specific" mostly means duration and back-to-back days, not more intervals. ' : '. ';
  s += `${taperWeeks} week${taperWeeks === 1 ? '' : 's'} of taper bring${taperWeeks === 1 ? 's' : ''} you to the start line rested without losing sharpness.`;

  const gapPct = params.targets?.targetCtl ? ((params.targets.targetCtl - params.targets.achievableCtl) / params.targets.targetCtl) * 100 : 0;
  if (gapPct > 20) {
    s += ` My honest read: this runway is too short for this goal. The event profile wants peak fitness (CTL) around ${fmt(params.targets.targetCtl, 0)}; from where you're starting, this plan tops out around ${fmt(params.targets.achievableCtl, 0)} — a ${fmt(gapPct, 0)}% gap that more base weeks alone won't close without more time. Pick one, deliberately, now: push the event back, cut what you're asking of it (a shorter cut of the route, a slower target), or go in accepting a fitness the plan can actually deliver. Any of those is fine — finding this out in week three of build, when the gap is harder to argue with, isn't.`;
  } else if (gapPct > 8) {
    s += ` One real caveat: the event profile justifies a peak fitness (CTL) around ${fmt(params.targets.targetCtl, 0)}, and this plan gets you to about ${fmt(params.targets.achievableCtl, 0)} in the time available. That's close enough to run with, but don't pace race day off the course's best-case demands — pace it off the fitness this block will actually hand you, and treat anything better as a bonus.`;
  } else {
    s += ` This runway comfortably covers what the event asks for — CTL ${fmt(params.targets?.achievableCtl, 0)} against a target of ${fmt(params.targets?.targetCtl, 0)}. The fitness isn't the risk here; compliance is. Show up for the base weeks as written and the rest takes care of itself.`;
  }
  return s;
}

const JOB_LABELS = { sync: 'Background sync', weekly: 'Weekly replan/brief', cron: 'Scheduled job' };

function jobFailuresBanner(failures) {
  if (!failures?.length) return null;
  return el(
    'div',
    {},
    failures.map((f) =>
      el(
        'div.notice.error',
        {},
        `${JOB_LABELS[f.job] || f.job} failed at ${(f.occurred_at || '').slice(0, 16).replace('T', ' ')}: ${f.message || 'unknown error'}`
      )
    )
  );
}

function setupNotice() {
  return el(
    'div.notice',
    {},
    'No intervals.icu API key yet — the app has no data to work from. ',
    el('a', { href: '#/settings' }, 'Add it in Settings'),
    ' (intervals.icu → Settings → Developer → API Key).'
  );
}

// A goal with no target_metric/target_value never gets a reachability note in
// the first place (checkTargetMetric stays silent without one) — and until
// now there was no way to add one after creation, since the "Use {value}"
// button on a note only appears once a target already exists. This is the
// only entry point for that first target.
function missingTargetPrompt(goal) {
  if (goal.target_metric) return null;
  const metric = el('input', { type: 'text', placeholder: 'ftp', style: 'width:100px' });
  const value = el('input', { type: 'number', placeholder: '260', style: 'width:100px' });
  const out = el('span.muted', {});
  return el(
    'div.notice',
    {},
    'No target set for this goal — add one to get a reachability check against the fitness this plan builds. ',
    el('span', { style: 'display:inline-flex;gap:6px;align-items:center;margin-top:6px' },
      metric, value,
      el('button.ghost', {
        onclick: async (e) => {
          if (!metric.value || !value.value) { out.textContent = 'metric and value both required'; return; }
          e.target.disabled = true;
          e.target.textContent = 'Setting…';
          try {
            await api(`/api/goals/${goal.id}`, { method: 'PATCH', body: { target_metric: metric.value, target_value: value.value } });
            await api('/api/plan/regenerate', { method: 'POST', body: { goalId: goal.id, reason: 'target added' } });
            render();
          } catch (err) {
            out.textContent = err.message;
            e.target.disabled = false;
            e.target.textContent = 'Set target';
          }
        },
      }, 'Set target'),
      out
    )
  );
}

// Plan notes can carry a `suggestedValue` (e.g. a projected-FTP figure) that
// the planner already computed — surface it as a one-click adjustment instead
// of making the user re-derive it and edit the goal by hand.
function noticeWithAction(n, goalId) {
  const children = [n.text];
  if (n.suggestedValue != null && goalId) {
    children.push(
      ' ',
      el('button.ghost', {
        onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Updating…';
          try {
            await api(`/api/goals/${goalId}`, { method: 'PATCH', body: { target_value: n.suggestedValue } });
            await api('/api/plan/regenerate', { method: 'POST', body: { goalId, reason: 'target adjusted from suggestion' } });
            render();
          } catch (err) {
            alert(err.message);
            e.target.disabled = false;
            e.target.textContent = `Use ${n.suggestedValue}`;
          }
        },
      }, `Use ${n.suggestedValue}`)
    );
  }
  return el('div.notice', {}, ...children);
}

views['/plan'] = async () => {
  const [plan, weeks, fitness] = await Promise.all([
    api('/api/plan'),
    api('/api/metrics/weeks?n=14'),
    api('/api/metrics/fitness?days=180'),
  ]);
  const root = el('div');
  if (!plan.goal) return el('div.notice', {}, 'No goal yet. ', el('a', { href: '#/goals' }, 'Create one'), '.');

  const p = plan.plan;
  const params = p?.params || {};
  root.append(
    el(
      'div.card',
      {},
      el('h2', {}, plan.goal.name),
      el(
        'p.muted',
        {},
        `${plan.goal.start_date} → ${plan.goal.event_date} · ${plan.weeks.length} weeks · plan v${p?.version} (${p?.reason || ''})`
      ),
      params.demand
        ? el(
            'div.tiles',
            {},
            tile('Est. event duration', `${fmt(params.demand.hours, 1)} h`, params.demand.source),
            tile('Est. event load', `${fmt(params.demand.eventTss, 0)} TSS`, `at IF ${fmt(params.demand.eventIF, 2)}`),
            tile('Target peak CTL', fmt(params.targets?.targetCtl, 0), `plan reaches ${fmt(params.targets?.achievableCtl, 0)}`),
            tile('Peak week', `${fmt(params.targets?.peakWeeklyHours, 1)} h`, `${fmt(params.targets?.peakWeeklyTss, 0)} TSS`),
            tile('Longest session', `${fmt(params.targets?.peakLongHours, 1)} h`, `class: ${params.demand.class}`)
          )
        : null,
      params.demand ? el('p', { style: 'margin-top:12px' }, explainPlan(plan, params)) : null,
      (p?.notes || []).map((n) => noticeWithAction(n, plan.goal.id))
    )
  );
  const targetPrompt = missingTargetPrompt(plan.goal);
  if (targetPrompt) root.append(targetPrompt);

  root.append(el('div.card', {}, el('h3', {}, 'Fitness'), fitnessChart(fitness)));
  root.append(el('div.card', {}, el('h3', {}, 'Planned vs actual weekly TSS'), plannedActualChart(weeks)));

  const cur = plan.weeks.find((w) => w.start_date <= todayStr() && w.end_date >= todayStr());
  const table = el('table.data');
  table.append(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ['Week', 'Phase', 'TSS', 'Actual', 'Hours', 'Z1-2/Z3-4/Z5', 'Long', 'Str', 'CTL'].map((h, i) =>
          el(i >= 2 ? 'th.num' : 'th', {}, h)
        )
      )
    )
  );
  const tb = el('tbody');
  for (const w of plan.weeks) {
    const isNow = cur && w.start_date === cur.start_date;
    const tr = el(`tr${w.is_recovery ? '.recovery' : ''}${isNow ? '.now' : ''}`, {});
    tr.append(el('td', {}, el('div', {}, w.start_date)));
    tr.append(el('td', {}, el('span.phase', {}, w.phase + (w.is_recovery ? ' · rec' : ''))));
    tr.append(el('td.num', {}, fmt(w.target_tss)));
    tr.append(
      el(
        'td.num',
        {},
        w.actual ? fmt(w.actual.tss) : '—',
        w.comparison?.tssPct != null ? el('div.muted', {}, `${w.comparison.tssPct}%`) : null
      )
    );
    tr.append(el('td.num', {}, fmt(w.target_hours, 1)));
    tr.append(el('td.num', {}, `${fmt(w.z1_2_pct)}/${fmt(w.z3_4_pct)}/${fmt(w.z5_pct)}`));
    tr.append(el('td.num', {}, fmt(w.long_session_h, 1)));
    tr.append(el('td.num', {}, w.strength_sessions));
    tr.append(el('td.num', {}, fmt(w.projected_ctl, 0)));
    tr.addEventListener('click', () => {
      const detail = document.getElementById('week-detail');
      detail.replaceChildren(weekDetail(w));
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    tr.style.cursor = 'pointer';
    tb.append(tr);
  }
  table.append(tb);
  root.append(el('div.card', {}, el('h3', {}, 'Weeks'), el('p.muted', {}, 'Click a week for its key sessions and framework calls.'), el('div.chart-wrap', {}, table)));
  root.append(el('div', { id: 'week-detail' }, cur ? weekDetail(cur) : null));
  return root;
};

function weekDetail(w) {
  return el(
    'div.card',
    {},
    el('h3', {}, `Week of ${w.start_date} — ${w.phase}${w.is_recovery ? ' (recovery)' : ''}`),
    el('p', {}, w.focus || ''),
    w.notes ? el('p.muted', {}, w.notes) : null,
    el(
      'ul',
      {},
      (w.key_sessions || []).map((k) => el('li', {}, el('strong', {}, k.name), ' — ', k.detail))
    ),
    (w.governing || []).length
      ? el(
          'div',
          {},
          el('h3', {}, 'Framework calls'),
          (w.governing || []).map((g) =>
            el(
              'div.flag.info',
              {},
              el('span.icon', {}, '⚖️'),
              el(
                'div',
                {},
                el('div.title', {}, `${g.decision} → ${g.framework}`),
                el('div', {}, g.reason),
                g.alternative ? el('div.fw', {}, `Not taken: ${g.alternative}`) : null
              )
            )
          )
        )
      : null
  );
}

views['/log'] = async () => {
  const [acts, dailyLogs, fuelling] = await Promise.all([
    api('/api/activities?days=45'),
    api('/api/daily-logs?days=90'),
    api('/api/metrics/fuelling'),
  ]);
  const root = el('div');
  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'Per-ride log'),
      el(
        'p.muted',
        {},
        'Position and back pain are the two fields the correlation view needs. You can also tag them in the intervals.icu activity description — ',
        el('span.mono', {}, '#drops #pain:mild #rpe:7 #drops:90'),
        ' — and they sync in automatically.'
      )
    )
  );

  const table = el('table.data');
  table.append(
    el(
      'thead',
      {},
      el('tr', {}, ['Date', 'Activity', 'IF', 'VI', 'TSS', 'h', 'Position', 'Back pain', 'RPE', 'Notes', '', ''].map((h) => el('th', {}, h)))
    )
  );
  const tb = el('tbody');
  for (const a of acts) {
    const log = a.log || {};
    const posSel = el(
      'select',
      {},
      ['', 'upright', 'mixed', 'drops'].map((v) => el('option', { value: v, selected: (log.position || '') === v }, v || '—'))
    );
    const painSel = el(
      'select',
      {},
      ['', 'none', 'mild', 'moderate', 'flare'].map((v) => el('option', { value: v, selected: (log.back_pain || '') === v }, v || '—'))
    );
    const rpe = el('input', { type: 'number', min: 1, max: 10, style: 'width:56px', value: log.rpe ?? '' });
    const notes = el('input', { type: 'text', style: 'width:100%;min-width:120px', value: log.notes ?? '' });
    const save = el('button.ghost', {
      onclick: async (e) => {
        e.target.textContent = '…';
        try {
          await api('/api/ride-logs', {
            method: 'POST',
            body: {
              activity_id: a.id,
              date: a.date,
              position: posSel.value || null,
              back_pain: painSel.value || null,
              rpe: rpe.value ? parseInt(rpe.value, 10) : null,
              notes: notes.value || null,
            },
          });
          e.target.textContent = '✓';
        } catch (err) {
          alert(err.message);
          e.target.textContent = 'Save';
        }
      },
    }, 'Save');

    const debriefCell = el('td', { colspan: 12 }, el('span.muted', {}, 'Loading…'));
    const debriefRow = el('tr', { style: 'display:none' }, debriefCell);
    let debriefLoaded = false;
    const debriefBtn = el('button.ghost', {
      onclick: async (e) => {
        const showing = debriefRow.style.display !== 'none';
        if (showing) {
          debriefRow.style.display = 'none';
          return;
        }
        debriefRow.style.display = '';
        if (debriefLoaded) return;
        debriefLoaded = true;
        try {
          const d = await api(`/api/activities/${encodeURIComponent(a.id)}/debrief`);
          debriefCell.replaceChildren(el('div.brief', { html: markdown(d.body) }));
        } catch (err) {
          debriefCell.replaceChildren(el('span.muted', {}, err.message));
        }
      },
    }, 'Debrief');

    tb.append(
      el(
        'tr',
        {},
        el('td', {}, a.date),
        el('td', {}, el('div', {}, a.name || a.type), el('span.phase', {}, a.type || '')),
        el('td.num', {}, fmt(a.intensity, 2)),
        el('td.num', {}, fmt(a.vi, 2)),
        el('td.num', {}, fmt(a.tss, 0)),
        el('td.num', {}, fmt((a.moving_time || 0) / 3600, 1)),
        el('td', {}, posSel),
        el('td', {}, painSel),
        el('td', {}, rpe),
        el('td', {}, notes),
        el('td', {}, save),
        el('td', {}, debriefBtn)
      ),
      debriefRow
    );
  }
  table.append(tb);
  root.append(el('div.card', {}, el('div.chart-wrap', {}, table)));

  // Optional intake logging — feeds the low-energy-availability screen and
  // the protein-target flag below.
  const dateInput = el('input', { type: 'date', value: todayStr() });
  const kcal = el('input', { type: 'number', style: 'width:100px' });
  const prot = el('input', { type: 'number', style: 'width:100px' });
  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'Optional daily log'),
      el('p.muted', {}, 'Entirely optional. The plan works without any of it. Logging intake switches on the low-energy-availability screen.'),
      el(
        'div.row',
        {},
        el('div', {}, el('label', {}, 'Date'), dateInput),
        el('div', {}, el('label', {}, 'Intake (kcal)'), kcal),
        el('div', {}, el('label', {}, 'Protein (g)'), prot),
        el(
          'div',
          {},
          el('button', {
            onclick: async () => {
              await api('/api/daily-logs', {
                method: 'POST',
                body: {
                  date: dateInput.value,
                  intake_kcal: kcal.value || null,
                  protein_g: prot.value || null,
                },
              });
              render();
            },
          }, 'Save day')
        )
      ),
      fuellingCard(fuelling)
    )
  );

  if (dailyLogs.length) {
    const t = el('table.data');
    t.append(el('thead', {}, el('tr', {}, ['Date', 'Intake (kcal)', 'Protein (g)', 'Notes'].map((h) => el('th', {}, h)))));
    const tbody = el(
      'tbody',
      {},
      dailyLogs.map((d) =>
        el(
          'tr',
          {},
          el('td', {}, d.date),
          el('td.num', {}, d.intake_kcal ?? '—'),
          el('td.num', {}, d.protein_g ?? '—'),
          el('td.muted', {}, d.notes || d.symptoms || '')
        )
      )
    );
    t.append(tbody);
    root.append(el('div.card', {}, el('h3', {}, 'Logged days'), el('div.chart-wrap', {}, t)));
  }
  return root;
};

/** The rolling numbers behind the protein/RED-S flags, and whether either is
 * currently firing — so "have I logged enough to trigger advice" has a
 * direct answer instead of only showing up buried in the weekly brief. */
function fuellingCard(f) {
  const stats = [];
  if (f.intakeN) stats.push(`Intake ${fmt(f.intakeMean, 0)} kcal/day (${f.intakeN} days logged)`);
  if (f.proteinN) stats.push(`Protein ${fmt(f.proteinMean, 0)} g/day${f.proteinTarget ? ` vs ${f.proteinTarget} g target` : ''} (${f.proteinN} days logged)`);
  if (!stats.length) {
    return el('p.muted', { style: 'margin-top:10px' }, 'Nothing logged yet in the last 28 days — the protein and low-energy-availability checks need at least 5 logged days to say anything.');
  }
  return el(
    'div',
    { style: 'margin-top:10px' },
    el('p.muted', {}, stats.join(' · ')),
    f.flags.length
      ? f.flags.map((flag) =>
          el(
            `div.flag.${flag.severity}`,
            {},
            el('span.icon', {}, flag.severity === 'critical' ? '🔴' : flag.severity === 'warn' ? '🟠' : '🔵'),
            el('div', {}, el('div.title', {}, flag.title), el('div', {}, flag.text))
          )
        )
      : el('p.muted', {}, 'Not triggering the protein or low-energy-availability checks right now.')
  );
}

views['/pain'] = async () => {
  const root = el('div');
  const sevSel = el('select', {}, [
    el('option', { value: 'moderate' }, 'moderate or worse'),
    el('option', { value: 'mild' }, 'any pain (mild+)'),
  ]);
  const ifInput = el('input', { type: 'number', step: '0.01', style: 'width:90px', value: '0.80' });
  const daysInput = el('input', { type: 'number', style: 'width:90px', value: '365' });
  const body = el('div');

  async function load() {
    body.replaceChildren(el('p.muted', {}, 'Loading…'));
    const c = await api(`/api/backpain?days=${daysInput.value}&severity=${sevSel.value}&highIf=${ifInput.value}`);
    const out = el('div');
    out.append(el('div.card', {}, el('h3', {}, 'Pattern'), el('p', { style: 'font-size:16px;line-height:1.6' }, c.headline)));

    const mk = (band, title) => {
      const t = el('table.data');
      t.append(el('thead', {}, el('tr', {}, ['Position', 'Rides', 'Pain', 'Rate', 'Mean IF', 'Mean VI', 'Mean h'].map((h, i) => el(i ? 'th.num' : 'th', {}, h)))));
      const tb = el('tbody');
      for (const r of band.byPosition) {
        tb.append(
          el(
            'tr',
            {},
            el('td', {}, el(`span.pill.pos-${r.position}`, {}, r.position)),
            el('td.num', {}, r.rides),
            el('td.num', {}, r.painRides),
            el('td.num', {}, r.painRatePct == null ? '—' : `${r.painRatePct}%`),
            el('td.num', {}, fmt(r.meanIf, 2)),
            el('td.num', {}, fmt(r.meanVi, 2)),
            el('td.num', {}, fmt(r.meanHours, 1))
          )
        );
      }
      t.append(tb);
      return el('div', {}, el('h3', {}, title), el('div.chart-wrap', {}, t));
    };
    out.append(
      el(
        'div.card',
        {},
        mk(c.table.highIf, `High intensity — IF ≥ ${c.ifThreshold} (${c.table.highIf.n} rides)`),
        mk(c.table.lowIf, `Lower intensity — IF < ${c.ifThreshold} (${c.table.lowIf.n} rides)`)
      )
    );

    const dc = c.durationControl;
    out.append(
      el(
        'div.card',
        {},
        el('h3', {}, 'Controls'),
        el(
          'ul',
          {},
          dc.enough
            ? el(
                'li',
                {},
                `Distance: rides split at ${dc.splitHours}h. Longer half (mean ${dc.longer.meanHours}h): ${dc.longer.painRides}/${dc.longer.rides} pain (${dc.longer.painRatePct}%). Shorter half (mean ${dc.shorter.meanHours}h): ${dc.shorter.painRides}/${dc.shorter.rides} (${dc.shorter.painRatePct}%).`
              )
            : el('li.muted', {}, `Distance control needs more logged rides (${dc.n || 0} so far).`),
          c.vi.nPain && c.vi.nNoPain
            ? el('li', {}, `Variability index: ${fmt(c.vi.meanViWithPain, 3)} on pain rides (n=${c.vi.nPain}) vs ${fmt(c.vi.meanViWithoutPain, 3)} on pain-free rides (n=${c.vi.nNoPain}).`)
            : el('li.muted', {}, 'VI comparison needs pain and pain-free rides with power data.'),
          c.drops.nPain || c.drops.nNoPain
            ? el('li', {}, `Time in drops (where logged): ${fmt(c.drops.meanMinutesWithPain, 0)} min on pain rides (n=${c.drops.nPain}) vs ${fmt(c.drops.meanMinutesWithoutPain, 0)} min without (n=${c.drops.nNoPain}).`)
            : el('li.muted', {}, 'No time-in-drops logged yet — add #drops:90 to a ride description or fill the field in the log.')
        ),
        el('p.muted', {}, `${c.totalLogged} rides have both a position and a pain entry; ${c.totalWithPain} recorded pain.`)
      )
    );

    const t = el('table.data');
    t.append(el('thead', {}, el('tr', {}, ['Date', 'Ride', 'IF', 'VI', 'h', 'Position', 'Pain'].map((h) => el('th', {}, h)))));
    const tb = el('tbody');
    for (const r of c.rides) {
      tb.append(
        el(
          'tr',
          {},
          el('td', {}, r.date),
          el('td', {}, r.name || ''),
          el('td.num', {}, fmt(r.intensity, 2)),
          el('td.num', {}, fmt(r.vi, 2)),
          el('td.num', {}, fmt((r.moving_time || 0) / 3600, 1)),
          el('td', {}, r.position ? el(`span.pill.pos-${r.position}`, {}, r.position) : '—'),
          el('td', {}, r.back_pain ? el(`span.pill.pain-${r.back_pain}`, {}, r.back_pain) : '—')
        )
      );
    }
    t.append(tb);
    out.append(el('div.card', {}, el('h3', {}, 'Logged rides'), el('div.chart-wrap', {}, t)));
    body.replaceChildren(out);
  }

  for (const c of [sevSel, ifInput, daysInput]) c.addEventListener('change', load);
  root.append(
    el(
      'div.toolbar',
      {},
      el('div', {}, el('label', {}, 'Count as pain'), sevSel),
      el('div', {}, el('label', {}, 'High-IF threshold'), ifInput),
      el('div', {}, el('label', {}, 'Lookback (days)'), daysInput)
    )
  );
  root.append(body);
  load();
  return root;
};

views['/goals'] = async () => {
  const goals = await api('/api/goals');
  const root = el('div');

  const f = {
    name: el('input', { type: 'text', placeholder: 'Bright Midnight ultra' }),
    sport: el('select', {}, ['Ride', 'Run', 'BackcountrySki', 'Hike', 'Other'].map((v) => el('option', { value: v }, v))),
    kind: el('select', {}, [el('option', { value: 'event' }, 'event'), el('option', { value: 'metric' }, 'metric target')]),
    event_date: el('input', { type: 'date' }),
    start_date: el('input', { type: 'date', value: todayStr() }),
    distance_km: el('input', { type: 'number', step: '1', placeholder: '1100' }),
    elevation_m: el('input', { type: 'number', step: '10', placeholder: '20000' }),
    est_duration_h: el('input', { type: 'number', step: '0.5', placeholder: 'auto' }),
    support: el('select', {}, [el('option', { value: 'supported' }, 'supported'), el('option', { value: 'self-supported' }, 'self-supported')]),
    target_metric: el('input', { type: 'text', placeholder: 'ftp' }),
    target_value: el('input', { type: 'number', placeholder: '260' }),
    notes: el('textarea', {}),
  };
  const preview = el('p.muted', {}, '');
  async function updatePreview() {
    if (!f.distance_km.value && !f.elevation_m.value && !f.est_duration_h.value) return preview.replaceChildren();
    try {
      const p = await api('/api/goals/preview', {
        method: 'POST',
        body: {
          sport: f.sport.value, distance_km: f.distance_km.value, elevation_m: f.elevation_m.value,
          est_duration_h: f.est_duration_h.value, support: f.support.value, kind: f.kind.value,
        },
      });
      preview.replaceChildren(
        document.createTextNode(
          `Estimated moving time ${p.demand.hours} h (${p.demand.source}${p.demand.speedKmh ? `, ${p.demand.speedKmh} km/h` : ''}${p.demand.climbPerKm ? `, ${p.demand.climbPerKm} m/km` : ''}) → ${p.class} event.` +
            (p.demand.elapsedHours ? ` Elapsed with stops ≈ ${p.demand.elapsedHours} h.` : '')
        )
      );
    } catch { /* preview is best-effort */ }
  }
  for (const k of ['distance_km', 'elevation_m', 'est_duration_h', 'sport', 'support']) f[k].addEventListener('change', updatePreview);

  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'New goal'),
      el('div.row', {}, el('div', { style: 'flex:2 1 260px' }, el('label', {}, 'Name'), f.name), el('div', {}, el('label', {}, 'Type'), f.kind), el('div', {}, el('label', {}, 'Sport'), f.sport)),
      el('div.row', {}, el('div', {}, el('label', {}, 'Event date'), f.event_date), el('div', {}, el('label', {}, 'Plan starts'), f.start_date), el('div', {}, el('label', {}, 'Support'), f.support)),
      el('div.row', {}, el('div', {}, el('label', {}, 'Distance (km)'), f.distance_km), el('div', {}, el('label', {}, 'Climbing (m)'), f.elevation_m), el('div', {}, el('label', {}, 'Duration override (h)'), f.est_duration_h)),
      el('div.row', {}, el('div', {}, el('label', {}, 'Target metric'), f.target_metric), el('div', {}, el('label', {}, 'Target value'), f.target_value)),
      el(
        'p.muted',
        { style: 'margin-top:4px' },
        'Optional, and separate from "Type" above — set both to have the plan check whether this target is reachable given the fitness it builds (currently checked for ftp/power). Works for either goal type; leave blank for no check.'
      ),
      el('div', { style: 'margin-top:8px' }, el('label', {}, 'Notes'), f.notes),
      preview,
      el(
        'div',
        { style: 'margin-top:10px' },
        el('button', {
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              const body = Object.fromEntries(Object.entries(f).map(([k, node]) => [k, node.value]));
              await api('/api/goals', { method: 'POST', body });
              location.hash = '#/plan';
              render();
            } catch (err) {
              alert(err.message);
              e.target.disabled = false;
            }
          },
        }, 'Create goal + generate plan')
      )
    )
  );

  if (goals.length) {
    const t = el('table.data');
    t.append(el('thead', {}, el('tr', {}, ['Goal', 'Date', 'Sport', 'Distance', 'Climb', 'Status', ''].map((h) => el('th', {}, h)))));
    const tb = el('tbody');
    for (const g of goals) {
      tb.append(
        el(
          'tr',
          {},
          el('td', {}, g.name),
          el('td', {}, g.event_date),
          el('td', {}, g.sport),
          el('td.num', {}, g.distance_km ? `${g.distance_km} km` : '—'),
          el('td.num', {}, g.elevation_m ? `${g.elevation_m} m` : '—'),
          el('td', {}, g.status),
          el(
            'td',
            {},
            el('button.ghost', {
              onclick: async () => {
                await api(`/api/goals/${g.id}`, { method: 'PATCH', body: { status: g.status === 'active' ? 'archived' : 'active' } });
                render();
              },
            }, g.status === 'active' ? 'Archive' : 'Reactivate')
          )
        )
      );
    }
    t.append(tb);
    root.append(el('div.card', {}, el('h3', {}, 'Goals'), el('div.chart-wrap', {}, t)));
  }
  return root;
};

views['/settings'] = async () => {
  const status = await api('/api/status');
  const s = status.settings;
  const root = el('div');
  if (status.jobFailures?.length) root.append(jobFailuresBanner(status.jobFailures));

  const key = el('input', { type: 'password', placeholder: status.hasApiKey ? '•••••••• (stored)' : 'paste API key', style: 'width:100%' });
  const athleteId = el('input', { type: 'text', value: s.intervals_athlete_id || '0', style: 'width:120px' });
  const testOut = el('span.muted', {});

  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'intervals.icu'),
      el('p.muted', {}, 'intervals.icu → Settings → Developer Settings → API Key. It is stored in the local SQLite file and only ever sent to intervals.icu.'),
      el('div', {}, el('label', {}, 'API key'), key),
      el(
        'div.row',
        { style: 'margin-top:10px' },
        el('div', { style: 'flex:0 0 auto' }, el('label', {}, 'Athlete ID'), athleteId),
        el(
          'div',
          { style: 'flex:0 0 auto' },
          el('button', {
            onclick: async () => {
              try {
                await api('/api/settings', { method: 'POST', body: { intervals_api_key: key.value, intervals_athlete_id: athleteId.value } });
                const r = await api('/api/settings/test', { method: 'POST', body: {} });
                testOut.textContent = `✓ connected as ${r.name || r.id} (FTP ${r.ftp ?? '—'}, ${r.weight ?? '—'} kg)`;
              } catch (e) {
                testOut.textContent = `✗ ${e.message}`;
              }
            },
          }, 'Save + test')
        ),
        el('div', {}, testOut)
      )
    )
  );

  const a = status.athlete || {};
  const af = {
    ftp: el('input', { type: 'number', value: a.ftp ?? '' }),
    weight_kg: el('input', { type: 'number', step: '0.1', value: a.weight_kg ?? '' }),
    max_hr: el('input', { type: 'number', value: a.max_hr ?? '' }),
    threshold_hr: el('input', { type: 'number', value: a.threshold_hr ?? '' }),
    age: el('input', { type: 'number', value: a.age ?? '' }),
  };
  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'Athlete'),
      el('p.muted', {}, 'Synced from intervals.icu, overridable here. FTP drives the wattage numbers quoted in briefs; weight drives the protein target.'),
      el(
        'div.row',
        {},
        el('div', {}, el('label', {}, 'FTP (W)'), af.ftp),
        el('div', {}, el('label', {}, 'Weight (kg)'), af.weight_kg),
        el('div', {}, el('label', {}, 'Max HR'), af.max_hr),
        el('div', {}, el('label', {}, 'Threshold HR'), af.threshold_hr),
        el('div', {}, el('label', {}, 'Age'), af.age)
      ),
      el('div', { style: 'margin-top:10px' }, el('button', {
        onclick: async () => {
          const body = {};
          for (const [k, node] of Object.entries(af)) body[k] = node.value === '' ? null : parseFloat(node.value);
          await api('/api/athlete', { method: 'POST', body });
          render();
        },
      }, 'Save athlete'))
    )
  );

  const opts = {
    load_pattern: el('select', {}, [el('option', { value: '3:1' }, '3:1 (3 load + 1 recovery)'), el('option', { value: '2:1' }, '2:1 (2 load + 1 recovery)')]),
    max_ramp_base: el('input', { type: 'number', step: '0.5', value: s.max_ramp_base }),
    max_ramp_build: el('input', { type: 'number', step: '0.5', value: s.max_ramp_build }),
    max_weekly_hours: el('input', { type: 'number', step: '0.5', value: s.max_weekly_hours ?? '' }),
    high_if_threshold: el('input', { type: 'number', step: '0.01', value: s.high_if_threshold }),
    auto_sync_hours: el('input', { type: 'number', step: '1', value: s.auto_sync_hours }),
    sync_days_back: el('input', { type: 'number', step: '10', value: s.sync_days_back }),
    auto_replan_enabled: el('select', {}, [el('option', { value: '1' }, 'on'), el('option', { value: '0' }, 'off')]),
  };
  opts.load_pattern.value = s.load_pattern;
  opts.auto_replan_enabled.value = s.auto_replan_enabled;

  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'Planning'),
      el(
        'div.row',
        {},
        el('div', {}, el('label', {}, 'Loading pattern'), opts.load_pattern),
        el('div', {}, el('label', {}, 'Max ramp, base (CTL/wk)'), opts.max_ramp_base),
        el('div', {}, el('label', {}, 'Max ramp, build'), opts.max_ramp_build),
        el('div', {}, el('label', {}, 'Max weekly hours'), opts.max_weekly_hours)
      ),
      el(
        'div.row',
        { style: 'margin-top:10px' },
        el('div', {}, el('label', {}, 'High-IF threshold (pain view)'), opts.high_if_threshold),
        el('div', {}, el('label', {}, 'Auto-sync every (h)'), opts.auto_sync_hours),
        el('div', {}, el('label', {}, 'Sync history (days)'), opts.sync_days_back),
        el('div', {}, el('label', {}, 'Weekly auto-replan'), opts.auto_replan_enabled)
      ),
      el('div', { style: 'margin-top:10px' }, el('button', {
        onclick: async () => {
          const body = {};
          for (const [k, node] of Object.entries(opts)) body[k] = node.value;
          await api('/api/settings', { method: 'POST', body });
          render();
        },
      }, 'Save settings'))
    )
  );

  const hist = await api('/api/sync/history');
  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'Sync history'),
      el('p.muted', {}, `${status.counts.activities} activities, ${status.counts.rideLogs} ride logs, ${status.counts.briefs} briefs stored.`),
      el(
        'table.data',
        {},
        el('thead', {}, el('tr', {}, ['When', 'OK', 'Activities', 'Wellness', 'Message'].map((h) => el('th', {}, h)))),
        el(
          'tbody',
          {},
          hist.map((r) =>
            el(
              'tr',
              {},
              el('td', {}, (r.finished_at || '').slice(0, 16).replace('T', ' ')),
              el('td', {}, r.ok ? '✓' : '✗'),
              el('td.num', {}, r.activities),
              el('td.num', {}, r.wellness),
              el('td.muted', {}, r.message || '')
            )
          )
        )
      )
    )
  );

  const exportOut = el('span.muted', {});
  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'Data export'),
      el('p.muted', {}, 'The database (Turso) has no separate backup — download a full JSON snapshot of your data periodically.'),
      el(
        'div',
        {},
        el('button', {
          onclick: async (e) => {
            e.target.disabled = true;
            exportOut.textContent = 'Preparing…';
            try {
              const res = await fetch('/api/export');
              if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `aicoach-export-${todayStr()}.json`;
              document.body.append(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              exportOut.textContent = '✓ downloaded';
            } catch (err) {
              exportOut.textContent = `✗ ${err.message}`;
            } finally {
              e.target.disabled = false;
            }
          },
        }, 'Download export (JSON)'),
        ' ',
        exportOut
      )
    )
  );

  root.append(
    el(
      'div.card',
      {},
      el('h3', {}, 'Session'),
      el(
        'button',
        {
          onclick: async () => {
            await fetch('/api/logout', { method: 'POST' }).catch(() => {});
            location.href = '/login.html';
          },
        },
        'Sign out'
      )
    )
  );
  return root;
};

// ------------------------------------------------------------------ router

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function render() {
  const hash = location.hash || '#/brief';
  const path = hash.slice(1);
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.getAttribute('href') === hash);
  const view = views[path] || views['/brief'];
  app.replaceChildren(el('p.muted', {}, 'Loading…'));
  try {
    app.replaceChildren(await view());
  } catch (e) {
    app.replaceChildren(el('div.notice.error', {}, e.message));
  }
  refreshStatusLine();
}

async function refreshStatusLine() {
  try {
    const st = await api('/api/status');
    const line = document.getElementById('status-line');
    const last = st.lastSync?.finished_at ? st.lastSync.finished_at.slice(0, 16).replace('T', ' ') : 'never';
    line.textContent = `CTL ${fmt(st.fitness.ctl, 1)} · TSB ${sgn(st.fitness.tsb, 1)} · synced ${last}`;
  } catch { /* header is decorative */ }
}

document.getElementById('sync-btn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Syncing…';
  try {
    const r = await api('/api/sync', { method: 'POST', body: {} });
    e.target.textContent = `${r.activities} acts`;
  } catch (err) {
    alert(err.message);
  } finally {
    setTimeout(() => {
      e.target.disabled = false;
      e.target.textContent = 'Sync';
    }, 1500);
    render();
  }
});

window.addEventListener('hashchange', render);
render();
