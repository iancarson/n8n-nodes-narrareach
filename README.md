# n8n-nodes-narrareach

An n8n community node for scheduling and managing Narrareach articles and Notes, triaging and
replying to Substack reader activity, and reading Stats outcomes. See the
[Narrareach n8n Substack integration guide](https://www.narrareach.com/integrations/n8n) for
supported destinations, setup steps, plan requirements, and current limitations.

## Operations

- Schedule an article for Substack, Medium, LinkedIn, or X, either from new title and HTML or from
  an existing Narrareach draft (**Article Source → Existing Narrareach Draft** with its **Draft ID**).
- Schedule a Note for Narrareach-supported social destinations, or post it immediately
  (**Publish Timing → Post Now**).
- Read an article schedule, Note, or asynchronous operation status.
- Reschedule an article or Note.
- Cancel an article or Note before publication.
- List, triage, and reply to Substack reader activity (likes, comments, and restacks).
- Read stored Stats outcomes for a period.

Every create action, and **Reply to Reader Activity**, requires a stable idempotency key. Use the source record ID from your RSS,
CMS, database, or content calendar so retrying an n8n execution cannot create a duplicate.

## Picking destinations

Destination fields load their choices from your Narrareach account, so you can pick instead of
pasting IDs. Each field also accepts an expression, for example an ID mapped from an earlier node.

| Field | Lookup route |
| --- | --- |
| **LinkedIn Account** and **LinkedIn Page** (Notes) | `GET /api/v1/linkedin/destinations` |
| **Instagram Destinations → Account** (Notes) | `GET /api/v1/instagram/destinations` |
| **LinkedIn Article Author** and **LinkedIn Newsletter** (articles) | `GET /api/v1/linkedin/article-destinations` |
| **Medium Publication** (articles) | `GET /api/v1/medium/publications` |

The lookups need the same token scopes as the action that uses them: `notes:write` for the Note
fields and `articles:write` for the article fields.

## Notes

- **Publish Timing**: **Schedule** publishes at **Scheduled For**; **Post Now** publishes
  immediately and hides **Scheduled For**.
- **LinkedIn Account** and **LinkedIn Page**: leave both at their defaults to use the LinkedIn
  default set in Narrareach. When several destinations exist and none is set as default,
  Narrareach asks for one. Choose a **LinkedIn Page** to post as a Company Page; it requires the
  account that manages it. These fields are shown and sent only when LinkedIn is selected.
- **Instagram Destinations**: shown and sent only when Instagram is selected. Add up to 5 accounts,
  each once. Each row can have its own **Caption** (up to 2,200 characters); leave it empty to use
  **Note Content**. Leave the list empty to post to the Instagram default. Accounts marked
  *not available* cannot be targeted on your current allowance.
- **Additional Fields → First Reply**: a reply posted under the Note where the platform supports it.
  The response lists the platforms that accepted or omitted it.
- **Additional Fields → Platform Versions**: text written for Bluesky, LinkedIn, Threads, or X,
  delivered as written. Each version must fit that platform's character limit; platforms without a
  version are shortened automatically. Rows for platforms that are not selected are ignored.

## Articles

For Substack articles, **Substack Access** controls whether the article is **Free for Everyone**
or **Paid Subscribers Only**. It is separate from **Send to Newsletter**, which controls email
delivery. In a Notion workflow, add an `Access` select property with `Free` and `Paid` options,
then map it to **Substack Access**. The included Notion starter workflow demonstrates that mapping.
If only one Substack publication is active, Narrareach selects it automatically. If you have
several, enter the exact publication name, handle, or URL in **Substack Publication**.

To keep a free preview at the top of a paid Substack article, place a unique token such as
`{{NARRAREACH_PAYWALL}}` between the free and paid sections of **Content HTML**, then enter the
same token in **Paywall Marker**. The marker must appear exactly once. Narrareach removes it,
inserts Substack's native paywall at that position, and enables paid delivery. Substack renders
the appropriate subscribe or upgrade prompt for each reader. **Paywall Marker** is available only
for new articles, not for an existing draft.

**Schedule Timing → Different Time per Platform** replaces **Scheduled For** with **Platform
Schedules**: add one row per selected platform. The rows must match **Article Platforms** exactly.

**Additional Fields** for articles:

- **Medium Publication** and **Medium Notify Followers** (Medium only). With writer-only access to
  a publication, the story is submitted for editor review instead of going live at the scheduled
  time.
- **LinkedIn Article Author**, **LinkedIn Publication Type**, **LinkedIn Newsletter**, and
  **LinkedIn Share Commentary** (LinkedIn only). A newsletter needs **LinkedIn Publication Type**
  set to **Newsletter** and a **LinkedIn Newsletter** of the selected author.
- **Add Search Metadata**: generate SEO titles, descriptions, and a Substack slug where supported.
  Requires article SEO access.
- **Substack Connection ID** (Substack only, deprecated): prefer **Substack Publication**.

Platform-specific fields are sent only when their platform is selected, so a value left over from
an earlier configuration cannot fail another platform's request.

### Video in articles

- **YouTube and Vimeo embeds** (iframes in **Content HTML**): both stay inline on Medium. YouTube
  stays inline on Substack. Every other combination, including LinkedIn and X, keeps the video as
  a visible link, and Narrareach returns a warning naming those destinations. It does not remove a
  destination or drop the video reference.
- **Uploaded video files and HTML `<video>` elements** (from RSS/Hugo sources or **Article Media
  JSON**): Substack only. Select Substack as the only destination; a request that also includes
  Medium, LinkedIn, or X is rejected before anything is scheduled, so the source content is never
  silently changed. Create a separate video-free article action for those destinations. Map the
  RSS item's article link into **Source URL** so relative Hugo video paths resolve before
  scheduling.

## Cancelling a Note that may already be live

A Note that Narrareach is still verifying may already be published. **Cancel Schedule** returns
`UNCERTAIN_DELETE_CONFIRMATION_REQUIRED` for it. Turn on **Confirm Uncertain Delete** to remove
only the Narrareach record (`DELETE /api/v1/notes/{id}?confirm_uncertain=true`); a post that already
went live stays on the platform. The option applies to Notes only.

## Reader activity

- **List Reader Activities** (`GET /api/v1/reader-activities`): choose **State** (**Inbox** or
  **History**). **Additional Fields** add **Activity Type** (all, like, comment, restack),
  **Sort** (time or relevance), **Limit** (1–50), and **Cursor**. To read the next page, map
  `page.nextCursor` from the previous response into **Cursor** while `page.hasMore` is true.
- **Update Reader Activity** (`PATCH /api/v1/reader-activities/{id}`): moves an item to
  **Inbox** or **History** with **Triage State**.
- **Reply to Reader Activity** (`POST /api/v1/reader-activities/{id}/replies`): publishes
  **Reply Text** (up to 5,000 characters) under a replyable Substack comment and moves the item to
  History. Use the comment's activity ID as the **Idempotency Key** so a retried execution does
  not post the reply twice. The node sends the key in the request body.

**Substack Connection ID** is optional on all three actions. Leave it empty to use your default
Substack publication.

## Stats outcomes

**Get Stats Outcomes** (`GET /api/v1/stats/outcomes`) returns stored Stats for a **Period**: the
last day, 7, 30, or 90 days, or a **Custom Range** with **From** and **To** dates (`YYYY-MM-DD`,
ending before today in your account timezone). **Additional Fields** narrow the result by
**Platforms** (connected platforms only), **Content Types** (article, note, social post), and
**Publication ID**. It reads stored data and does not refresh Substack.

## Token scopes for reader activity and Stats

| Action | Required scope |
| --- | --- |
| **List Reader Activities** | `activity:read` |
| **Update Reader Activity**, **Reply to Reader Activity** | `activity:write` |
| **Get Stats Outcomes** | `notes:read` |

These actions also need a Narrareach plan that includes API access. Grant only the scopes your
workflow uses.

## Credentials

Create an automation token in Narrareach settings and paste it into the **Narrareach API**
credential. The default base URL is `https://www.narrareach.com`. n8n's credential test calls
`GET /api/v1/auth/check` to confirm the token is valid.

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

This package provides actions only; it has no trigger node yet. To start a workflow when a Note
publishes or fails, add n8n's built-in **Webhook** node (HTTP method `POST`), activate the workflow,
and paste its production URL under Webhooks in Narrareach Settings → Integrations → REST API &
webhooks. Copy the signing secret when it is shown, choose **Test** to send a `webhook.test` event,
then branch on `body.event` (`note.published` or `note.failed`). Scheduled Notes send events for
Substack, LinkedIn, X, Threads, Instagram, Facebook, TikTok, and Pinterest, and Notes posted right
away through the API send them for every platform. Articles do not send them yet, and scheduled
Bluesky Notes may not send them, so use **Get Status** for those. See
https://www.narrareach.com/docs/n8n.md for the payload and signature check.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## License

MIT

## When Substack asks for a code

Both **Schedule Article** and a later **Get Status** can return
`status: verification_required`. Add an **If** step for that status on both paths.
Keep `verification.connectionId`, `verification.draftId`, and, when present,
`verification.scheduleId` from that step. This is not confirmation of scheduling.

1. Choose **Confirm Substack Connection → Check Code Request** with the returned connection.
2. If no code request is waiting, choose **Request a Code**. If it returns `verified: true`, skip the form and code submission and go directly to step 4. Otherwise keep the returned `id`; an existing request uses `challenge.id` from Check Code Request.
3. Collect the user's code in an n8n form or approval step. Choose **Submit Your Code** with that code, the same connection, and the code request `id`.
4. If a schedule ID is available, use **Get Status** for that schedule. Keep polling if it is still waiting; do not create another article. If the original attempt returned only a draft ID, promptly retry **Schedule Article → Existing Draft** with that draft and the original time, audience, publication, and newsletter settings. Narrareach checks for a matching existing schedule before creating one. Do not recreate the draft.

For a failed **Reschedule**, check the saved time after confirmation. If the
requested change was not applied, retry that same time change on the original
schedule ID. Do not create another article.

Use an automation token with `articles:write`. Codes may come from email or an
authenticator app. Follow the returned message for an expired or incorrect code;
do not automatically retry code submissions. Avoid saving execution data containing
codes in n8n. Narrareach does not return or log submitted codes.

When changing an article request from new content to `draftId` (Existing Draft),
use a new `idempotencyKey`, then reuse that key only for retries of that exact
request. When retrying the unchanged original body, keep its original key.

Code entry needs the form/approval branch above; the node does not display a form
automatically. Only report scheduling or publishing after the article response
confirms it. Unsupported Substack security checks still need Substack’s own site.
