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

/* -- Prompt: Intent Classification ---------------------------------------- */

const CLASSIFY_PROMPT = `You are a timeline research assistant. Classify the user's query into one of these intents:

1. "research" — The user wants to research a NEW topic and create a timeline from scratch.
   Examples: "History of the internet", "World War II", "SpaceX milestones", "Evolution of smartphones"

2. "refine" — The user wants to modify, filter, expand, or adjust an EXISTING timeline.
   Examples: "Add more events from 1990-2000", "Focus only on military events", "Remove minor events", "Expand the section about the Cold War", "Add more detail to the early events"

3. "question" — The user is asking a question or making a conversational remark, not requesting timeline data.
   Examples: "What was the most important event?", "When did this start?", "Tell me more about event #3"

Query: {query}

Respond with ONLY a JSON object: {"intent": "research"|"refine"|"question", "search_queries": ["query1", "query2", ...], "summary": "brief explanation"}

For "research" intent, provide 2-4 focused web search queries that would gather the best factual information for building a timeline on this topic. Make queries specific and varied to cover different angles.

For "refine" intent, provide 1-2 search queries that would help with the specific refinement requested, or an empty array if no additional research is needed.

For "question" intent, provide an empty array.

Return ONLY the JSON object, no markdown fences.`;

/* -- Prompt: Research (now uses search context) --------------------------- */

const RESEARCH_PROMPT = `You are a timeline research assistant. Given a topic and factual context from web search results, produce a detailed chronological timeline of key events. Some events are point-in-time, others span a duration.

Topic: {query}

{search_context}

Return a JSON array of events. Each event MUST have:
- "start_date": ISO date (YYYY-MM-DD, YYYY-MM, or YYYY)
- "end_date": ISO date or null. Use non-null for events with meaningful duration (wars, programs, eras, construction periods, etc.). Use null for point-in-time events.
- "date_precision": "day", "month", or "year"
- "title": concise event title (max 80 chars)
- "description": 2-4 sentences with factual detail
- "importance": integer 1-10 (10 = most significant)
- "category": short category label like "milestone", "conflict", "policy", "discovery", "launch", "era", etc.
- "tags": array of 1-3 relevant tags

IMPORTANT: Include a MIX of point events (end_date=null) and duration events (end_date set). At least 30% should have durations. Produce 10-15 events. Be factually accurate — prefer facts from the search context over general knowledge.
Return ONLY the JSON array, no markdown fences.`;

/* -- Prompt: Research (no search context fallback) ------------------------ */

const RESEARCH_PROMPT_NOSEARCH = `You are a timeline research assistant. Given a topic, produce a detailed chronological timeline of key events. Some events are point-in-time, others span a duration.

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
 * Returns an object: { results: string, searchQueries: string[] }
 */
async function webSearchOpenAI(searchQueries, onProgress) {
  const client = getOpenAIClient();

  if (!process.env.OPENAI_API_KEY) {
    return { results: "", searchQueries: [] };
  }

  const model = isSandbox() ? "gpt_5_4" : "gpt-5.4";
  const allResults = [];
  const completedQueries = [];

  for (const query of searchQueries) {
    try {
      if (onProgress) onProgress(`Searching: "${query}"`);

      const resp = await client.responses.create({
        model,
        tools: [{ type: "web_search_preview" }],
        input: `Search the web for factual information about: ${query}\n\nProvide a concise summary of the key facts, dates, events, and details you find. Focus on chronological information, specific dates, and verifiable facts. Be thorough but concise.`,
      });

      const text = resp.output_text || "";
      if (text.trim()) {
        allResults.push(`### Search: "${query}"\n${text.trim()}`);
        completedQueries.push(query);
      }
    } catch (err) {
      console.error(`Web search failed for "${query}":`, err.message);
      // Continue with other queries
    }
  }

  return {
    results: allResults.join("\n\n"),
    searchQueries: completedQueries,
  };
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
 * Classify user intent -- returns { intent, search_queries, summary }
 */
async function classifyIntent(query) {
  const prompt = CLASSIFY_PROMPT.replace("{query}", query);
  try {
    const result = await llmCall(prompt, 500);
    return result;
  } catch (err) {
    // Fallback: assume research if classification fails
    return {
      intent: "research",
      search_queries: [query],
      summary: "Classification failed, defaulting to research",
    };
  }
}

/**
 * Web search -- uses OpenAI web_search_preview tool to gather factual context.
 * Returns { results: string, searchQueries: string[] }
 */
async function webSearch(queries, onProgress) {
  if (!queries || !queries.length) return { results: "", searchQueries: [] };
  return webSearchOpenAI(queries, onProgress);
}

module.exports = {
  llmCall,
  llmCallStream,
  classifyIntent,
  webSearch,
  RESEARCH_PROMPT,
  RESEARCH_PROMPT_NOSEARCH,
  REFINE_PROMPT,
  MERGE_PROMPT,
  CLASSIFY_PROMPT,
  detectProvider,
};
