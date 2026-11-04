#!/usr/bin/env node
/**
 * Jev 1.13 (System One, opencode-go) come consulente per le decisioni.
 * Stesso protocollo del plugin opencode `jev-decisions-v2`: domande predicate /
 * choice / score tradotte in sonde "noul" e probabilita' 0-1.
 *
 * Uso:
 *   node scripts/jev-decide.mjs --state "contesto" \
 *     --predicate "nome:la frase da valutare" \
 *     --choice "nome:testo:opzione A|opzione B" \
 *     --score "nome:testo:basso|medio|alto"
 *   node scripts/jev-decide.mjs --questions decisioni.json   # array di {type,name,instructions,choices|levels}
 *
 * Credenziali: OPENCODE_API_KEY, altrimenti la connessione `opencode-go` in
 * ~/.pi/agent/auth.json. Modello/endpoint sovrascrivibili con JEV_MODEL e
 * JEV_ENDPOINT. Se Jev non risponde lo script esce 1: l'agente decide da solo e
 * lo dichiara (fail-open, come il plugin).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENDPOINT = process.env.JEV_ENDPOINT || 'https://opencode.ai/inference/systemone/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-1.13-free';
const TIMEOUT_MS = Number.parseInt(process.env.JEV_TIMEOUT_MS || '20000', 10) || 20000;

function token() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY.trim();
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pi', 'agent', 'auth.json'), 'utf8'));
    return String(auth?.['opencode-go']?.key || '').trim();
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const questions = [];
  let state = '';
  let file = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? '';
    if (arg === '--state') state = next();
    else if (arg === '--questions') file = next();
    else if (arg === '--predicate') {
      const [name, ...rest] = next().split(':');
      questions.push({ type: 'predicate', name, instructions: rest.join(':') });
    } else if (arg === '--choice') {
      const [name, instructions, options = ''] = next().split(':');
      questions.push({ type: 'choice', name, instructions, choices: options.split('|').filter(Boolean).map((value) => ({ value })) });
    } else if (arg === '--score') {
      const [name, instructions, levels = ''] = next().split(':');
      questions.push({ type: 'score', name, instructions, levels: levels.split('|').filter(Boolean).map((label) => ({ label })) });
    } else if (arg === '--help' || arg === '-h') {
      console.log('vedi intestazione del file per l uso');
      process.exit(0);
    } else {
      throw new Error(`opzione sconosciuta: ${arg}`);
    }
  }
  if (file) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    questions.push(...(Array.isArray(parsed) ? parsed : parsed.questions || []));
    state = state || parsed.state || '';
  }
  if (!state) state = fs.readFileSync(0, 'utf8').trim();
  if (!questions.length) throw new Error('nessuna domanda: usa --predicate/--choice/--score o --questions');
  return { state, questions };
}

/** Una sonda "noul" per domanda: predicate = 1, choice = una per opzione, score = una per livello oltre il primo. */
function probes(questions) {
  const out = {};
  for (const q of questions) {
    if (q.type === 'predicate') out[`${q.name}__p`] = { type: 'noul', instructions: q.instructions };
    else if (q.type === 'choice') {
      (q.choices || []).forEach((choice, index) => {
        out[`${q.name}__c${index}`] = { type: 'noul', instructions: `${q.instructions} La risposta corretta è "${choice.value}"${choice.description ? ` (${choice.description})` : ''}?` };
      });
    } else {
      (q.levels || []).forEach((level, index) => {
        if (index === 0) return;
        out[`${q.name}__s${index}`] = { type: 'noul', instructions: `${q.instructions} Il valore è almeno "${level.label}"${level.description ? ` (${level.description})` : ''}?` };
      });
    }
  }
  return out;
}

function resolve(questions, probs) {
  const answers = {};
  for (const q of questions) {
    if (q.type === 'predicate') {
      const probability = probs[`${q.name}__p`] ?? 0.5;
      answers[q.name] = { type: 'predicate', value: probability >= 0.5, probability };
    } else if (q.type === 'choice') {
      const ranked = (q.choices || [])
        .map((choice, index) => ({ value: choice.value, probability: probs[`${q.name}__c${index}`] ?? 0 }))
        .sort((a, b) => b.probability - a.probability);
      answers[q.name] = { type: 'choice', value: ranked[0]?.value, probabilities: ranked };
    } else {
      const levels = q.levels || [];
      let index = 0;
      levels.forEach((_, i) => {
        if (i > 0 && (probs[`${q.name}__s${i}`] ?? 0) >= 0.5) index = i;
      });
      answers[q.name] = { type: 'score', value: levels[index]?.label ?? String(index) };
    }
  }
  return answers;
}

async function main() {
  const { state, questions } = parseArgs(process.argv.slice(2));
  const key = token();
  if (!key) throw new Error('nessuna credenziale: OPENCODE_API_KEY o ~/.pi/agent/auth.json[opencode-go]');
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state, questions: probes(questions) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Jev ${response.status}: ${body.slice(0, 200)}`);
  const parsed = JSON.parse(body);
  const probabilities = {};
  for (const [name, value] of Object.entries(parsed.answers || {})) {
    const raw = value && typeof value === 'object' && 'noul' in value ? value.noul : value;
    const number = Number(raw);
    if (Number.isFinite(number)) probabilities[name] = number;
  }
  console.log(JSON.stringify({ model: parsed.model || MODEL, answers: resolve(questions, probabilities), probabilities }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[jev] ${err?.message || err}`);
    process.exit(1);
  }
);
