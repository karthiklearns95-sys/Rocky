import eventBus from '#services/eventBus.js';
import { graphManager } from '#memory/graphManager.js';
import { EVENT_RELATION } from './constants.js';

/**
 * What the passive fact extractor found in the user's message becomes graph facts, vector memories,
 * shared memories (milestones), retired facts and aliases. Runs in the background; never throws.
 */
export function handleExtractedFacts(res, loop) {
  if (!res) return;
  for (const f of res.facts || []) {
    graphManager.upsertFact({
      subject: f.subject, relation: f.relation, object: f.object,
      confidence: f.confidence, subjectType: f.subject_type, objectType: f.object_type,
      source: 'passive_extraction'
    }).catch(() => {});
    loop.userMemory.saveMemory({
      type: 'fact',
      content: `${f.subject} ${f.relation} is ${f.object}`,
      confidence: f.confidence
    });
  }
  // Milestones ("we fixed the login bug") are also kept as shared memories.
  for (const f of res.facts || []) {
    if (f.object_type === 'event' || EVENT_RELATION.test(String(f.relation))) {
      const who = String(f.subject).toLowerCase() === 'user' ? 'Grace' : f.subject;
      graphManager.addEpisode({
        summary: `${who} ${String(f.relation).replace(/_/g, ' ')} ${f.object}`,
        kind: 'milestone', entities: [f.subject, f.object],
      }).catch(() => {});
    }
  }
  // Things the user says are no longer true are kept as history, not deleted.
  for (const f of res.retired || []) {
    graphManager.retireFact(f).catch(() => {});
  }
  // The user's own words for things ("my jams" = "Chill Mix").
  for (const a of res.aliases || []) {
    graphManager.init().then(() => graphManager.addAlias(a.alias, a.refers_to)).catch(() => {});
  }
}

/**
 * Keep a short shared memory of a finished (or failed) task so Rocky can
 * recall it later ("we did this together yesterday"). Background and
 * conversational turns are not remembered.
 */
export function rememberEpisode(ctx, outcome) {
  try {
    const goal = ctx.intentData?.goal;
    if (!goal || ctx.options?.isBackground || ctx.intentData?.domain === 'conversation') return;
    eventBus.emit('TASK_RESULT', { ok: outcome === 'ok', goal });
    const things = Object.values(ctx.intentData.entities || {})
      .filter(v => typeof v === 'string' && v.trim()).slice(0, 3);
    const what = `${String(goal).replace(/_/g, ' ')}${things.length ? ` (${things.join(', ')})` : ''}`;
    graphManager.addEpisode({
      summary: outcome === 'ok' ? `Rocky did for Grace: ${what}` : `Rocky tried to ${what} but it did not work`,
      kind: 'task', outcome, entities: things,
    }).catch(() => {});
  } catch { /* memory must never break a task */ }
}
