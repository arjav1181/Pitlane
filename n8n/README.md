# n8n workflow sources

The two production workflows on the team's n8n instance are authored with the
[n8n Workflow SDK](https://docs.n8n.io/source-control/export-import/) and kept
here as TypeScript, so a workflow can be reviewed and rebuilt if the instance
is lost.

| File | Workflow | Trigger |
| --- | --- | --- |
| `openreels-video-pipeline.ts` | OpenReels Auto Video Pipeline | Every six hours (00/06/12/18 UTC) |
| `pitlane-clipper.ts` | Pitlane Clipper | `POST /webhook/pitlane-clips`, or manual |

The video pipeline researches an automotive topic, fact-checks it, queues a
stock-only short and publishes it to the channel. The clipper takes a video or
stream URL, queues a clip job and either publishes the verticals as Shorts or
hands back their artifact URLs.

Both files are validated before they are applied:

```bash
# Serve this directory and pass the file to the n8n MCP validator.
python3 -m http.server 8899 --bind 127.0.0.1
# validate_workflow(code: <contents of pitlane-clipper.ts>)
```

A note on authoring: the SDK folds backslash-n inside a template literal into
a real newline, which produces an invalid string in a generated Code node.
Build separators at runtime (for example `String.fromCharCode(10, 10)`), and
wrap Code-node output items in `{ json: ... }` when they contain a field named
`index`, which n8n reserves.
