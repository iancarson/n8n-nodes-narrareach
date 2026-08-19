# n8n-nodes-narrareach

An n8n community node for scheduling and managing Narrareach articles and Notes.

## Operations

- Schedule an article for Substack, Medium, LinkedIn, or X.
- Schedule a Note for Narrareach-supported social destinations.
- Read an article schedule, Note, or asynchronous operation status.
- Reschedule an article or Note.
- Cancel an article or Note before publication.

Every create action requires a stable idempotency key. Use the source record ID from your RSS,
CMS, database, or content calendar so retrying an n8n execution cannot create a duplicate.

Inline HTML video from RSS/Hugo sources is preserved for Substack articles. When an article
contains video, select Substack as its only destination. Medium, LinkedIn, and X article requests
with inline video fail before a schedule is accepted, so the source content is never silently
changed. Map the RSS item's article link into **Source URL** so relative Hugo video paths resolve
before scheduling. Create a separate video-free article action when those destinations are also
needed.

## Credentials

Create an automation token in Narrareach settings and paste it into the **Narrareach API**
credential. The default base URL is `https://www.narrareach.com`.

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

## Starter workflows

Import the JSON files in [`examples`](./examples) for RSS, Logseq, Notion, Google Docs, and
spreadsheet content-calendar starting points. Replace the placeholder field mappings with the
fields from your source. Use the source record's immutable ID as the idempotency key.

The RSS starter schedules 24 hours ahead and defaults to Substack-only so feeds containing inline
video are safe. After scheduling, use **Get Status** with the returned schedule ID; use **Cancel
Schedule** with the same ID to remove a future canary.

## Current scope

This first package provides actions. Published and failed triggers will follow after Narrareach's
public webhook API supports both article and Note lifecycle events with API-token registration.

## License

MIT
