/**
 * ChronoWeave -- LLM helpers (multi-provider)
 *
 * Provider auto-detection (first match wins):
 *   1. ANTHROPIC_API_KEY → Anthropic Claude Sonnet 4.6
 *   2. OPENAI_API_KEY   → OpenAI GPT-5.4
 *   3. XAI_API_KEY      → xAI Grok 4.20
 *
 * Override the model via LLM_MODEL env var if desired.
 */

/* -- Prompt: Research (primary, LLM-first) -------------------------------- */

const RESEARCH_PROMPT = `You are a timeline research assistant. Given a topic, produce a chronological timeline of events spanning the FULL range of significance. Include both major watershed moments AND minor background context.

Topic: {query}

Return a JSON array of events. Each event MUST have:
- "start_date": ISO date (YYYY-MM-DD, YYYY-MM, or YYYY)
- "end_date": ISO date or null. Use non-null for events with meaningful duration (wars, programs, eras, construction periods, etc.). Use null for point-in-time events.
- "date_precision": "day", "month", or "year"
- "title": concise event title (max 80 chars)
- "description": 2-4 sentences with factual detail
- "importance": integer 1-10 (10 = most significant)
- "category": short category label like "milestone", "conflict", "policy", "discovery", "launch", "era", etc.
- "tags": array of 1-3 relevant tags

IMPORTANCE SCORING — use the FULL 1-10 range:
- 1-2: Minor background context, small footnotes, precursor details
- 3-4: Notable but not major — contributing factors, secondary developments
- 5-6: Significant events — important milestones, meaningful shifts
- 7-8: Major events — key turning points, landmark achievements
- 9-10: Critical/watershed moments — events that fundamentally changed the course of history

Spread importance scores across the full 1-10 range. Do NOT cluster all events at 6-8. At least 20% of events should be importance 3 or below, and no more than 20% should be 8 or above. The distribution should resemble a bell curve centered around 5.

IMPORTANT: Include a MIX of point events (end_date=null) and duration events (end_date set). At least 30% should have durations.

EVENT COUNT — keep it focused, the user can always ask for more detail later:
- Narrow topic (single event, short period): 6-10 events
- Medium topic (a decade, a movement, a company): 10-15 events
- Broad topic (an entire field, centuries of development): 15-20 events
- Epic topic (history of civilization, evolution across centuries): 18-25 events

Be factually accurate.
Return ONLY the JSON array, no markdown fences.`;

/* -- Prompt: Research with search context --------------------------------- */

const RESEARCH_PROMPT_WITH_SEARCH = `You are a timeline research assistant. Given a topic and factual context from web search results, produce a chronological timeline of events spanning the FULL range of significance.

Topic: {query}

Web search results (use these as primary factual source):
{search_context}

Return a JSON array of events. Each event MUST have:
- "start_date": ISO date (YYYY-MM-DD, YYYY-MM, or YYYY)
- "end_date": ISO date or null. Use non-null for events with meaningful duration.
- "date_precision": "day", "month", or "year"
- "title": concise event title (max 80 chars)
- "description": 2-4 sentences with factual detail — prefer facts from the search context.
- "importance": integer 1-10 (10 = most significant)
- "category": short category label
- "tags": array of 1-3 relevant tags

IMPORTANCE SCORING — use the FULL 1-10 range:
- 1-2: Minor background context, small footnotes, precursor details
- 3-4: Notable but not major — contributing factors, secondary developments
- 5-6: Significant events — important milestones, meaningful shifts
- 7-8: Major events — key turning points, landmark achievements
- 9-10: Critical/watershed moments — events that fundamentally changed the course of history

Spread importance scores across the full 1-10 range. Do NOT cluster all events at 6-8. At least 20% of events should be importance 3 or below, and no more than 20% should be 8 or above.

IMPORTANT: Include a MIX of point events and duration events.

EVENT COUNT — keep it focused:
- Narrow topic: 6-10 events
- Medium topic: 10-15 events
- Broad topic: 15-20 events
- Epic topic: 18-25 events

Be factually accurate — use search results as your primary source.
Return ONLY the JSON array, no markdown fences.`;

/* -- Prompt: Refine ------------------------------------------------------- */

const REFINE_PROMPT = `You are a timeline research assistant. The user has an existing timeline and is making a follow-up request.

User's follow-up: {query}

Existing events already on the timeline (DO NOT repeat these):
{existing_events}

{search_context}

IMPORTANT RULES:
1. Return ONLY NEW events that are NOT already in the existing timeline above.
2. Do NOT duplicate or repeat any existing event, even with slightly different wording.
3. If the user asks to "add more detail" or "expand", add new events that fill gaps between existing ones.
4. If the user asks about a sub-topic or related area, add events specifically about that sub-topic.
5. If the user asks to REMOVE or FILTER events, return a JSON object instead: {"remove_titles": ["exact title 1", "exact title 2"]} listing titles to remove.
6. Aim for 5-15 new events depending on scope.
7. New events are NOT limited to the date range of existing events. If the follow-up topic spans a different or broader time period, use whatever dates are historically accurate. The timeline will automatically expand to fit all events.

IMPORTANCE SCORING — use the FULL 1-10 range:
- 1-2: Minor background context, small footnotes, precursor details
- 3-4: Notable but not major — contributing factors, secondary developments
- 5-6: Significant events — important milestones, meaningful shifts
- 7-8: Major events — key turning points, landmark achievements
- 9-10: Critical/watershed moments — events that fundamentally changed the course of history

Spread importance scores across the full 1-10 range. Do NOT cluster all events at 6-8. At least 20% of events should be importance 3 or below, and no more than 20% should be 8 or above.

Each NEW event MUST have:
- "start_date": ISO date (YYYY-MM-DD, YYYY-MM, or YYYY)
- "end_date": ISO date or null
- "date_precision": "day", "month", or "year"
- "title": concise event title (max 80 chars)
- "description": 2-4 sentences with factual detail
- "importance": integer 1-10
- "category": short category label
- "tags": array of 1-3 relevant tags

Return ONLY the JSON array of NEW events (or a remove object), no markdown fences.`;

const MERGE_PROMPT = `You are a timeline merge assistant. Merge events from multiple timelines intelligently.

Rules:
1. Events referring to the SAME real-world occurrence → merge into one, combine descriptions
2. Unique events → keep as-is
3. Sort chronologically by start_date
4. Preserve start_date and end_date from originals (use best available)

Input:
{data}

Return a JSON array where each event has:
- "start_date", "end_date", "date_precision", "title", "description", "importance", "category", "tags"
- "source_ids": array of timeline IDs this came from
- "original_event_ids": array of original event IDs merged into this

Return ONLY the JSON array.`;

/* -- Provider detection ----------------------------------------------- */

function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.XAI_API_KEY) return "grok";
  throw new Error(
    "No LLM API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY in your .env file."
  );
}

/** Detect if running inside Perplexity sandbox (proxy base URL) */
function isSandbox() {
  const baseUrl = process.env.OPENAI_BASE_URL || "";
  return baseUrl.includes("proxy") || baseUrl.includes("pplx");
}

/* -- Anthropic path --------------------------------------------------- */

let _anthropicClient = null;
function getAnthropicClient() {
  if (!_anthropicClient) {
    const Anthropic = require("@anthropic-ai/sdk");
    _anthropicClient = new Anthropic();
  }
  return _anthropicClient;
}

async function llmCallAnthropic(prompt, maxTokens = 6000) {
  const client = getAnthropicClient();
  const model =
    process.env.LLM_MODEL ||
    (isSandbox() ? "claude_sonnet_4_6" : "claude-sonnet-4-6");
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content[0].text.trim();
}

async function llmStreamAnthropic(prompt, onToken, maxTokens = 6000) {
  const client = getAnthropicClient();
  const model =
    process.env.LLM_MODEL ||
    (isSandbox() ? "claude_sonnet_4_6" : "claude-sonnet-4-6");

  let full = "";
  const stream = await client.messages.stream({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta"
    ) {
      full += event.delta.text;
      onToken(event.delta.text);
    }
  }
  return full.trim();
}

/* -- OpenAI path ------------------------------------------------------ */

let _openaiClient = null;
function getOpenAIClient() {
  if (!_openaiClient) {
    const OpenAI = require("openai");
    _openaiClient = new OpenAI();
  }
  return _openaiClient;
}

async function llmCallOpenAI(prompt, maxTokens = 6000) {
  const client = getOpenAIClient();

  if (isSandbox()) {
    const model = process.env.LLM_MODEL || "gpt_5_4";
    const resp = await client.responses.create({
      model,
      input: prompt,
    });
    return resp.output_text.trim();
  } else {
    const model = process.env.LLM_MODEL || "gpt-5.4";
    const resp = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return resp.choices[0].message.content.trim();
  }
}

async function llmStreamOpenAI(prompt, onToken, maxTokens = 6000) {
  const client = getOpenAIClient();

  if (isSandbox()) {
    // Sandbox Responses API -- stream
    const model = process.env.LLM_MODEL || "gpt_5_4";
    const stream = await client.responses.create({
      model,
      input: prompt,
      stream: true,
    });
    let full = "";
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        full += event.delta;
        onToken(event.delta);
      }
    }
    return full.trim();
  } else {
    // Real OpenAI Chat Completions -- stream
    const model = process.env.LLM_MODEL || "gpt-5.4";
    const stream = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });
    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onToken(delta);
      }
    }
    return full.trim();
  }
}

/* -- OpenAI Web Search (Responses API with web_search tool) ----------- */

/**
 * Use OpenAI Responses API with the web_search tool to search
 * the web for factual information on a topic.
 * Only called on-demand when the LLM can't handle the query well.
 * Returns { results: string, searchQueries: string[] }
 */
async function webSearchOpenAI(query, onProgress) {
  const client = getOpenAIClient();

  if (!process.env.OPENAI_API_KEY) {
    return { results: "", searchQueries: [] };
  }

  const model = isSandbox() ? "gpt_5_4" : "gpt-5.4";

  try {
    if (onProgress) onProgress(`Searching the web for "${query}"...`);

    const resp = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      input: `Search the web for factual, chronological information about: ${query}\n\nProvide a concise summary of the key facts, dates, events, and details you find. Focus on specific dates and verifiable facts useful for building a timeline.`,
    });

    const text = resp.output_text || "";
    if (text.trim()) {
      return {
        results: text.trim(),
        searchQueries: [query],
      };
    }
  } catch (err) {
    console.error(`Web search failed for "${query}":`, err.message);
  }

  return { results: "", searchQueries: [] };
}

/* -- Grok (xAI) path -- OpenAI-compatible at api.x.ai ----------------- */

let _grokClient = null;
function getGrokClient() {
  if (!_grokClient) {
    const OpenAI = require("openai");
    _grokClient = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });
  }
  return _grokClient;
}

async function llmCallGrok(prompt, maxTokens = 6000) {
  const client = getGrokClient();
  const model = process.env.LLM_MODEL || "grok-4.20-beta-latest-non-reasoning";
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return resp.choices[0].message.content.trim();
}

async function llmStreamGrok(prompt, onToken, maxTokens = 6000) {
  const client = getGrokClient();
  const model = process.env.LLM_MODEL || "grok-4.20-beta-latest-non-reasoning";
  const stream = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
    stream: true,
  });
  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      onToken(delta);
    }
  }
  return full.trim();
}

/* -- Unified entrypoints ---------------------------------------------- */

function stripFences(text) {
  if (text.startsWith("```")) {
    text = text.split("\n").slice(1).join("\n");
    if (text.endsWith("```")) text = text.slice(0, -3);
    text = text.trim();
  }
  return text;
}

async function llmCall(prompt, maxTokens = 6000) {
  const provider = detectProvider();
  let text;
  if (provider === "anthropic") {
    text = await llmCallAnthropic(prompt, maxTokens);
  } else if (provider === "openai") {
    text = await llmCallOpenAI(prompt, maxTokens);
  } else {
    text = await llmCallGrok(prompt, maxTokens);
  }
  return JSON.parse(stripFences(text));
}

/**
 * Streaming LLM call -- invokes onToken(chunk) for each text fragment.
 * Returns the final parsed JSON.
 */
async function llmCallStream(prompt, onToken, maxTokens = 6000) {
  const provider = detectProvider();
  let text;
  if (provider === "anthropic") {
    text = await llmStreamAnthropic(prompt, onToken, maxTokens);
  } else if (provider === "openai") {
    text = await llmStreamOpenAI(prompt, onToken, maxTokens);
  } else {
    text = await llmStreamGrok(prompt, onToken, maxTokens);
  }
  return JSON.parse(stripFences(text));
}

/* -- Prompt: Question answering based on timeline context --------------- */

const QUESTION_PROMPT = `You are a timeline research assistant. The user has an existing timeline and is asking a question about it.

User's question: {query}

Existing events on the timeline:
{existing_events}

Answer the user's question based on the timeline events above. Be concise and factual. Reference specific events and dates when relevant.

Return a JSON object with:
- "answer": your answer as a string (2-5 sentences)

Return ONLY the JSON object, no markdown fences.`;

/* -- Prompt: Edit events based on user instruction ---------------------- */

const EDIT_PROMPT = `You are a timeline edit assistant. The user wants to modify their existing timeline events.

User's instruction: {query}

Existing events on the timeline:
{existing_events}

Based on the user's instruction, return a JSON object describing what changes to make. The object MUST have one of these forms:

1. To remove events: {"action": "remove", "remove_titles": ["exact title 1", "exact title 2"]}
2. To update importance: {"action": "update_importance", "updates": [{"title": "exact title", "importance": 5}, ...]}

Match event titles EXACTLY as they appear in the existing events list above.
Return ONLY the JSON object, no markdown fences.`;

/**
 * Detect query intent with expanded classification.
 *
 * Returns one of: "research", "refine", "navigate", "display", "question", "edit"
 *
 * KEY PRINCIPLE: If a timeline already exists in the session,
 * default to REFINE (preserve context) unless the user explicitly
 * asks for a new/unrelated topic or a different intent is detected.
 */
function detectIntent(query, hasExistingTimeline) {
  if (!hasExistingTimeline) return "research";

  const q = query.toLowerCase().trim();

  // Explicit NEW research patterns — user wants to start fresh
  const newResearchPatterns = [
    /^(new topic|start (over|fresh)|reset|clear)/i,
    /^research\b/i,       // "research quantum computing" = new topic
    /^(history|timeline|evolution) of\b/i,  // "history of X" = clearly new topic
    /^(tell me about|what is|explain)\b/i,  // broad new-topic phrasing
  ];

  if (newResearchPatterns.some(p => p.test(q))) {
    return "research";
  }

  // Navigate intents — zoom, scroll, focus on time period (client-side)
  const navigatePatterns = [
    /^(zoom|focus|scroll)\s+(in(to)?|on|to)\b/i,
    /\bzoom\s+(in(to)?|to)\s+\d{3,4}/i,  // "zoom into 1960-1970"
    /^(show|go to|jump to)\s+(me\s+)?(the\s+)?\d{3,4}/i,  // "show me 1960-1970"
    /^(show|go to|jump to)\s+(me\s+)?the\s+(early|mid|late)\b/i,
  ];

  if (navigatePatterns.some(p => p.test(q))) {
    return "navigate";
  }

  // Display intents — filter, view switch, importance threshold (client-side)
  const displayPatterns = [
    /\bswitch\s+to\s+(horizontal|vertical|list)\b/i,
    /\b(show|display|filter)\s+(only\s+)?(importance|imp)\s*(\d+|[789]|10)\+?/i,
    /\bshow\s+only\s+(high|low|important|major)/i,
    /\bhide\s+(minor|low|unimportant)/i,
    /\b(horizontal|vertical|list)\s+(view|mode|layout)\b/i,
    /\b(zoom\s+)?(in|out)\b$/i,  // just "zoom in" or "zoom out"
    /^(increase|decrease)\s+(zoom|size)/i,
  ];

  if (displayPatterns.some(p => p.test(q))) {
    return "display";
  }

  // Question intents — asking about existing events (LLM answers from context)
  const questionPatterns = [
    /^(what|which|who|when|where|why|how)\s+(was|were|is|are|did|does|do|happened|came)\b/i,
    /^(what|which)\s+(is|was)\s+the\s+(most|least|biggest|smallest|first|last|earliest|latest)\b/i,
    /\?$/,  // ends with question mark
    /^(can you|could you)\s+(tell|explain|describe)/i,
  ];

  if (questionPatterns.some(p => p.test(q))) {
    return "question";
  }

  // Edit intents — remove, change, modify existing events (targeted LLM call)
  const editPatterns = [
    /^(remove|delete|drop|get rid of)\b/i,
    /\b(remove|delete)\s+(all\s+)?(events?|items?)\b/i,
    /\b(remove|delete)\s+(all\s+)?(events?\s+)?(about|related|before|after|from|between)\b/i,
    /\b(change|update|set|increase|decrease|raise|lower)\s+(the\s+)?importance\b/i,
    /\b(change|update|modify|edit)\s+(the\s+)?(events?|items?)\b/i,
  ];

  if (editPatterns.some(p => p.test(q))) {
    return "edit";
  }

  // Everything else with an existing timeline → refine (preserve context)
  // This covers: "what about the wars?", "focus on 1990s",
  // "add more detail", "the political side",
  // "now cover X", "colonial past", etc.
  return "refine";
}

/**
 * Detect if a query likely needs web search.
 * Only triggers for very recent events, specific current data,
 * or explicit user requests for live information.
 */
function needsWebSearch(query) {
  const q = query.toLowerCase();
  const currentYear = new Date().getFullYear();

  // Explicit search requests
  if (/\b(search|look up|find online|latest|current|recent|today|this year|202[4-9]|203\d)\b/i.test(q)) {
    return true;
  }

  // Topics that are inherently about very recent/ongoing events
  if (/\b(stock price|weather|news|score|election result|latest|breaking)\b/i.test(q)) {
    return true;
  }

  // References to current or next year
  if (q.includes(String(currentYear)) || q.includes(String(currentYear + 1))) {
    return true;
  }

  return false;
}

/* -- Prompt: Holistic session title ---------------------------------------- */

const TITLE_PROMPT = `You generate concise timeline titles. Given the current title, a new query, and event categories, return a single updated title (max 60 chars).

Rules:
- If the new query refines the existing topic (subset, deeper dive, same theme), keep the title the same or barely adjust it.
- If the new query introduces a genuinely different topic, broaden the title to cover both (e.g. "WW2 & Colonial Legacy").
- Use "&" to combine distinct topics, not full sentences.
- Strip filler like "history of", "timeline of". Be punchy.
- NEVER exceed 60 characters.

Current title: {current_title}
New query: {new_query}
Event categories: {categories}

Return ONLY the title string, no quotes, no JSON, no explanation.`;

/**
 * Generate or update a holistic session title after research/refine.
 * Lightweight LLM call (~100 tokens). Fire-and-forget — caller should not await.
 */
async function generateSessionTitle(currentTitle, newQuery, eventCategories) {
  const prompt = TITLE_PROMPT
    .replace("{current_title}", currentTitle)
    .replace("{new_query}", newQuery)
    .replace("{categories}", eventCategories.slice(0, 30).join(", "));

  try {
    const provider = detectProvider();
    let text;
    if (provider === "anthropic") {
      text = await llmCallAnthropic(prompt, 100);
    } else if (provider === "openai") {
      text = await llmCallOpenAI(prompt, 100);
    } else {
      text = await llmCallGrok(prompt, 100);
    }
    // Clean up — remove quotes, trim, enforce 60 char limit
    text = text.replace(/^["']|["']$/g, "").trim();
    if (text.length > 60) text = text.slice(0, 60);
    return text || currentTitle;
  } catch (err) {
    console.error("Title generation failed:", err.message);
    return currentTitle;
  }
}

/* -- Prompt: Follow-up suggestions ---------------------------------------- */

const SUGGESTIONS_PROMPT = `You are a timeline research assistant. The user just researched a topic and received events. Suggest 2-3 natural follow-up queries they might want to explore next.

Topic: {query}

Events discovered (summary):
{event_titles}

Return a JSON array of 2-3 short follow-up prompts (max 60 chars each). These should be:
- Specific sub-topics, related themes, or deeper dives
- Different from the original query
- Phrased as natural user queries (e.g. "What about the political impact?", "Focus on 1990s technology", "Add the key figures involved")

Return ONLY the JSON array of strings, no markdown fences.`;

/**
 * Generate follow-up suggestions after research/refine completes.
 * Uses a lightweight LLM call (low token count).
 */
async function generateSuggestions(query, eventTitles) {
  const prompt = SUGGESTIONS_PROMPT
    .replace("{query}", query)
    .replace("{event_titles}", eventTitles.slice(0, 20).map(t => `- ${t}`).join('\n'));

  try {
    const result = await llmCall(prompt, 500);
    if (Array.isArray(result)) {
      return result.filter(s => typeof s === "string").slice(0, 3);
    }
    return [];
  } catch (err) {
    console.error("Suggestions generation failed:", err.message);
    return [];
  }
}

/**
 * Web search -- uses OpenAI web_search tool.
 * Called on-demand, not by default.
 */
async function webSearch(query, onProgress) {
  if (!query) return { results: "", searchQueries: [] };
  return webSearchOpenAI(query, onProgress);
}

module.exports = {
  llmCall,
  llmCallStream,
  detectIntent,
  needsWebSearch,
  webSearch,
  generateSuggestions,
  generateSessionTitle,
  RESEARCH_PROMPT,
  RESEARCH_PROMPT_WITH_SEARCH,
  REFINE_PROMPT,
  MERGE_PROMPT,
  QUESTION_PROMPT,
  EDIT_PROMPT,
  detectProvider,
};
