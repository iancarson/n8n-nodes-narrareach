# Changelog

## 0.4.0

### Added

- **Confirm Substack Connection** lets a workflow request a verification code and accept it through
  an n8n form or another input step, without sending the writer to Narrareach to sign in again.
- Check whether confirmation is needed, request a code, submit it, or cancel a code request.

### Fixed

- Scheduling and status checks now clearly report when Substack needs a code and retain the saved
  article and schedule details so the workflow can continue with the same article.
- Confirmation messages explain that confirming the connection does not itself schedule or publish
  an article. Existing schedules should be checked; unscheduled saved articles should be retried
  with their original settings.

### Changed

- The client header reports `n8n-nodes-narrareach/0.4.0`.
- The README explains code entry, retries, and scheduled Note webhook results.

Existing workflows keep their behaviour. To collect a code, connect the new operation to a form or
another input step in your workflow.

## 0.3.0

### Added

- **List Reader Activities** (`GET /api/v1/reader-activities`) with state, activity type, sort,
  cursor, limit, and Substack connection ID. Requires `activity:read`.
- **Update Reader Activity** (`PATCH /api/v1/reader-activities/{id}`) moves an item to Inbox or
  History (`triageState`). Requires `activity:write`.
- **Reply to Reader Activity** (`POST /api/v1/reader-activities/{id}/replies`) publishes a reply
  with a required idempotency key, sent in the body. Requires `activity:write`.
- **Get Stats Outcomes** (`GET /api/v1/stats/outcomes`) with period, custom from/to dates,
  platforms, content types, and publication ID. Requires `notes:read`.

### Changed

- The client header reports `n8n-nodes-narrareach/0.3.0`.

Existing workflows keep their behaviour; the new actions are additional operations.

## 0.2.0

### Added

- **Schedule Note → Publish Timing → Post Now** sends `mode: "now"` for immediate publishing.
- Note **Instagram Destinations**: target up to 5 Instagram accounts, each with an optional caption.
- Note **Additional Fields**: **First Reply** and per-platform **Platform Versions**.
- **Schedule Article → Article Source → Existing Narrareach Draft** schedules a draft by `draftId`.
- **Schedule Article → Schedule Timing → Different Time per Platform** sends `platformSchedules`.
- Article **Additional Fields**: Medium publication and follower notification, LinkedIn article
  author, publication type, newsletter, and share commentary, search metadata, and the deprecated
  Substack connection ID.
- Dropdowns loaded from the account for LinkedIn Note destinations, Instagram destinations,
  LinkedIn article authors and newsletters, and Medium publications. Expressions still work.
- **Cancel Schedule → Confirm Uncertain Delete** for Notes still being verified
  (`confirm_uncertain=true`).

### Changed

- LinkedIn Note destination fields are shown only when LinkedIn is selected.
- The client header reports `n8n-nodes-narrareach/0.2.0`.
- The README describes article video handling as implemented: YouTube and Vimeo embeds stay inline on
  Medium, YouTube stays inline on Substack, other embeds stay as links, and uploaded or HTML video is
  Substack-only.

Existing workflows keep their behaviour: new options default to the previous scheduled, shared-time,
new-article flow.
