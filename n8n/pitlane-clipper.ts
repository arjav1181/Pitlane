import {
  expr,
  ifElse,
  newCredential,
  node,
  sticky,
  trigger,
  workflow,
} from "@n8n/workflow-sdk";

/**
 * Clipping somebody else's long video or stream into vertical shorts.
 *
 * OpusClip and ScaleReach sell one loop: paste a link, get captioned 9:16
 * clips. This workflow is that loop against the Pitlane clipper, plus the part
 * those tools cannot do for this channel - it publishes the clips as Shorts on
 * the same OAuth credential the render pipeline already uses.
 *
 * It is a webhook first: anything that can POST JSON can ask for clips. The
 * manual trigger is the same request with the fields typed into Clip Config,
 * so both paths exercise one code path.
 */

const clipWebhook = trigger({
  type: "n8n-nodes-base.webhook",
  version: 2.1,
  config: {
    name: "Clip Webhook",
    parameters: {
      httpMethod: "POST",
      path: "pitlane-clips",
      // The render takes minutes, so the caller is answered immediately and
      // the clips are published in the background.
      responseMode: "onReceived",
      options: { noResponseBody: false },
    },
    position: [-420, 160],
  },
  output: [
    {
      body: {
        sourceUrl: "https://www.youtube.com/watch?v=...",
        count: 3,
        uploadToYouTube: false,
      },
    },
  ],
});

const clipManual = trigger({
  type: "n8n-nodes-base.manualTrigger",
  version: 1,
  config: {
    name: "Clip One Video",
    parameters: {},
    position: [-420, 380],
  },
  output: [{}],
});

const clipConfig = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Clip Config",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: "api-base",
            name: "apiBase",
            value: "https://abc1181-whisper.hf.space/api/v1",
            type: "string",
          },
          {
            id: "api-key",
            name: "apiKey",
            value: "pl_moBoXbQfY_WdFmWN5l1oBIzBAgb0ll_4vb7PO37vXQQ",
            type: "string",
          },
          {
            id: "source-url",
            name: "sourceUrl",
            value: "",
            type: "string",
          },
          { id: "clip-count", name: "count", value: 3, type: "number" },
          { id: "clip-min", name: "minSeconds", value: 20, type: "number" },
          { id: "clip-max", name: "maxSeconds", value: 55, type: "number" },
          { id: "clip-fit", name: "fit", value: "blur", type: "string" },
          { id: "clip-captions", name: "captions", value: true, type: "boolean" },
          { id: "clip-hook", name: "hook", value: true, type: "boolean" },
          { id: "clip-live", name: "liveFromStart", value: false, type: "boolean" },
          { id: "clip-window-start", name: "startSeconds", value: 0, type: "number" },
          { id: "clip-window-end", name: "endSeconds", value: 0, type: "number" },
          { id: "clip-source-cap", name: "maxSourceMinutes", value: 60, type: "number" },
          {
            id: "clip-upload",
            name: "uploadToYouTube",
            value: false,
            type: "boolean",
          },
          { id: "clip-privacy", name: "privacyStatus", value: "public", type: "string" },
          { id: "clip-category", name: "categoryId", value: "2", type: "string" },
          { id: "clip-tags", name: "tags", value: "shorts,automotive,cars,clip", type: "string" },
          {
            id: "clip-llm-model",
            name: "llmModel",
            value: "gemini/gemini-flash-lite-latest",
            type: "string",
          },
          {
            id: "clip-llm-fallback",
            name: "llmFallbackModels",
            value: "auto/qwen,gemini/gemini-2.5-flash",
            type: "string",
          },
          { id: "clip-poll", name: "pollSeconds", value: 30, type: "number" },
          { id: "clip-max-wait", name: "maxWaitMinutes", value: 45, type: "number" },
        ],
      },
    },
    position: [-180, 280],
  },
  output: [
    {
      apiBase: "https://abc1181-whisper.hf.space/api/v1",
      sourceUrl: "https://www.youtube.com/watch?v=...",
      count: 3,
      uploadToYouTube: false,
    },
  ],
});

const validateRequest = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Validate Clip Request",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: `const cfg = $input.first().json;
const body = cfg.body && typeof cfg.body === 'object' ? cfg.body : {};

// Webhook fields win over the typed-in config, and an empty string counts as
// absent so a form that sends "" gets the default instead of a broken value.
const pick = (name, fallback) => {
  const value = body[name];
  return value === undefined || value === null || value === '' ? fallback : value;
};

const sourceUrl = String(pick('sourceUrl', cfg.sourceUrl || '')).trim();
if (!/^https?:\\/\\//i.test(sourceUrl)) {
  throw new Error('No source video. Set sourceUrl in Clip Config, or POST {"sourceUrl":"https://..."} to the webhook.');
}

const count = Math.max(1, Math.min(10, Math.round(Number(pick('count', cfg.count || 3)))));
const minSeconds = Math.max(5, Math.min(120, Number(pick('minSeconds', cfg.minSeconds || 20))));
const maxSeconds = Math.max(minSeconds + 1, Math.min(180, Number(pick('maxSeconds', cfg.maxSeconds || 55))));

const clipBody = {
  sourceUrl: sourceUrl,
  count: count,
  minSeconds: minSeconds,
  maxSeconds: maxSeconds,
  fit: String(pick('fit', cfg.fit || 'blur')) === 'crop' ? 'crop' : 'blur',
  captions: pick('captions', cfg.captions !== false) !== false,
  hook: pick('hook', cfg.hook !== false) !== false,
  liveFromStart: pick('liveFromStart', cfg.liveFromStart === true) === true,
  maxSourceMinutes: Math.max(1, Math.min(240, Number(pick('maxSourceMinutes', cfg.maxSourceMinutes || 60)))),
  providers: {
    llm: 'openai-compatible',
    llmModel: cfg.llmModel || 'gemini/gemini-flash-lite-latest',
    llmAuthType: 'auto',
    llmFallbackModels: String(cfg.llmFallbackModels || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean),
  },
  metadata: {
    source: 'n8n-clipper',
    requestedBy: 'n8n',
  },
};

const title = String(pick('title', cfg.title || '')).trim();
if (title) clipBody.title = title;

// A stream window is optional, but when both ends are given the clipper reads
// only that span, which keeps a six-hour broadcast from costing six hours of
// transcription.
const startSeconds = Number(pick('startSeconds', cfg.startSeconds || 0));
const endSeconds = Number(pick('endSeconds', cfg.endSeconds || 0));
if (Number.isFinite(startSeconds) && startSeconds > 0) clipBody.startSeconds = startSeconds;
if (Number.isFinite(endSeconds) && endSeconds > startSeconds) clipBody.endSeconds = endSeconds;

const uploadToYouTube = pick('uploadToYouTube', cfg.uploadToYouTube === true) === true;

return [{
  sourceUrl: sourceUrl,
  clipBody: clipBody,
  idempotencyKey: 'clip-' + $execution.id + '-' + Date.now(),
  uploadToYouTube: uploadToYouTube,
  privacyStatus: String(pick('privacyStatus', cfg.privacyStatus || 'public')),
  categoryId: String(pick('categoryId', cfg.categoryId || '2')),
  tags: String(cfg.tags || 'shorts,automotive,cars,clip'),
  apiBase: cfg.apiBase,
  apiKey: cfg.apiKey,
}];`,
    },
    position: [60, 280],
  },
  output: [
    {
      sourceUrl: "https://www.youtube.com/watch?v=...",
      clipBody: { sourceUrl: "https://www.youtube.com/watch?v=...", count: 3 },
      idempotencyKey: "clip-1-1763500000000",
      uploadToYouTube: false,
      privacyStatus: "public",
      categoryId: "2",
      tags: "shorts,automotive,cars,clip",
      apiBase: "https://abc1181-whisper.hf.space/api/v1",
      apiKey: "pl_...",
    },
  ],
});

const createClipJob = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.5,
  config: {
    name: "Create Clip Job",
    parameters: {
      method: "POST",
      url: expr("{{ $json.apiBase }}/clips"),
      sendHeaders: true,
      specifyHeaders: "keypair",
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "Idempotency-Key", value: expr("{{ $json.idempotencyKey }}") },
          { name: "X-API-Key", value: expr("{{ $json.apiKey }}") },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: expr("{{ JSON.stringify($json.clipBody) }}"),
      options: { timeout: 60000 },
    },
    position: [300, 280],
  },
  output: [
    {
      id: "00000000-0000-0000-0000-000000000000",
      kind: "clip",
      topic: "Clips from www.youtube.com",
      status: "queued",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
});

const waitForClip = node({
  type: "n8n-nodes-base.wait",
  version: 1.1,
  config: {
    name: "Wait for Clip",
    parameters: {
      resume: "timeInterval",
      amount: expr('{{ $("Clip Config").first().json.pollSeconds }}'),
      unit: "seconds",
    },
    position: [540, 280],
  },
  output: [
    {
      id: "00000000-0000-0000-0000-000000000000",
      status: "queued",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
});

const pollClipJob = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.5,
  config: {
    name: "Poll Clip Job",
    parameters: {
      method: "GET",
      url: expr('{{ $("Clip Config").first().json.apiBase }}/jobs/{{ $json.id }}'),
      sendHeaders: true,
      specifyHeaders: "keypair",
      headerParameters: {
        parameters: [
          { name: "X-API-Key", value: expr('{{ $("Clip Config").first().json.apiKey }}') },
        ],
      },
      options: { timeout: 30000 },
    },
    position: [780, 280],
  },
  output: [
    {
      id: "00000000-0000-0000-0000-000000000000",
      status: "running",
      stages: { source: { status: "done" }, transcript: { status: "running" } },
    },
  ],
});

const clipProgress = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Clip Progress",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: `const job = $input.first().json;
const cfg = $('Clip Config').first().json;
const created = Date.parse(job.createdAt || '');
const elapsedMin = created ? Math.round((Date.now() - created) / 60000) : 0;
const limit = Number(cfg.maxWaitMinutes || 45);

const stages = job.stages || {};
const names = Object.keys(stages);
const running = names.filter((name) => stages[name] && stages[name].status === 'running');
const done = names.filter((name) => stages[name] && stages[name].status === 'done');

// A clipper is slower than a render because it transcribes before it cuts, and
// a quiet watchdog is how a job is found dead two hours later.
if (elapsedMin > limit && job.status !== 'completed') {
  throw new Error(
    'Timed out after ' + elapsedMin + ' minutes waiting for clip job ' + job.id +
    ' (status ' + job.status + ', stage ' + (running[0] || 'unknown') + ')',
  );
}

return [{
  id: job.id,
  status: job.status,
  topic: job.topic,
  elapsedMinutes: elapsedMin,
  stage: running[0] || (done.length ? done[done.length - 1] : 'queued'),
  jobError: String(job.error || ''),
  source: job.source || null,
  clips: Array.isArray(job.clips) ? job.clips : [],
  clipLinks: job.links && Array.isArray(job.links.clips) ? job.links.clips : [],
  clipsIndex: job.links ? job.links.clipsIndex : null,
  warnings: job.metadata && Array.isArray(job.metadata.warnings) ? job.metadata.warnings : [],
}];`,
    },
    position: [1020, 280],
  },
  output: [
    {
      id: "00000000-0000-0000-0000-000000000000",
      status: "running",
      stage: "transcript",
      elapsedMinutes: 3,
      clips: [],
      clipLinks: [],
    },
  ],
});

const clipDone = ifElse({
  version: 2.2,
  config: {
    name: "Clip Done?",
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: "clip-status-completed",
            leftValue: expr("{{ $json.status }}"),
            rightValue: "completed",
            operator: { type: "string", operation: "equals" },
          },
        ],
      },
    },
    position: [1260, 180],
  },
});

const clipFailed = ifElse({
  version: 2.2,
  config: {
    name: "Clip Failed?",
    parameters: {
      conditions: {
        combinator: "or",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: "clip-status-failed",
            leftValue: expr("{{ $json.status }}"),
            rightValue: "failed",
            operator: { type: "string", operation: "equals" },
          },
          {
            id: "clip-status-cancelled",
            leftValue: expr("{{ $json.status }}"),
            rightValue: "cancelled",
            operator: { type: "string", operation: "equals" },
          },
        ],
      },
    },
    position: [1500, 400],
  },
});

const reportFailure = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Report Clip Failure",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: `const job = $input.first().json;
const reason = job.jobError ? ': ' + job.jobError : '';
throw new Error('Clip job ' + job.id + ' ended as ' + job.status + ' at stage ' + job.stage + reason);`,
    },
    position: [1740, 520],
  },
  output: [{}],
});

const prepareClips = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Prepare Clips",
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: `const job = $input.first().json;
const cfg = $('Clip Config').first().json;
const clips = Array.isArray(job.clips) ? job.clips : [];
const links = Array.isArray(job.clipLinks) ? job.clipLinks : [];
if (clips.length === 0) {
  throw new Error('Clip job ' + job.id + ' completed but produced no clips.');
}

// The API returns artifact paths, not absolute URLs. The host comes from the
// configured API base so the download uses the same origin as the poll.
const origin = String(cfg.apiBase || '').replace(/\\/api\\/v1\\/?$/, '');
const sourceTitle = job.source && job.source.title ? String(job.source.title) : job.topic;
const sourceUrl = job.source && job.source.webpageUrl ? String(job.source.webpageUrl) : '';

// The SDK folds backslash-n inside a template literal into a real newline,
// which breaks a Code node's string literal. Build the separator at runtime.
const blankLine = String.fromCharCode(10, 10);

return clips.map((clip, index) => {
  const link = links[index] || '';
  const base = String(clip.suggestedTitle || clip.title || ('Clip ' + (index + 1)))
    .replace(/\\s+/g, ' ')
    .trim();
  const description = [];
  if (clip.suggestedDescription) description.push(String(clip.suggestedDescription).trim());
  // The clipper already writes a "Clipped from:" line with the URL. Only add
  // a second one when it did not, so a pasted description reads cleanly.
  if (sourceUrl && !description.some((line) => line.includes(sourceUrl))) {
    description.push('Full video: ' + sourceUrl);
  }
  description.push('#' + String(cfg.tags || 'shorts').split(',')[0].replace(/[^a-zA-Z0-9]/g, ''));

  return {
    // n8n reserves the key "index" on an item, so use a distinct name and
    // wrap each item in json below.
    clipNumber: index + 1,
    total: clips.length,
    clipId: job.id,
    sourceTitle: sourceTitle,
    sourceUrl: sourceUrl,
    videoUrl: link ? origin + link : '',
    title: (base + ' #Shorts').slice(0, 100),
    description: description.filter(Boolean).join(blankLine).slice(0, 4900),
    tags: String(cfg.tags || 'shorts,automotive,cars,clip'),
    privacyStatus: cfg.privacyStatus || 'public',
    categoryId: cfg.categoryId || '2',
    hook: clip.hook || '',
    startSeconds: clip.sourceStart || clip.start,
    endSeconds: clip.sourceEnd || clip.end,
    durationSeconds: clip.durationSeconds,
    score: clip.score,
  };
})
  .filter((item) => Boolean(item.videoUrl))
  // n8n reserves several top-level item keys. Wrapping in json is the
  // documented way to return arbitrary fields from a Code node.
  .map((item) => ({ json: item }));`,
    },
    position: [1740, 60],
  },
  output: [
    {
      index: 1,
      total: 3,
      clipId: "00000000-0000-0000-0000-000000000000",
      videoUrl: "https://abc1181-whisper.hf.space/api/v1/jobs/.../artifacts/clips/...",
      title: "Clip title #Shorts",
      description: "Clipped from: ...",
    },
  ],
});

const shouldUpload = ifElse({
  version: 2.2,
  config: {
    name: "Upload to YouTube?",
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [
          {
            id: "clip-upload-flag",
            leftValue: expr('{{ $("Validate Clip Request").first().json.uploadToYouTube }}'),
            rightValue: true,
            operator: { type: "boolean", operation: "true" },
          },
        ],
      },
    },
    position: [1980, 60],
  },
});

const downloadClip = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.5,
  config: {
    name: "Download Clip",
    parameters: {
      method: "GET",
      url: expr("{{ $json.videoUrl }}"),
      sendHeaders: true,
      specifyHeaders: "keypair",
      headerParameters: {
        parameters: [
          { name: "X-API-Key", value: expr('{{ $("Clip Config").first().json.apiKey }}') },
        ],
      },
      options: {
        timeout: 600000,
        response: { response: { responseFormat: "file", outputPropertyName: "video" } },
      },
    },
    position: [2220, -40],
  },
  output: [{}],
});

const uploadClip = node({
  type: "n8n-nodes-base.youTube",
  version: 1,
  config: {
    name: "Upload Clip as Short",
    parameters: {
      resource: "video",
      operation: "upload",
      title: expr('{{ $("Prepare Clips").first().json.title }}'),
      categoryId: expr('{{ $("Prepare Clips").first().json.categoryId }}'),
      binaryProperty: "video",
      options: {
        description: expr('{{ $("Prepare Clips").first().json.description }}'),
        tags: expr('{{ $("Prepare Clips").first().json.tags }}'),
        privacyStatus: expr('{{ $("Prepare Clips").first().json.privacyStatus }}'),
      },
    },
    credentials: { youTubeOAuth2Api: newCredential("YouTube account") },
    position: [2460, -40],
  },
  output: [{ id: { kind: "youtube#video", videoId: "dQw4w9WgXcQ" } }],
});

const publishedSummary = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Clip Published",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: "clip-outcome", name: "outcome", value: "published", type: "string" },
          {
            id: "clip-video-id",
            name: "videoId",
            value: expr('{{ $json.id && $json.id.videoId ? $json.id.videoId : "" }}'),
            type: "string",
          },
          {
            id: "clip-video-url",
            name: "videoUrl",
            value: expr(
              '{{ "https://www.youtube.com/shorts/" + ($json.id && $json.id.videoId ? $json.id.videoId : "") }}',
            ),
            type: "string",
          },
          {
            id: "clip-job-id",
            name: "jobId",
            value: expr('{{ $("Prepare Clips").first().json.clipId }}'),
            type: "string",
          },
          {
            id: "clip-source",
            name: "sourceUrl",
            value: expr('{{ $("Prepare Clips").first().json.sourceUrl }}'),
            type: "string",
          },
        ],
      },
    },
    position: [2700, -40],
  },
  output: [
    {
      outcome: "published",
      videoId: "dQw4w9WgXcQ",
      videoUrl: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    },
  ],
});

const clipsReady = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Clips Ready (not uploaded)",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: "ready-outcome", name: "outcome", value: "clipped", type: "string" },
          {
            id: "ready-job",
            name: "jobId",
            value: expr('{{ $json.clipId }}'),
            type: "string",
          },
          {
            id: "ready-title",
            name: "title",
            value: expr("{{ $json.title }}"),
            type: "string",
          },
          {
            id: "ready-url",
            name: "videoUrl",
            value: expr("{{ $json.videoUrl }}"),
            type: "string",
          },
          {
            id: "ready-hook",
            name: "hook",
            value: expr("{{ $json.hook }}"),
            type: "string",
          },
        ],
      },
    },
    position: [2220, 180],
  },
  output: [
    {
      outcome: "clipped",
      jobId: "00000000-0000-0000-0000-000000000000",
      title: "Clip title #Shorts",
      videoUrl: "https://abc1181-whisper.hf.space/api/v1/jobs/...",
    },
  ],
});

const configNote = sticky(
  `## How to ask for clips

**Webhook** - POST /webhook/pitlane-clips with a JSON body:

  {"sourceUrl": "https://www.youtube.com/watch?v=...", "count": 3, "minSeconds": 20, "maxSeconds": 55, "uploadToYouTube": true}

**Manual** - set sourceUrl in Clip Config and press Execute. Every other field has a default, and a field sent by the webhook wins over the config value.

### Fields
- sourceUrl - YouTube, Twitch, Kick, X, TikTok, or a direct .mp4 / .webm URL.
- count 1-10 clips; minSeconds / maxSeconds 5-180s per clip.
- fit - blur keeps the whole frame over a blurred fill, crop fills the frame and loses the sides.
- captions / hook - burn word-timed captions and the clip hook line.
- startSeconds / endSeconds - clip only this part of a long video or VOD.
- liveFromStart - for a live stream, read from the beginning of the broadcast.
- maxSourceMinutes - hard cap on how much is downloaded, because transcription cost scales with it.
- uploadToYouTube - publish each clip as a Short on the YouTube account channel. Off by default: a clip is somebody else's footage, so publishing it is a deliberate choice rather than a side effect.

Every clip carries the source title, channel and URL in its description, plus its own suggested title and hook.`,
  [clipConfig, validateRequest],
  { color: 3 },
);

const pipelineNote = sticky(
  `## What the clipper does

POST /api/v1/clips runs four stages on the Pitlane server and reports each one through the normal job record:

1. source - downloads the file with yt-dlp (or plain HTTP for a direct video URL) and keeps only the requested window.
2. transcript - transcribes locally with the Whisper aligner, so there is no per-minute speech API bill.
3. select - an editor model reads the timestamped transcript and picks self-contained moments with a hook; when the model is unavailable it falls back to speech-density windows.
4. render - one 1080x1920 ffmpeg pass per clip for the reframe, burned karaoke captions, hook line, source handle and loudness normalisation.

The job is polled every pollSeconds, and a job that exceeds maxWaitMinutes fails loudly instead of waiting forever.`,
  [createClipJob, waitForClip, pollClipJob, clipProgress],
  { color: 4 },
);

const youtubeNote = sticky(
  `## Publishing

Clips go to the channel behind the YouTube account OAuth2 credential, as Shorts (9:16 and under three minutes). The description keeps the clipper attribution line, the full-video link and the #Shorts tag.

Turn uploadToYouTube on to publish, or leave it off and review the clips at their artifact URLs first.`,
  [downloadClip, uploadClip, publishedSummary],
  { color: 5 },
);

export default workflow("pitlane-clipper", "Pitlane Clipper - Vertical Clips from Videos and Streams")
  .add(clipWebhook)
  .to(clipConfig)
  .to(validateRequest)
  .to(createClipJob)
  .to(waitForClip)
  .to(pollClipJob)
  .to(clipProgress)
  .to(clipDone)
  .to(prepareClips)
  .to(shouldUpload)
  .to(downloadClip)
  .to(uploadClip)
  .to(publishedSummary)
  .add(clipManual)
  .to(clipConfig)
  .add(clipDone.onFalse(clipFailed))
  .add(clipFailed.onTrue(reportFailure))
  .add(clipFailed.onFalse(waitForClip))
  .add(shouldUpload.onFalse(clipsReady))
  .add(configNote)
  .add(pipelineNote)
  .add(youtubeNote)
;
