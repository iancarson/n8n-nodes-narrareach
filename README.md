# n8n-nodes-narrareach

An n8n community node for scheduling and managing Narrareach articles and Notes. See the
[Narrareach n8n Substack integration guide](https://www.narrareach.com/integrations/n8n) for
supported destinations, setup steps, plan requirements, and current limitations.

## Operations

- Schedule an article for Substack, Medium, LinkedIn, or X.
- Schedule a Note for Narrareach-supported social destinations.
- Read an article schedule, Note, or asynchronous operation status.
- Reschedule an article or Note.
- Cancel an article or Note before publication.

Every create action requires a stable idempotency key. Use the source record ID from your RSS,
CMS, database, or content calendar so retrying an n8n execution cannot create a duplicate.

For Substack articles, **Substack Access** controls whether the article is **Free for Everyone**
or **Paid Subscribers Only**. It is separate from **Send to Newsletter**, which controls email
delivery. In a Notion workflow, add an `Access` select property with `Free` and `Paid` options,
then map it to **Substack Access**. The included Notion starter workflow demonstrates that mapping.
If only one Substack publication is active, Narrareach selects it automatically. If you have
several, enter the exact publication name, handle, or URL in **Substack Publication**.

Inline HTML video from RSS/Hugo sources is preserved for Substack articles. When an article
contains video, select Substack as its only destination. Medium, LinkedIn, and X article requests
with inline video fail before a schedule is accepted, so the source content is never silently
changed. Map the RSS item's article link into **Source URL** so relative Hugo video paths resolve
before scheduling. Create a separate video-free article action when those destinations are also
needed.

YouTube iframe input publishes as an inline embed on Substack and remains visible as a canonical
link on selected destinations that cannot embed it. Vimeo iframe input is preserved as a canonical
link on every destination. Narrareach returns a warning when a destination receives the link
fallback; it does not remove that destination or silently drop the video reference.

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
