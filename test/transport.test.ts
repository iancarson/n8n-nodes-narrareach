import {
	buildInstagramDestinations,
	buildNarrareachRequest,
	buildPlatformSchedules,
	buildPlatformVersions,
	commaSeparatedValues,
	parseOptionalJson,
	resolveRelativeArticleMediaUrls,
	withoutUndefined,
} from '../nodes/Narrareach/transport';
import { Narrareach } from '../nodes/Narrareach/Narrareach.node';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string) {
	assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

assertJsonEqual(
	buildNarrareachRequest({ operation: 'scheduleArticle', body: { title: 'Launch' } }),
	{ method: 'POST', path: '/api/v1/articles', body: { title: 'Launch' } },
	'article schedule request must use the public articles route',
);

assertJsonEqual(
	buildNarrareachRequest({ operation: 'scheduleNote', body: { content: 'Hi' } }),
	{
		method: 'POST',
		path: '/api/v1/notes',
		body: { content: 'Hi' },
	},
	'note schedule request must use the public notes route',
);

assertJsonEqual(
	buildNarrareachRequest({ operation: 'getStatus', resource: 'article', id: 'post/id' }),
	{ method: 'GET', path: '/api/v1/article-schedules/post%2Fid' },
	'status request must encode the schedule ID',
);
assertJsonEqual(
	buildNarrareachRequest({
		operation: 'reschedule',
		resource: 'note',
		id: 'note-1',
		body: { scheduledFor: '2026-09-01T10:00:00.000Z' },
	}),
	{
		method: 'PATCH',
		path: '/api/v1/notes/note-1',
		body: { scheduledFor: '2026-09-01T10:00:00.000Z' },
	},
	'note reschedule request must preserve the body',
);
assertJsonEqual(
	buildNarrareachRequest({ operation: 'cancel', resource: 'article', id: 'article-1' }),
	{ method: 'DELETE', path: '/api/v1/article-schedules/article-1' },
	'article cancel request must use DELETE',
);

assertJsonEqual(
	buildNarrareachRequest({ operation: 'cancel', resource: 'note', id: 'note/1', confirmUncertain: true }),
	{ method: 'DELETE', path: '/api/v1/notes/note%2F1?confirm_uncertain=true' },
	'confirmed note cancel must pass confirm_uncertain=true',
);
assertJsonEqual(
	buildNarrareachRequest({ operation: 'cancel', resource: 'article', id: 'article-1', confirmUncertain: true }),
	{ method: 'DELETE', path: '/api/v1/article-schedules/article-1' },
	'article cancel must not send the Notes-only confirm_uncertain flag',
);
assertJsonEqual(
	buildNarrareachRequest({
		operation: 'listReaderActivities',
		query: { state: 'inbox', cursor: undefined, limit: 10 },
	}),
	{ method: 'GET', path: '/api/v1/reader-activities?state=inbox&limit=10' },
	'reader activity list must drop undefined query parameters',
);
assertJsonEqual(
	buildNarrareachRequest({
		operation: 'updateReaderActivity',
		id: 'activity/1',
		query: { substackConnectionId: undefined },
		body: { triageState: 'INBOX' },
	}),
	{ method: 'PATCH', path: '/api/v1/reader-activities/activity%2F1', body: { triageState: 'INBOX' } },
	'reader activity update must encode the ID and omit an empty query string',
);
let missingActivityError: unknown;
try {
	buildNarrareachRequest({ operation: 'replyToReaderActivity', body: { text: 'Hi' } });
} catch (error) {
	missingActivityError = error;
}
assert(missingActivityError instanceof Error, 'a reply without an activity ID must be rejected');

assertJsonEqual(
	buildPlatformSchedules({
		schedule: [
			{ platform: 'SUBSTACK', scheduledFor: '2026-09-01T09:00:00.000Z' },
			{ platform: 'X', scheduledFor: '' },
		],
	}),
	[{ platform: 'SUBSTACK', scheduledFor: '2026-09-01T09:00:00.000Z' }],
	'platform schedules must drop incomplete rows',
);
assert(buildPlatformSchedules({}) === undefined, 'empty platform schedules must stay absent');
assertJsonEqual(
	buildInstagramDestinations({ destination: [{ accountId: 'ig_1', caption: 'Hi' }, { accountId: ' ig_2 ' }] }),
	[{ accountId: 'ig_1', caption: 'Hi' }, { accountId: 'ig_2' }],
	'Instagram destinations must match the API array-of-objects shape',
);
assert(buildInstagramDestinations(undefined) === undefined, 'missing Instagram destinations must stay absent');
assertJsonEqual(
	buildPlatformVersions(
		{ version: [{ platform: 'THREADS', content: ' Short ' }, { platform: 'X', content: 'Unselected' }] },
		['THREADS'],
	),
	{ THREADS: 'Short' },
	'platform versions must be keyed by selected platform',
);

let rejectedMutation = false;
try {
	buildNarrareachRequest({ operation: 'cancel', resource: 'operation', id: 'op-1' });
} catch (error) {
	rejectedMutation = error instanceof Error && error.message.includes('only be read');
}
assert(rejectedMutation, 'operation receipts must be read-only');

assertJsonEqual(
	parseOptionalJson('{"type":"doc"}'),
	{ type: 'doc' },
	'valid JSON must parse',
);
assert(parseOptionalJson('') === undefined, 'empty JSON must stay absent');
let rejectedJson = false;
try {
	parseOptionalJson('{');
} catch (error) {
	rejectedJson = error instanceof SyntaxError;
}
assert(rejectedJson, 'invalid JSON must be rejected before the API call');
assertJsonEqual(
	commaSeparatedValues('one, two, ,three'),
	['one', 'two', 'three'],
	'comma-separated values must be trimmed',
);
assertJsonEqual(
	withoutUndefined({ title: 'Post', subtitle: undefined }),
	{ title: 'Post' },
	'undefined fields must not reach the API',
);
assertJsonEqual(
	resolveRelativeArticleMediaUrls(
		'<video src="../../media/demo.mp4"></video><source src="//cdn.example.com/trailer.mp4">',
		'https://example.com/posts/demo/',
	),
	'<video src="https://example.com/media/demo.mp4"></video><source src="https://cdn.example.com/trailer.mp4">',
	'n8n should resolve relative Hugo video sources against the article URL',
);
assertJsonEqual(
	resolveRelativeArticleMediaUrls('<video src="javascript:alert(1)"></video>', 'https://example.com/post/'),
	'<video src="javascript:alert(1)"></video>',
	'n8n must not rewrite non-HTTP media schemes into trusted URLs',
);

const notePlatforms = new Narrareach().description.properties
	.find((property) => property.name === 'notePlatforms')?.options
	?.map((option) => option.value);
assertJsonEqual(
	notePlatforms,
	['SUBSTACK', 'LINKEDIN', 'X', 'BLUESKY', 'THREADS', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'PINTEREST'],
	'Schedule Note must expose exactly the platforms accepted by POST /api/v1/notes',
);

const publication = new Narrareach().description.properties
	.find((property) => property.name === 'publication');
assert(
	publication?.required !== true,
	'Schedule Article must allow the API to select the sole active Substack publication',
);
assertJsonEqual(
	publication?.displayOptions,
	{ show: { operation: ['scheduleArticle'], articlePlatforms: ['SUBSTACK'] } },
	'The Substack publication selector must be shown only for Substack article schedules',
);
