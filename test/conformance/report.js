'use strict';

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { SUITES, REFERENCE, readRecording, startOffline, judge } = require('./suite');

const USAGE = `Usage: npm run conformance:report -- [--live] [--against <target>] [--only <id>,<id>] [--out <file>]

Compares every recorded case with SheLLM and prints the differences as Markdown.
  --live     judge recorded/shellm/ (a real SheLLM with real CLIs) instead of the offline fake
  --against  judge the OpenAI format against another recording, e.g. anthropic-openai`;

const cell = (v) => String(v).replaceAll('|', '\\|').replaceAll('\n', ' ');

function section(kase, result) {
  if (result.note) return `### ${kase.id} — ${kase.title}\n\n${result.note}\n`;
  const { diffs, blocking } = result;
  const verdict = blocking.length ? `**${blocking.length} to triage**` : 'conforms';
  const lines = [`### ${kase.id} — ${kase.title}`, '', verdict, ''];
  if (diffs.length) {
    lines.push('| | Kind | Path | Reference | SheLLM | Accepted because |', '|---|---|---|---|---|---|');
    for (const d of diffs) {
      const mark = d.blocking ? '✗' : d.accepted ? '✓' : '·';
      lines.push(`| ${mark} | ${d.kind} | \`${cell(d.path)}\` | ${cell(d.reference)} | ${cell(d.actual)} | ${cell(d.accepted || '')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: { live: { type: 'boolean' }, against: { type: 'string' }, only: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) return console.log(USAGE);
  const only = values.only ? new Set(values.only.split(',')) : null;
  const offline = values.live ? null : await startOffline();
  const out = ['# Conformance report', '', `SheLLM: ${values.live ? 'recorded/shellm/ (live)' : 'offline, fake claude'} · ${new Date().toISOString()}`, ''];
  let triage = 0;
  let compared = 0;

  try {
    for (const { api, CASES, ACCEPTED } of SUITES) {
      const referenceTarget = api === 'openai' && values.against ? values.against : REFERENCE[api];
      out.push(`## ${api} format against recorded/${referenceTarget}/`, '');
      for (const kase of CASES.filter((c) => !only || only.has(c.id))) {
        const reference = readRecording(referenceTarget, kase.id);
        const actualRecording = values.live ? readRecording('shellm', kase.id) : undefined;
        let result;
        if (!reference) result = { note: '_Not recorded._' };
        else if (values.live && !actualRecording) result = { note: '_No live SheLLM recording._' };
        else {
          result = await judge({ api, kase, accepted: ACCEPTED, reference, actualTarget: offline?.target, actualRecording });
          compared++;
          triage += result.blocking.length;
        }
        out.push(section(kase, result));
      }
    }
  } finally {
    if (offline) await offline.stop();
  }

  out.splice(3, 0, `${compared} cases compared, ${triage} differences to triage. ✗ to triage · ✓ accepted · · extra field SheLLM sends`, '');
  const markdown = out.join('\n');
  if (values.out) fs.writeFileSync(values.out, markdown);
  else console.log(markdown);
}

main();
