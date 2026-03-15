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

const RESEARCH_PROMPT = `You are a timeline research assistant. Given a topic, produce a detailed chronological timeline of key events. Some events are point-in-time, others span a duration.

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

IMPORTANT: Include a MIX of point events (end_date=null) and duration events (end_date set). At least 30% should have durations. Produce 10-15 events. Be factually accurate.
Return ONLY the JSON array, no markdown fences.`;

/* -- Prompt: Research with search context --------------------------------- */

const RESEARCH_PROMPT_WITH_SEARCH = `You are a timeline research assistant. Given a topic and factual context from web search results, produce a detailed chronological timeline of key events.

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

IMPORTANT: Include a MIX of point events and duration events. Produce 10-15 events. Be factually accurate — use search results as your primary source.
Return ONLY the JSON array, no markdown fences.`;

/* -- Prompt: Refine ------------------------------------------------------- */

const REFINE_PROMPT = `You are a timeline editing assistant. The user wants to modify an existing timeline.

User's request: {query}

Current timeline events:
{existing_events}

{search_context}

Based on the user's request, produce the COMPLETE updated timeline as a JSON array. Apply the requested changes (add events, remove events, expand detail, filter by criteria, etc.) while keeping unchanged events intact.

Each event MUST have:
- "start_date": ISO date (YYYY-MM-DD, YYYY-MM, or YYYY)
- "end_date": ISO date or null
- "date_precision": "day", "month", or "year"
- "title": concise event title (max 80 chars)
- "description": 2-4 sentences with factual detail
- "importance": integer 1-10
- "category": short category label
- "tags": array of 1-3 relevant tags

Return ONLY the JSON array, no markdown fences.`;

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

/* -- OpenAI Web Search (Responses API with web_search_preview tool) --- */

/**
 * Use OpenAI Responses API with the web_search_preview tool to search
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
      tools: [{ type: "web_search_preview" }],
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

/**
 * Detect query intent: research vs refine.
 * Lightweight check based on keywords -- no LLM call needed.
 */
function detectIntent(query, hasExistingTimeline) {
  const q = query.toLowerCase().trim();

  // Refine patterns: user wants to modify existing timeline
  const refinePatterns = [
    /^add\b/i, /^remove\b/i, /^delete\b/i, /^filter\b/i, /^focus\b/i,
    /^expand\b/i, /^more\b/i, /^less\b/i, /^only\b/i, /^show\b/i,
    /\bmore (events|detail|info)/i, /\bfewer events/i,
    /\bfrom \d{4}/i, /\bbetween \d{4}/i,
    /\bremove (minor|small|low)/i,
    /\bexpand (the|on|about)/i,
  ];

  if (hasExistingTimeline && refinePatterns.some(p => p.test(q))) {
    return "refine";
  }

  return "research";
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

/**
 * Web search -- uses OpenAI web_search_preview tool.
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
  RESEARCH_PROMPT,
  RESEARCH_PROMPT_WITH_SEARCH,
  REFINE_PROMPT,
  MERGE_PROMPT,
  detectProvider,
};
