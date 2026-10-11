// Scenarios for the AgentLoop characterization tests. Each one scripts the world (tools, planner,
// model, windows, click verification) and the golden trace records what the loop did.
const ok = (data) => ({ success: true, data, error: null });
const fail = (error) => ({ success: false, data: null, error });
const intent = (goal, entities = {}, domain = 'automation', rawInput = goal) =>
  JSON.stringify({ goal, entities, domain, actionable: domain === 'automation', rawInput });

const WIN = (appName, windowTitle = appName) => ({ appName, windowTitle, bounds: { x: 10, y: 20, width: 800, height: 600 }, isMinimized: false, success: true });
const explorer = WIN('explorer', 'Desktop');

export const scenarios = [
  // ───────────── fast path ─────────────
  { name: 'fast_volume_up', input: 'volume up', tools: () => ({ systemControl: () => ok('up') }) },
  { name: 'fast_screenshot', input: 'take a screenshot', tools: () => ({ takeScreenshot: () => ok('saved') }) },
  { name: 'fast_close_window_moves_avatar', input: 'close this window', tools: () => ({ pressKey: () => ok('alt-f4') }) },
  { name: 'fast_move_command', input: 'move to top left' },
  { name: 'fast_media_next', input: 'next', tools: () => ({ pressKey: () => ok('media') }) },
  { name: 'fast_goal_from_json', input: JSON.stringify({ goal: 'volume_down' }), tools: () => ({ systemControl: () => ok('down') }) },
  { name: 'fast_chained_command_skips_fast_path', input: 'volume up and then mute', script: { } },
  { name: 'fast_delegate_code_task', input: 'write a python script that prints hello', options: {} },

  // ───────────── conversation / research ─────────────
  {
    name: 'conversation_uses_memory', input: intent('chat', {}, 'conversation', 'who is my crush'),
    script: { rag: { facts: ['user crush is Mugdha'], workflows: [] }, graphContext: 'user -[crush]-> Mugdha' },
    replies: ['Your crush is Mugdha, Grace.'],
  },
  { name: 'conversation_no_memory', input: intent('greeting', {}, 'conversation', 'hello'), replies: ['Hello Grace.'] },
  {
    name: 'research_with_web_results', input: intent('weather', {}, 'research', 'weather in pune'),
    tools: () => ({ webSearch: () => ok('Sunny 31C') }), replies: ['It is sunny, Grace.'],
  },
  {
    name: 'research_web_search_fails', input: intent('weather', {}, 'research', 'weather in pune'),
    tools: () => ({ webSearch: () => fail('offline') }), replies: ['I cannot check, Grace.'],
  },

  // ───────────── planning ─────────────
  {
    name: 'router_plan_open_app', input: intent('open_app', { app: 'spotify' }, 'automation', 'open spotify'),
    script: {
      deterministic: () => [
        { tool: 'open_resource', input: { query: 'spotify' } },
        { tool: 'waitForAppReady', input: { appName: 'spotify' } },
        { tool: 'focusWindow', input: { appName: 'spotify' } },
      ],
      windows: (i) => (i < 5 ? explorer : WIN('Spotify', 'Spotify Free')),
    },
    tools: () => ({ open_resource: () => ok('launched'), waitForAppReady: () => ok('ready'), focusWindow: () => ok('front') }),
    replies: ['Spotify is open.'],
  },
  {
    name: 'l1_cache_hit', input: intent('calc', { expr: '2+2' }, 'automation', 'calculate'),
    preload: (cache) => cache.set('calc', { expr: '2+2' }, [{ tool: 'calculate', input: { expression: '2+2' } }]),
    tools: () => ({ calculate: () => ok('4') }), replies: ['Four.'],
  },
  {
    name: 'l1_cache_skipped_for_coordinate_plan_without_map', input: intent('click_it', {}, 'automation', 'click it'),
    preload: (cache) => cache.set('click_it', {}, [{ tool: 'mouseClick', input: { x: 10, y: 20 } }]),
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1+1' } }] }],
    tools: () => ({ calculate: () => ok('2') }),
  },
  {
    name: 'planner_fills_placeholders_and_missing_inputs', input: intent('write_note', { app: 'notepad' }, 'automation', 'open notepad and write "buy milk"'),
    planResponses: [{ steps: [
      { tool: 'open_resource', input: { query: '<app>' } },
      { tool: 'waitForAppReady', input: {} },
      { tool: 'typeText', input: {} },
      { tool: 'calculate', input: {} },
      { tool: 'focusWindow', input: { appName: '' } },
      { tool: 'pressKey', input: { key: '{ENTER}' } },
    ] }],
    script: { windows: (i) => (i < 3 ? explorer : WIN('notepad', 'Untitled - Notepad')) },
    tools: () => ({ open_resource: () => ok('x'), waitForAppReady: () => ok('x'), typeText: () => ok('x'), calculate: () => ok('x'), focusWindow: () => ok('x'), pressKey: () => ok('x') }),
  },
  { name: 'planner_returns_nothing', input: intent('do_magic', {}, 'automation', 'do magic'), planResponses: [{ steps: [] }] },
  { name: 'planner_throws', input: intent('do_magic', {}, 'automation', 'do magic'), planResponses: [new Error('model down')] },
  { name: 'non_json_input_without_intent', input: 'just some text that is not an intent' },

  // ───────────── execution ─────────────
  {
    name: 'last_output_injection', input: intent('calc_and_type', {}, 'automation', 'calculate and type'),
    planResponses: [{ steps: [
      { tool: 'calculate', input: { expression: '6*7' } },
      { tool: 'typeText', input: { text: '$LAST_OUTPUT' } },
      { tool: 'typeText', input: { text: 'The answer is $LAST_OUTPUT and $LAST_OUTPUT.value' } },
    ] }],
    tools: () => ({ calculate: () => ok({ value: 42 }), typeText: () => ok('typed') }),
  },
  {
    name: 'open_resource_installed_app_is_remembered', input: intent('open_app', { app: 'spotify' }, 'automation', 'open spotify'),
    planResponses: [{ steps: [{ tool: 'open_resource', input: { query: 'spotify' } }] }],
    tools: () => ({ open_resource: () => ok('launched') }),
  },
  {
    name: 'open_resource_unknown_asks_user', input: intent('open_app', {}, 'automation', 'open zzzqqq'),
    planResponses: [{ steps: [{ tool: 'open_resource', input: { query: 'zzzqqq' } }] }],
    tools: () => ({ open_resource: () => ok('x') }),
  },
  {
    name: 'open_resource_ambiguous_asks_which', input: intent('open_app', {}, 'automation', 'open python'),
    planResponses: [{ steps: [{ tool: 'open_resource', input: { query: 'python' } }] }],
    tools: () => ({ open_resource: () => ok('x') }),
  },
  {
    name: 'open_resource_web_service', input: intent('open_site', {}, 'automation', 'open youtube'),
    planResponses: [{ steps: [{ tool: 'open_resource', input: { query: 'youtube' } }] }],
    tools: () => ({ open_resource: () => ok('launched') }),
  },
  {
    name: 'analyze_ui_gets_current_window', input: intent('look', {}, 'automation', 'look at the screen'),
    planResponses: [{ steps: [{ tool: 'analyze_ui', input: {} }] }],
    script: { windows: [WIN('notepad', 'Untitled - Notepad')] },
    tools: () => ({ analyze_ui: () => ({ success: true, data: 'ok', uiMap: { app: 'notepad', elements: [{ label: 'File', x: 20, y: 30, width: 40, height: 20, confidence: 0.9 }], confidence: 0.9 } }) }),
  },
  {
    name: 'action_cache_reused_on_second_run', inputs: [intent('calc', {}, 'automation', 'calc one'), intent('calc', {}, 'automation', 'calc two')],
    planResponses: [
      { steps: [{ tool: 'calculate', input: { expression: '1+1' } }] },
      { steps: [{ tool: 'calculate', input: { expression: '1+1' } }] },
    ],
    tools: () => ({ calculate: () => ok('2') }),
  },
  { name: 'follow_up_context', inputs: [intent('calc', {}, 'automation', 'first'), intent('calc', {}, 'automation', 'second')],
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }] }, { steps: [{ tool: 'calculate', input: { expression: '2' } }] }],
    script: { windows: [WIN('calculator', 'Calculator')] },
    drive: async (loop, h, input) => {
      if (/second/.test(input)) h.voiceController.isFollowUpWindowActive = true;
      return loop.run(input, {});
    },
    tools: () => ({ calculate: () => ok('n') }) },
  { name: 'background_run_is_not_remembered', input: intent('calc', {}, 'automation', 'bg'), options: { isBackground: true },
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }] }], tools: () => ({ calculate: () => ok('1') }) },
  {
    name: 'facts_episodes_aliases_pipeline', input: intent('chat', {}, 'conversation', 'we fixed the login bug, my jams is Chill Mix'),
    script: { facts: {
      facts: [{ subject: 'user', relation: 'fixed', object: 'login bug', confidence: 0.9, subject_type: 'person', object_type: 'event' },
              { subject: 'user', relation: 'likes', object: 'jazz', confidence: 0.8 }],
      retired: [{ subject: 'user', relation: 'drinks', object: 'coffee' }],
      aliases: [{ alias: 'my jams', refers_to: 'Chill Mix' }] } },
    replies: ['Nice work.'],
  },

  // ───────────── clicks ─────────────
  clickScenario('click_verified_changed', { verdicts: [{ verdict: 'changed', reason: 'x' }], locate: () => ok({ x: 100, y: 200 }) }),
  clickScenario('click_verdict_unknown_trusts_tool', { verdicts: [{ verdict: 'unknown', reason: 'no screen' }], locate: () => ok({ x: 100, y: 200 }) }),
  clickScenario('click_unchanged_then_ocr_recovery', {
    verdicts: [{ verdict: 'unchanged', reason: 'x' }, { verdict: 'changed', reason: 'x' }],
    locate: () => ok({ x: 100, y: 200 }), ocr: () => ok({ x: 150, y: 250 }),
  }),
  clickScenario('click_unchanged_keyboard_fallback', {
    label: 'search box', verdicts: [{ verdict: 'unchanged', reason: 'x' }], locate: () => ok({ x: 100, y: 200 }), ocr: () => ({ success: false, error: 'none' }),
  }),
  clickScenario('click_unchanged_vision_fallback', {
    label: 'mystery icon', verdicts: [{ verdict: 'unchanged', reason: 'x' }, { verdict: 'changed', reason: 'x' }],
    locate: (a, n) => ok(n === 0 ? { x: 100, y: 200 } : { x: 300, y: 400 }), ocr: () => ({ success: false, error: 'none' }),
  }),
  clickScenario('click_everything_fails', {
    label: 'mystery icon', verdicts: [{ verdict: 'unchanged', reason: 'x' }], locate: () => fail('not found'), ocr: () => ({ success: false, error: 'none' }),
  }),
  clickScenario('click_tool_itself_fails', { verdicts: [], locate: () => ok({ x: 5, y: 6 }), click: () => fail('mouse error'), ocr: () => ({ success: false, error: 'none' }) }),

  // ───────────── recovery ─────────────
  {
    name: 'hallucinated_tool_replans', input: intent('calc', {}, 'automation', 'calc'),
    planResponses: [{ steps: [{ tool: 'teleport', input: {} }] }, { steps: [{ tool: 'calculate', input: { expression: '3*3' } }] }],
    registered: ['calculate'], tools: () => ({ calculate: () => ok('9') }),
  },
  {
    name: 'forbidden_tool_exhausts_retries', input: intent('calc', {}, 'automation', 'calc'),
    planResponses: [{ steps: [{ tool: 'webSearch', input: { query: 'x' } }] }],
    tools: () => ({ webSearch: () => ok('x') }),
  },
  {
    name: 'plain_failure_retries_then_succeeds', input: intent('calc', {}, 'automation', 'calc'),
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }] }],
    tools: () => ({ calculate: (a, n) => (n < 2 ? fail('flaky') : ok('1')) }),
  },
  {
    name: 'plain_failure_never_succeeds', input: intent('calc', {}, 'automation', 'calc'),
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }] }],
    tools: () => ({ calculate: () => fail('broken') }),
  },
  {
    name: 'app_not_in_front_recovers_via_activation', input: intent('open_app', {}, 'automation', 'open notepad'),
    planResponses: [{ steps: [{ tool: 'waitForAppReady', input: { appName: 'notepad' } }] }],
    script: { windows: (i) => (i < 4 ? explorer : WIN('notepad', 'Untitled - Notepad')) },
    tools: () => ({ waitForAppReady: () => ok('ready') }),
  },
  {
    name: 'app_never_in_front', input: intent('open_app', {}, 'automation', 'open notepad'),
    planResponses: [{ steps: [{ tool: 'focusWindow', input: { appName: 'notepad' } }] }],
    script: { windows: [explorer] },
    tools: () => ({ focusWindow: () => ok('front') }),
  },

  // ───────────── limits, abort, background queue ─────────────
  {
    name: 'step_limit_reached', input: intent('long', {}, 'automation', 'long task'),
    planResponses: [{ steps: Array.from({ length: 70 }, (_, i) => ({ tool: 'calculate', input: { expression: `${i}+1` } })) }],
    tools: () => ({ calculate: () => ok('n') }),
  },
  { name: 'aborted_before_start', input: intent('calc', {}, 'automation', 'calc'), useSignal: true,
    drive: async (loop, h, input) => { h.abort(); return loop.run(input, { signal: h.signal }); },
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }] }], tools: () => ({ calculate: () => ok('1') }) },
  { name: 'aborted_during_tool', input: intent('calc', {}, 'automation', 'calc'), useSignal: true,
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }, { tool: 'calculate', input: { expression: '2' } }] }],
    tools: (h) => ({ calculate: async () => { h.abort(); return new Promise(() => {}); } }) },
  {
    name: 'kill_switch_event_ends_run', input: intent('calc', {}, 'automation', 'calc'),
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }, { tool: 'calculate', input: { expression: '2' } }] }],
    tools: (h) => ({ calculate: (a, n) => { if (n === 0) h.eventBus.emit('execution:abort'); return ok('x'); } }),
  },
  {
    name: 'listener_count_after_runs', inputs: [intent('calc', {}, 'automation', 'a'), intent('calc', {}, 'automation', 'b'), intent('calc', {}, 'automation', 'c')],
    planResponses: [1, 2, 3].map((n) => ({ steps: [{ tool: 'calculate', input: { expression: `${n}` } }] })),
    tools: () => ({ calculate: () => ok('n') }),
    drive: async (loop, h, input) => {
      h.base ??= h.eventBus.listenerCount('execution:abort');       // before the first run
      const r = await loop.run(input, {});
      // listeners still registered by finished runs (should be 0)
      globalThis.__T.main('leftover execution:abort listeners', h.eventBus.listenerCount('execution:abort') - h.base);
      return r;
    },
  },
  {
    name: 'background_task_queued_while_busy', input: intent('calc', {}, 'automation', 'calc'),
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }] }],
    tools: (h) => ({ calculate: () => ok('1') }),
    drive: async (loop, h, input) => {
      const p = loop.run(input, {});
      await loop.handleProactiveTrigger({ trigger: 'cleanup', prompt: 'tidy' }); // arrives while busy
      globalThis.__T.main('queued while busy', loop.backgroundQueue.length);
      return p;
    },
  },
];


// Scenarios added while checking the refactor (recorded against the original single-file loop).
const UI_APP = WIN('uimapapp', 'Compose - UiMapApp');
const UI_MAP_ELEMENTS = [
  { label: 'Send button', x: 400, y: 300, width: 80, height: 30, confidence: 0.9 },
  { label: 'Subject', x: 200, y: 100, width: 300, height: 30, confidence: 0.9 },
  { label: 'Discard', x: 520, y: 300, width: 80, height: 30, confidence: 0.9 },
];
const UI_UIA = UI_MAP_ELEMENTS.map((e) => ({ Name: e.label, AutomationId: '', ClassName: '', ControlType: 'ControlType.Button', BoundingRectangle: `${e.x - e.width / 2},${e.y - e.height / 2},${e.width},${e.height}` }));
const saveTestMap = (cache, uiMapStore) => uiMapStore.saveUIMap('uimapapp', 'Compose - UiMapApp', { elements: UI_MAP_ELEMENTS, confidence: 0.9 }, { currentWindow: UI_APP, executionSucceeded: true });
const mapClick = (name, verdicts, extra = {}) => ({
  name, input: intent('send_it', {}, 'automation', 'click the send button'),
  preload: saveTestMap,
  planResponses: [{ steps: [{ tool: 'mouseClick', input: { label: 'Send button' } }] }],
  script: { verdicts, windows: [UI_APP], elements: UI_UIA },
  tools: () => ({ mouseClick: () => ok('clicked'), locateUIElement: () => fail('should not be needed'), ocrSearch: () => ({ success: false, error: 'none' }), pressKey: () => ok('x') }),
  ...extra,
});

scenarios.push(
  {
    name: 'l1_cache_plan_is_sanitised', input: intent('note', { app: 'notepad' }, 'automation', 'write "hello there"'),
    preload: (cache) => cache.set('note', { app: 'notepad' }, [
      { tool: 'open_resource', input: { query: '<app>' } }, { tool: 'typeText', input: {} }, { tool: 'waitForAppReady', input: {} },
    ]),
    script: { windows: (i) => (i < 3 ? explorer : WIN('notepad', 'Untitled - Notepad')) },
    tools: () => ({ open_resource: () => ok('x'), typeText: () => ok('x'), waitForAppReady: () => ok('x') }),
  },
  mapClick('ui_map_click_success_records_success', [{ verdict: 'changed', reason: 'x' }]),
  mapClick('ui_map_click_unchanged_records_failure', [{ verdict: 'unchanged', reason: 'x' }, { verdict: 'changed', reason: 'x' }]),
  mapClick('ui_map_click_tool_error_records_failure', [], { tools: () => ({ mouseClick: () => fail('mouse error'), locateUIElement: () => fail('x'), ocrSearch: () => ({ success: false, error: 'none' }), pressKey: () => ok('x') }) }),
  {
    name: 'recover_ocr_tool_throws_then_keyboard', input: intent('click_search', {}, 'automation', 'click the search box'),
    planResponses: [{ steps: [{ tool: 'mouseClick', input: { label: 'search box' } }] }],
    script: { verdicts: [{ verdict: 'unchanged', reason: 'x' }], windows: [WIN('chrome', 'Inbox - Chrome')] },
    tools: () => ({ locateUIElement: () => ok({ x: 1, y: 2 }), ocrSearch: () => { throw new Error('ocr crashed'); }, mouseClick: () => ok('c'), pressKey: () => ok('k') }),
  },
  {
    name: 'recover_replan_returns_no_steps', input: intent('calc', {}, 'automation', 'calc'),
    planResponses: [{ steps: [{ tool: 'teleport', input: {} }] }, { steps: [] }],
    registered: ['calculate'], tools: () => ({ calculate: () => ok('9') }),
  },
  {
    name: 'abort_lands_between_execute_and_validate', input: intent('calc', {}, 'automation', 'calc'), useSignal: true,
    script: (h) => ({ windows: (i) => { if (i === 4) h.abort(); return explorer; } }),
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }, { tool: 'calculate', input: { expression: '2' } }] }],
    tools: () => ({ calculate: () => ok('n') }),
  },
);

// Her words vs the interpreter's JSON (added with the fix that makes the loop read what she said).
scenarios.push(
  {
    // The JSON contains "volume up" (an entity value), though she only asked for a song.
    name: 'fast_path_ignores_words_inside_entities', input: intent('play_song', { mood: 'volume up music' }, 'automation', 'play something relaxing'),
    planResponses: [{ steps: [{ tool: 'calculate', input: { expression: '1' } }] }],
    tools: () => ({ systemControl: () => ok('volume changed'), calculate: () => ok('1') }),
  },
  {
    name: 'click_target_comes_from_her_words', input: intent('send_it', {}, 'automation', 'click "Send now"'),
    planResponses: [{ steps: [{ tool: 'mouseClick', input: {} }] }],
    script: { verdicts: [{ verdict: 'changed', reason: 'x' }], windows: [WIN('chrome', 'Inbox - Chrome')] },
    tools: () => ({ locateUIElement: () => ok({ x: 100, y: 200 }), mouseClick: () => ok('clicked') }),
  },
  {
    name: 'calculate_expression_comes_from_her_words', input: intent('calc_it', {}, 'automation', 'what is 12 times 3'),
    planResponses: [{ steps: [{ tool: 'calculate', input: {} }] }],
    tools: () => ({ calculate: () => ok('36') }),
  },
);

// Input that is not an interpreter intent (interpreter failed / plain text): used to crash in PLAN.
scenarios.push(
  {
    name: 'plain_text_request_is_planned_not_crashed', input: 'please open notepad and write hello',
    planResponses: [{ steps: [{ tool: 'open_resource', input: { query: 'notepad' } }, { tool: 'typeText', input: { text: 'hello' } }] }],
    script: { windows: (i) => (i < 3 ? explorer : WIN('notepad', 'Untitled - Notepad')) },
    tools: () => ({ open_resource: () => ok('launched'), typeText: () => ok('typed') }),
  },
  {
    // The plan cache is keyed by goal: two different plain-text requests must not share one.
    name: 'plain_text_requests_do_not_share_a_cached_plan', inputs: ['write the word apple', 'write the word banana'],
    planResponses: [
      { steps: [{ tool: 'typeText', input: { text: 'apple' } }] },
      { steps: [{ tool: 'typeText', input: { text: 'banana' } }] },
    ],
    tools: () => ({ typeText: () => ok('typed') }),
  },
);

function clickScenario(name, o) {
  return {
    name,
    input: intent('click_send', {}, 'automation', `click the ${o.label || 'send button'}`),
    planResponses: [{ steps: [{ tool: 'mouseClick', input: { label: o.label || 'Send button' } }] }],
    script: { verdicts: [...(o.verdicts || [])], windows: [WIN('chrome', 'Inbox - Chrome')], elements: [] },
    tools: () => ({
      locateUIElement: o.locate || (() => fail('nope')),
      ocrSearch: o.ocr || (() => ({ success: false, error: 'none' })),
      mouseClick: o.click || (() => ok('clicked')),
      pressKey: () => ok('pressed'),
    }),
  };
}
