import {
  expr,
  ifElse,
  languageModel,
  newCredential,
  node,
  outputParser,
  sticky,
  trigger,
  workflow,
} from "@n8n/workflow-sdk";

const everySixHours = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.4,
  config: {
    name: "Every 6 Hours",
    parameters: {
      rule: {
        interval: [{ field: "hours", hoursInterval: 6 }],
      },
    },
    position: [-180, 300],
  },
  output: [{}],
});

const pipelineConfig = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Pipeline Config",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: "niche",
            name: "niche",
            value:
              "Automotive history and engineering - brand histories (Dodge, Ferrari, Porsche, BMW, Lamborghini), how a specific engineering or business problem was solved, and the stories behind iconic cars and motorsport.",
            type: "string",
          },
          {
            id: "search-query",
            name: "searchQuery",
            value:
              "automotive history and engineering: brand histories, how an engineering or business problem was solved, and the stories behind iconic cars and motorsport",
            type: "string",
          },
          {
            id: "api-base",
            name: "apiBase",
            value: "https://abc1181-whisper.hf.space/api/v1",
            type: "string",
          },
          {
            id: "api-key",
            name: "apiKey",
            value: "",
            type: "string",
          },
          { id: "llm-provider", name: "llmProvider", value: "openai-compatible", type: "string" },
          { id: "llm-base-url", name: "llmBaseUrl", value: "", type: "string" },
          {
            id: "llm-model",
            name: "llmModel",
            value: "gemini/gemini-flash-lite-latest",
            type: "string",
          },
          {
            id: "llm-fallback-models",
            name: "llmFallbackModels",
            value: "auto/qwen,gemini/gemini-2.5-flash,auto/best-free",
            type: "string",
          },
          { id: "llm-auth-type", name: "llmAuthType", value: "auto", type: "string" },
          { id: "tts-provider", name: "ttsProvider", value: "piper", type: "string" },
          { id: "skip-review", name: "skipReview", value: true, type: "boolean" },
          { id: "stock-provider", name: "stockProvider", value: "pexels", type: "string" },
          { id: "music-provider", name: "musicProvider", value: "bundled", type: "string" },
          { id: "platform", name: "platform", value: "youtube", type: "string" },
          { id: "category-id", name: "categoryId", value: "27", type: "string" },
          { id: "privacy-status", name: "privacyStatus", value: "private", type: "string" },
          {
            id: "agent-model",
            name: "agentModel",
            value: "gemini/gemini-flash-lite-latest",
            type: "string",
          },
          {
            id: "agent-fallback-model",
            name: "agentFallbackModel",
            value: "auto/qwen",
            type: "string",
          },
          {
            id: "metadata-model",
            name: "metadataModel",
            value: "gemini/gemini-flash-lite-latest",
            type: "string",
          },
          {
            id: "metadata-fallback-model",
            name: "metadataFallbackModel",
            value: "gemini/gemini-2.5-flash",
            type: "string",
          },
          { id: "poll-seconds", name: "pollSeconds", value: 30, type: "number" },
          { id: "max-wait-minutes", name: "maxWaitMinutes", value: 90, type: "number" },
        ],
      },
    },
    position: [60, 300],
  },
  output: [
    {
      niche:
        "Automotive history and engineering - brand histories (Dodge, Ferrari, Porsche, BMW, Lamborghini), how a specific engineering or business problem was solved, and the stories behind iconic cars and motorsport.",
      apiBase: "https://abc1181-whisper.hf.space/api/v1",
    },
  ],
});

const channelAnalytics = node({
  type: "n8n-nodes-base.youTube",
  version: 1,
  config: {
    name: "Channel Analytics",
    parameters: {
      part: ["snippet", "statistics"],
      filters: {},
      options: {},
    },
    credentials: { youTubeOAuth2Api: newCredential("YouTube account") },
    position: [320, 140],
  },
  output: [
    {
      id: "UC1234567890",
      snippet: { title: "My Channel" },
      statistics: { subscriberCount: "0", videoCount: "0", viewCount: "0" },
    },
  ],
});

const recentUploads = node({
  type: "n8n-nodes-base.youTube",
  version: 1,
  config: {
    name: "Recent Uploads",
    alwaysOutputData: true,
    parameters: {
      resource: "video",
      filters: {},
      options: {},
    },
    credentials: { youTubeOAuth2Api: newCredential("YouTube account") },
    position: [580, 140],
  },
  output: [
    {
      id: { videoId: "abcdefghijk" },
      snippet: { title: "Recent video title", publishedAt: "2026-01-01T00:00:00Z" },
    },
  ],
});

const composeBrief = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Compose Research Brief",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: "const cfg = $('Pipeline Config').first().json;\nconst channelRaw = $('Channel Analytics').first().json || {};\nconst channel = (Array.isArray(channelRaw.items) ? channelRaw.items[0] : channelRaw) || {};\nconst stats = channel.statistics || {};\nconst recentRaw = $('Recent Uploads').first().json || {};\nconst recent = Array.isArray(recentRaw) ? recentRaw : (Array.isArray(recentRaw.items) ? recentRaw.items : [recentRaw]);\nconst titles = recent.map(v => (v && v.snippet && v.snippet.title) || (v && v.title) || '').filter(Boolean).slice(0, 20);\nconst brief = [\n  'NICHE: ' + cfg.niche,\n  'CHANNEL: ' + ((channel.snippet && channel.snippet.title) || channel.title || 'unknown') + ' (subscribers: ' + (stats.subscriberCount || 'unknown') + ', total views: ' + (stats.viewCount || 'unknown') + ', videos: ' + (stats.videoCount || 'unknown') + ')',\n  'RECENT VIDEO TITLES:',\n  titles.length ? titles.map(t => ' - ' + t).join('\\n') : ' - (none found)',\n  '',\n  'Find video topics that are timely, specific and suited to a short vertical format: brand histories (Dodge, Ferrari, Porsche, BMW, Lamborghini), how a specific engineering or business problem was solved, and the stories behind iconic cars. Prefer evergreen topics with strong curiosity hooks.',\n].join('\\n');\nreturn [{ brief: brief, query: String(cfg.searchQuery || cfg.niche || '') }];",
    },
    position: [840, 300],
  },
  output: [{ brief: "NICHE: ...", query: "search query" }],
});

const openAiModel = languageModel({
  type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  version: 1.3,
  config: {
    name: "Research Model",
    parameters: {
      model: {
        __rl: true,
        mode: "id",
        value: expr('{{ $("Pipeline Config").first().json.agentModel }}'),
      },
      responsesApiEnabled: false,
      options: { maxTokens: 2000 },
    },
    credentials: { openAiApi: newCredential("OpenAI account") },
    position: [1080, 120],
  },
});

const openAiFallbackModel = languageModel({
  type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  version: 1.3,
  config: {
    name: "Research Fallback Model",
    parameters: {
      model: {
        __rl: true,
        mode: "id",
        value: expr('{{ $("Pipeline Config").first().json.agentFallbackModel }}'),
      },
      responsesApiEnabled: false,
      options: { maxTokens: 2000 },
    },
    credentials: { openAiApi: newCredential("OpenAI account") },
    position: [1080, 300],
  },
});

const searchWeb = node({
  type: "@tavily/n8n-nodes-tavily.tavily",
  version: 2.1,
  config: {
    name: "Search Web",
    parameters: {
      resource: "search",
      operation: "query",
      query: expr('{{ $("Compose Research Brief").first().json.query }}'),
      options: {
        max_results: 8,
        search_depth: "basic",
        include_answer: "basic",
      },
    },
    credentials: { tavilyApi: newCredential("Tavily account") },
    position: [1080, 480],
  },
  output: [{ results: [{ title: "t", url: "u", content: "c" }] }],
});

const formatResults = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Format Search Results",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const cfg = $('Pipeline Config').first().json;\nconst briefNode = $('Compose Research Brief').first().json || {};\nconst raw = $input.first().json || {};\n// Tavily returns the raw response object; tolerate an array wrapper too.\nconst resp = Array.isArray(raw) ? (raw[0] || {}) : raw;\nconst results = Array.isArray(resp.results) ? resp.results : (Array.isArray(raw) ? raw : []);\nconst blocks = results.slice(0, 8).map((r, i) => {\n  const title = String((r && r.title) || '').trim();\n  const url = String((r && r.url) || '').trim();\n  const content = String((r && r.content) || '').replace(/\\s+/g, ' ').trim().slice(0, 700);\n  return '[' + (i + 1) + '] ' + title + '\\nURL: ' + url + '\\n' + content;\n});\nconst answer = String((resp && resp.answer) || '').replace(/\\s+/g, ' ').trim().slice(0, 900);\nconst prompt = [\n  briefNode.brief || '',\n  '',\n  'SEARCH RESULTS - every topic must be grounded in one of these:',\n  blocks.length ? blocks.join('\\n\\n') : '(the search returned no results; answer from the brief alone and say so in the fact)',\n  answer ? '\\n\\nTAVILY SUMMARY: ' + answer : '',\n  '',\n  'Return ONLY a JSON object with this exact shape and nothing else: {\"topics\":[{\"topic\":\"a specific 4-12 word video topic\",\"angle\":\"why this is worth watching right now\",\"keywords\":[\"keyword\",\"keyword\"],\"source\":\"url of the search result\",\"fact\":\"the exact detail from that result that makes the topic true\"}]}.',\n  'Provide exactly 3 topics, ordered best first. Each topic must be self-contained and suitable for a 60 second vertical video.',\n  'Every topic must be grounded in a result above: cite that result URL and quote the exact supporting detail.',\n  'NEVER state a specific figure (engine size, year, horsepower, price, production count) that does not appear verbatim in a result - a wrong number ruins the video.',\n  'Do not repeat a topic that matches one of the recent video titles in the brief.',\n  'Never include markdown fences or commentary.',\n].join('\\n');\nreturn [{ prompt: prompt, resultCount: results.length }];",
    },
    position: [1320, 480],
  },
  output: [{ prompt: "...", resultCount: 8 }],
});

const researchAgent = node({
  type: "@n8n/n8n-nodes-langchain.chainLlm",
  version: 1.9,
  config: {
    name: "Research Niche Topics",
    parameters: {
      promptType: "define",
      needsFallback: true,
      text: expr('{{ $("Format Search Results").first().json.prompt }}'),
    },
    subnodes: { model: [openAiModel, openAiFallbackModel] },
    position: [1560, 300],
  },
  output: [
    {
      text: '{"topics":[{"topic":"...","angle":"...","keywords":["..."],"source":"https://...","fact":"..."}]}',
    },
  ],
});

const selectTopic = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Select Topic",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const raw = $input.first().json || {};\nlet parsed = raw && typeof raw.output === 'object' ? raw.output : null;\nif (!parsed) {\n  const text = String((raw && (raw.output || raw.text || raw.content)) || '');\n  const cleaned = text.replace(/\\x60\\x60\\x60json/gi, '').replace(/\\x60\\x60\\x60/g, '').trim();\n  const start = cleaned.indexOf('{');\n  const end = cleaned.lastIndexOf('}');\n  if (start !== -1 && end > start) {\n    try {\n      parsed = JSON.parse(cleaned.slice(start, end + 1));\n    } catch (err) {\n      parsed = null;\n    }\n  }\n  if (!parsed) {\n    const topics = [];\n    const re = /\"topic\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"/g;\n    let match;\n    while ((match = re.exec(cleaned)) !== null) {\n      topics.push({ topic: match[1].replace(/\\\\\"/g, '\"') });\n    }\n    if (topics.length) parsed = { topics: topics };\n  }\n}\nif (!parsed || !Array.isArray(parsed.topics) || parsed.topics.length === 0) {\n  throw new Error('Research agent returned no usable topics');\n}\nconst brief = $('Compose Research Brief').first().json.brief || '';\nreturn [{ candidates: parsed.topics, brief: brief }];",
    },
    position: [1560, 300],
  },
  output: [{ candidates: [{ topic: "A specific video topic" }], brief: "NICHE: ..." }],
});

const factCheckAgent = node({
  type: "@n8n/n8n-nodes-langchain.chainLlm",
  version: 1.9,
  config: {
    name: "Fact Check Topic",
    parameters: {
      promptType: "define",
      needsFallback: true,
      text: expr(
        'Candidate topics:\n{{ JSON.stringify($json.candidates.slice(0, 3)) }}\n\nPick the single candidate you are most confident is factually correct. If a specific figure in it is uncertain, remove the figure instead of guessing. Reply with ONLY a JSON object and nothing else: {"verified":true,"topic":"final topic title","fact":"the exact supporting detail","source":"url of that detail","angle":"why this is worth watching now","keywords":["k1","k2"],"note":"what you corrected, if anything"}. If none can be trusted, reply {"verified":false,"note":"why"}',
      ),
    },
    subnodes: { model: [openAiModel, openAiFallbackModel] },
    position: [1800, 300],
  },
  output: [
    {
      text: '{"verified":true,"topic":"...","fact":"...","source":"https://...","angle":"...","keywords":["..."],"note":""}',
    },
  ],
});

const groundTopic = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Ground Topic",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const raw = $input.first().json || {};\nconst text = String((raw && (raw.output || raw.text || raw.content)) || '');\nconst cleaned = text.replace(/\\x60\\x60\\x60json/gi, '').replace(/\\x60\\x60\\x60/g, '').trim();\nconst start = cleaned.indexOf('{');\nconst end = cleaned.lastIndexOf('}');\nlet check = null;\nif (start !== -1 && end > start) {\n  try {\n    check = JSON.parse(cleaned.slice(start, end + 1));\n  } catch (err) {\n    check = null;\n  }\n}\nif (!check || check.verified !== true || !check.topic) {\n  const detail = text.trim() ? text.slice(0, 300) : 'the model returned an empty response (often a provider content filter)';\n  throw new Error('No candidate topic passed the fact check: ' + ((check && check.note) || detail));\n}\nconst fact = String(check.fact || '');\nconst source = String(check.source || '');\nconst direction = [\n  'Use ONLY the verified fact below. Do not state any other specific figure (engine size, year, horsepower, production count) that is not in this brief.',\n  'VERIFIED FACT: ' + fact,\n  source ? 'SOURCE: ' + source : '',\n  'Build the short around that fact and its immediate context.',\n].filter(Boolean).join('\\n');\nreturn [{ topic: String(check.topic), angle: String(check.angle || ''), keywords: Array.isArray(check.keywords) ? check.keywords : [], fact: fact, source: source, note: String(check.note || ''), direction: direction }];",
    },
    position: [2040, 300],
  },
  output: [
    {
      topic: "A verified topic",
      angle: "Why now",
      keywords: ["kw"],
      fact: "the verified fact",
      source: "https://source",
      direction: "creative brief",
    },
  ],
});

const buildJobRequest = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Build Job Request",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const cfg = $('Pipeline Config').first().json;\nconst sel = $input.first().json;\nconst providers = {\n  llm: cfg.llmProvider || 'openai-compatible',\n  tts: cfg.ttsProvider || 'piper',\n  image: 'gemini',\n  stock: cfg.stockProvider || 'pexels',\n  music: cfg.musicProvider || 'bundled',\n  searchProvider: 'none',\n};\nif (cfg.llmBaseUrl) providers.llmBaseUrl = cfg.llmBaseUrl;\nif (cfg.llmModel) providers.llmModel = cfg.llmModel;\nif (cfg.llmFallbackModels) providers.llmFallbackModels = String(cfg.llmFallbackModels).split(',').map(function (m) { return m.trim(); }).filter(Boolean);\nif (cfg.llmAuthType) providers.llmAuthType = cfg.llmAuthType;\nconst slug = String(sel.topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);\nconst hourKey = new Date().toISOString().slice(0, 13);\nconst jobBody = {\n  topic: sel.topic,\n  platform: cfg.platform || 'youtube',\n  noAiAssets: true,\n  ...(sel.direction ? { direction: sel.direction } : {}),\n  providers: providers,\n  metadata: {\n    source: 'n8n-pipeline',\n    niche: cfg.niche,\n    angle: sel.angle,\n    keywords: sel.keywords,\n    fact: sel.fact,\n    source: sel.source,\n  },\n};\nreturn [{ jobBody: jobBody, idempotencyKey: 'n8n-' + slug + '-' + hourKey, topic: sel.topic, apiBase: cfg.apiBase }];",
    },
    position: [1800, 300],
  },
  output: [
    {
      jobBody: { topic: "..." },
      idempotencyKey: "n8n-topic-2026-01-01T00",
      topic: "A topic",
      apiBase: "https://abc1181-whisper.hf.space/api/v1",
    },
  ],
});

const createJob = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.5,
  config: {
    name: "Create OpenReels Job",
    parameters: {
      method: "POST",
      url: expr("{{ $json.apiBase }}/jobs"),
      sendHeaders: true,
      specifyHeaders: "keypair",
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "Idempotency-Key", value: expr("{{ $json.idempotencyKey }}") },
          { name: "X-API-Key", value: expr('{{ $("Pipeline Config").first().json.apiKey }}') },
        ],
      },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr("{{ $json.jobBody }}"),
      options: { timeout: 30000 },
    },
    position: [2040, 300],
  },
  output: [
    {
      id: "00000000-0000-0000-0000-000000000000",
      topic: "A topic",
      status: "queued",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
});

const waitBeforePoll = node({
  type: "n8n-nodes-base.wait",
  version: 1.1,
  config: {
    name: "Wait Before Polling",
    parameters: {
      resume: "timeInterval",
      amount: expr('{{ $("Pipeline Config").first().json.pollSeconds }}'),
      unit: "seconds",
    },
    position: [2280, 300],
  },
  output: [{ id: "00000000-0000-0000-0000-000000000000", topic: "A topic", status: "queued" }],
});

const pollJobStatus = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.5,
  config: {
    name: "Poll Job Status",
    parameters: {
      method: "GET",
      url: expr('{{ $("Pipeline Config").first().json.apiBase }}/jobs/{{ $json.id || $json.jobId }}'),
      sendHeaders: true,
      specifyHeaders: "keypair",
      headerParameters: {
        parameters: [
          { name: "X-API-Key", value: expr('{{ $("Pipeline Config").first().json.apiKey }}') },
        ],
      },
      options: { timeout: 30000 },
    },
    position: [2520, 300],
  },
  output: [
    {
      id: "00000000-0000-0000-0000-000000000000",
      topic: "A topic",
      status: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
});

const pollGuard = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Poll Timeout Guard",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const job = $input.first().json;\nconst cfg = $('Pipeline Config').first().json;\nconst created = Date.parse(job.createdAt || '');\nconst elapsedMin = created ? Math.round((Date.now() - created) / 60000) : 0;\nconst limit = Number(cfg.maxWaitMinutes || 25);\nif (elapsedMin > limit) {\n  throw new Error('Timed out after ' + elapsedMin + ' minutes waiting for job ' + job.id + ' (status ' + job.status + ')');\n}\nreturn [{ id: job.id, jobId: job.id, status: job.status, topic: job.topic, elapsedMinutes: elapsedMin, jobError: String(job.error || '') }];",
    },
    position: [2760, 300],
  },
  output: [
    {
      jobId: "00000000-0000-0000-0000-000000000000",
      status: "running",
      topic: "A topic",
      elapsedMinutes: 1,
    },
  ],
});

const jobCompleted = ifElse({
  version: 2.2,
  config: {
    name: "Job Completed?",
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: "status-completed",
            leftValue: expr("{{ $json.status }}"),
            rightValue: "completed",
            operator: { type: "string", operation: "equals" },
          },
        ],
      },
    },
    position: [3000, 200],
  },
});

const jobFailed = ifElse({
  version: 2.2,
  config: {
    name: "Job Failed?",
    parameters: {
      conditions: {
        combinator: "or",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: "status-failed",
            leftValue: expr("{{ $json.status }}"),
            rightValue: "failed",
            operator: { type: "string", operation: "equals" },
          },
          {
            id: "status-cancelled",
            leftValue: expr("{{ $json.status }}"),
            rightValue: "cancelled",
            operator: { type: "string", operation: "equals" },
          },
        ],
      },
    },
    position: [3000, 440],
  },
});

const failureSummary = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Report Failed Job",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const job = $input.first().json;\nconst reason = job.jobError ? ': ' + job.jobError : '';\nthrow new Error('OpenReels job ' + job.jobId + ' ended as ' + job.status + reason);",
    },
    position: [3260, 440],
  },
  output: [{}],
});

const fetchScore = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.5,
  config: {
    name: "Fetch Director Score",
    parameters: {
      method: "GET",
      url: expr('{{ $("Pipeline Config").first().json.apiBase }}/jobs/{{ $json.jobId }}/score'),
      options: { timeout: 30000 },
    },
    position: [3260, 120],
  },
  output: [{ scenes: [{ script_line: "First line of the script.", visual_type: "stock_image" }] }],
});

const composeMetadataPrompt = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Compose Metadata Prompt",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const score = $input.first().json;\nconst job = $('Poll Timeout Guard').first().json;\nconst grounded = $('Ground Topic').first().json || {};\nconst scenes = Array.isArray(score.scenes) ? score.scenes : [];\nconst script = scenes.map(s => s.script_line).filter(Boolean).join(' ');\nconst promptText = [\n  'Topic: ' + (job.topic || ''),\n  'Verified fact: ' + (grounded.fact || ''),\n  'Source: ' + (grounded.source || ''),\n  'Voiceover script: ' + (script || '(no script available)'),\n  '',\n  'Write YouTube metadata for this short vertical video.',\n  'Return ONLY a JSON object with keys title, description and tags. Title is a catchy string under 90 characters. Description is 2-3 sentences with a hook and a call to action. Tags is an array of 5 short strings.',\n  'No markdown fences, no commentary.',\n].join('\\n');\nreturn [{ jobId: job.jobId, topic: job.topic, promptText: promptText }];",
    },
    position: [3500, 120],
  },
  output: [
    { jobId: "00000000-0000-0000-0000-000000000000", topic: "A topic", promptText: "Topic: ..." },
  ],
});

const metadataModel = languageModel({
  type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  version: 1.3,
  config: {
    name: "Metadata Model",
    parameters: {
      model: {
        __rl: true,
        mode: "id",
        value: expr('{{ $("Pipeline Config").first().json.metadataModel }}'),
      },
      responsesApiEnabled: false,
      options: { maxTokens: 2000 },
    },
    credentials: { openAiApi: newCredential("OpenAI account") },
    position: [3740, 20],
  },
});

const metadataFallbackModel = languageModel({
  type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  version: 1.3,
  config: {
    name: "Metadata Fallback Model",
    parameters: {
      model: {
        __rl: true,
        mode: "id",
        value: expr('{{ $("Pipeline Config").first().json.metadataFallbackModel }}'),
      },
      responsesApiEnabled: false,
      options: { maxTokens: 2000 },
    },
    credentials: { openAiApi: newCredential("OpenAI account") },
    position: [3740, 300],
  },
});

const writeMetadata = node({
  type: "@n8n/n8n-nodes-langchain.agent",
  version: 3.1,
  config: {
    name: "Write Title and Description",
    parameters: {
      promptType: "define",
      text: expr("{{ $json.promptText }}"),
      needsFallback: true,
      options: {
        systemMessage:
          "You write metadata for short vertical YouTube videos in one specific niche. You always answer with a single raw JSON object and nothing else. Never use markdown fences.",
        maxIterations: 4,
      },
    },
    subnodes: { model: [metadataModel, metadataFallbackModel] },
    position: [3740, 160],
  },
  output: [{ output: '{"title":"...","description":"...","tags":["a","b"]}' }],
});

const parseMetadata = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Parse Video Metadata",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const prev = $('Compose Metadata Prompt').first().json;\nconst item = $input.first().json;\nconst raw = String(item.text || item.output || item.content || '');\nconst cleaned = raw.replace(/\\x60\\x60\\x60json/gi, '').replace(/\\x60\\x60\\x60/g, '').trim();\nconst start = cleaned.indexOf('{');\nconst end = cleaned.lastIndexOf('}');\nif (start === -1 || end === -1) {\n  throw new Error('Metadata model did not return JSON. Raw output: ' + raw.slice(0, 400));\n}\nconst meta = JSON.parse(cleaned.slice(start, end + 1));\nconst tags = Array.isArray(meta.tags) ? meta.tags.join(',') : String(meta.tags || '');\nreturn [{ jobId: prev.jobId, topic: prev.topic, videoTitle: String(meta.title || prev.topic).slice(0, 100), videoDescription: String(meta.description || ''), videoTags: tags }];",
    },
    position: [3980, 120],
  },
  output: [
    {
      jobId: "00000000-0000-0000-0000-000000000000",
      topic: "A topic",
      videoTitle: "Title",
      videoDescription: "Description",
      videoTags: "a,b,c",
    },
  ],
});

const downloadVideo = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.5,
  config: {
    name: "Download Rendered Video",
    parameters: {
      method: "GET",
      url: expr(
        '{{ $("Pipeline Config").first().json.apiBase }}/jobs/{{ $("Parse Video Metadata").first().json.jobId }}/video',
      ),
      options: {
        timeout: 180000,
        response: { response: { responseFormat: "file", outputPropertyName: "video" } },
      },
    },
    position: [4200, 120],
  },
  output: [{}],
});

const uploadVideo = node({
  type: "n8n-nodes-base.youTube",
  version: 1,
  config: {
    name: "Upload to YouTube",
    parameters: {
      resource: "video",
      operation: "upload",
      title: expr('{{ $("Parse Video Metadata").first().json.videoTitle }}'),
      categoryId: expr('{{ $("Pipeline Config").first().json.categoryId }}'),
      binaryProperty: "video",
      options: {
        description: expr('{{ $("Parse Video Metadata").first().json.videoDescription }}'),
        tags: expr('{{ $("Parse Video Metadata").first().json.videoTags }}'),
        privacyStatus: expr('{{ $("Pipeline Config").first().json.privacyStatus }}'),
      },
    },
    credentials: { youTubeOAuth2Api: newCredential("YouTube account") },
    position: [4460, 120],
  },
  output: [
    {
      id: { kind: "youtube#video", videoId: "dQw4w9WgXcQ" },
      snippet: { title: "Title" },
    },
  ],
});

const publishedSummary = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Published Summary",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: "outcome", name: "outcome", value: "published", type: "string" },
          {
            id: "published-id",
            name: "publishedVideoId",
            value: expr('{{ $json.id && $json.id.videoId ? $json.id.videoId : "" }}'),
            type: "string",
          },
          {
            id: "published-url",
            name: "publishedUrl",
            value: expr(
              '{{ "https://www.youtube.com/watch?v=" + ($json.id && $json.id.videoId ? $json.id.videoId : "") }}',
            ),
            type: "string",
          },
          {
            id: "published-job",
            name: "publishedJobId",
            value: expr('{{ $("Parse Video Metadata").first().json.jobId }}'),
            type: "string",
          },
        ],
      },
    },
    position: [4700, 120],
  },
  output: [
    {
      outcome: "published",
      publishedVideoId: "dQw4w9WgXcQ",
      publishedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      publishedJobId: "00000000-0000-0000-0000-000000000000",
    },
  ],
});

const configNote = sticky(
  "## Configure before the first run\n\n1. **Pipeline Config** - `niche` is the topic area, `searchQuery` is the query sent to Tavily, and `apiBase` points at the OpenReels server that renders. The channel comes from the YouTube OAuth2 credential (channel analytics and uploads both act on the channel it is authorized for).\n2. `llmProvider` / `llmBaseUrl` / `llmModel` / `llmFallbackModels` / `llmAuthType` - the render engine's model chain. `llmModel` is the primary model and `llmFallbackModels` is a comma-separated backup list tried in order. Empty values fall back to the OPENREELS_LLM_* secrets on the OpenReels server.\n3. `agentModel` / `agentFallbackModel` drive the topic research, `metadataModel` / `metadataFallbackModel` drive the title and description. Both pairs use n8n's built-in model fallback and share the `OpenAI account` gateway credential.\n4. `pollSeconds` and `maxWaitMinutes` control how often the render is polled and when the run gives up.\n\nCredentials: `Tavily account` for the web search, `OpenAI account` for the models, `YouTube account` for the channel.\n\nNo-AI-assets mode is on: videos use stock footage plus procedural text cards, so no image or video API key is needed.",
  [pipelineConfig],
  { color: 3 },
);

const loopNote = sticky(
  "## Render polling\n\nThe job is queued on the OpenReels server and polled every `pollSeconds` until it reaches a terminal state. The `Poll Timeout Guard` fails the run when the job exceeds `maxWaitMinutes`, so a stuck render cannot loop forever.",
  [waitBeforePoll, pollJobStatus, pollGuard],
  { color: 4 },
);

export default workflow("openreels-video-pipeline", "OpenReels Auto Video Pipeline")
  .add(everySixHours)
  .to(pipelineConfig)
  .to(channelAnalytics)
  .to(recentUploads)
  .to(composeBrief)
  .to(searchWeb)
  .to(formatResults)
  .to(researchAgent)
  .to(selectTopic)
  .to(factCheckAgent)
  .to(groundTopic)
  .to(buildJobRequest)
  .to(createJob)
  .to(waitBeforePoll)
  .to(pollJobStatus)
  .to(pollGuard)
  .to(jobCompleted)
  .to(fetchScore)
  .to(composeMetadataPrompt)
  .to(writeMetadata)
  .to(parseMetadata)
  .to(downloadVideo)
  .to(uploadVideo)
  .to(publishedSummary)
  .add(jobCompleted.onFalse(jobFailed))
  .add(jobFailed.onTrue(failureSummary))
  .add(jobFailed.onFalse(waitBeforePoll))
  .add(configNote)
  .add(loopNote)
  .group("1. Configure", [pipelineConfig], {
    description: "Set niche, channel, API base and polling limits here",
  })
  .group(
    "2. Research",
    [
      channelAnalytics,
      recentUploads,
      composeBrief,
      searchWeb,
      formatResults,
      researchAgent,
      openAiModel,
      openAiFallbackModel,
      selectTopic,
      factCheckAgent,
      groundTopic,
    ],
    {
      description:
        "Read channel analytics, research the niche with Tavily and pick the best topic",
    },
  )
  .group(
    "3. Produce",
    [
      buildJobRequest,
      createJob,
      waitBeforePoll,
      pollJobStatus,
      pollGuard,
      jobCompleted,
      jobFailed,
      failureSummary,
      fetchScore,
    ],
    { description: "Queue the OpenReels job and poll until the render finishes" },
  )
  .group(
    "4. Publish",
    [
      composeMetadataPrompt,
      metadataModel,
      metadataFallbackModel,
      writeMetadata,
      parseMetadata,
      downloadVideo,
      uploadVideo,
      publishedSummary,
    ],
    { description: "Write title and description, download the mp4 and publish it to YouTube" },
  );
