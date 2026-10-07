import type { IHttpRequestOptions } from 'n8n-workflow';

import { Narrareach, substackAudienceToPaidContent } from '../nodes/Narrareach/Narrareach.node';
import { getInstagramDestinations, getLinkedInPages, getMediumPublications } from '../nodes/Narrareach/loadOptions';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
	assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function executionContext(
	parameters: Record<string, unknown>,
	request: (options: IHttpRequestOptions) => unknown,
	continueOnFail = false,
) {
	return {
		getInputData: () => [{ json: { sourceId: 'source-1' } }],
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
		getCredentials: async () => ({
			apiToken: 'nrr_api_test',
			baseUrl: 'https://www.narrareach.com/',
		}),
		getNode: () => ({ name: 'Narrareach', type: 'narrareach', typeVersion: 1, position: [0, 0] }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async function (
				this: unknown,
				credentialType: string,
				options: IHttpRequestOptions,
			) {
				assert(credentialType === 'narrareachApi', 'the request must use Narrareach credentials');
				return request(options);
			},
		},
	};
}

async function testScheduleNoteExecution() {
	let capturedRequest: IHttpRequestOptions | null = null;
	const context = executionContext(
		{
			operation: 'scheduleNote',
			content: 'A concise update',
			contentJson: '{"type":"doc"}',
			notePlatforms: ['THREADS', 'BLUESKY'],
			scheduledFor: '2026-08-22T16:48:07.475+02:00',
			timezone: 'America/Toronto',
			imageUrls: 'https://cdn.example.com/one.jpg, https://cdn.example.com/two.jpg',
			videoUrls: '',
			threadsTopicTag: 'Independent publishing',
			idempotencyKey: 'source-1',
		},
		(options) => {
			capturedRequest = options;
			return { success: true, scheduled: [{ id: 'note-1' }] };
		},
	);

	const output = await new Narrareach().execute.call(context as never);

	assertEqual(capturedRequest, {
		method: 'POST',
		url: 'https://www.narrareach.com/api/v1/notes',
		json: true,
		headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.3.0' },
		body: {
			content: 'A concise update',
			contentJson: { type: 'doc' },
			platforms: ['THREADS', 'BLUESKY'],
			mode: 'schedule',
			scheduledFor: '2026-08-22T16:48:07.475+02:00',
			timezone: 'America/Toronto',
			imageUrls: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'],
			threadsTopicTag: 'Independent publishing',
			idempotencyKey: 'source-1',
		},
	}, 'Schedule Note must map parameters to the public Notes request');
	assertEqual(output, [[{
		json: { success: true, scheduled: [{ id: 'note-1' }] },
		pairedItem: 0,
	}]], 'Schedule Note must return the provider response with item pairing');
}

async function testScheduleNoteLinkedInDestination() {
	const bodies: unknown[] = [];
	const request = (options: IHttpRequestOptions) => {
		bodies.push(options.body);
		return { success: true };
	};
	const base = {
		operation: 'scheduleNote',
		content: 'A Page update',
		scheduledFor: '2026-08-22T16:48:07.475+02:00',
		idempotencyKey: 'source-1',
		linkedInAccountId: ' account_1 ',
		linkedInOrganizationUrn: 'urn:li:organization:123',
	};

	await new Narrareach().execute.call(
		executionContext({ ...base, notePlatforms: ['LINKEDIN', 'X'] }, request) as never,
	);
	await new Narrareach().execute.call(
		executionContext({ ...base, notePlatforms: ['X'] }, request) as never,
	);
	await new Narrareach().execute.call(
		executionContext({
			...base,
			notePlatforms: ['LINKEDIN'],
			linkedInAccountId: '',
			linkedInOrganizationUrn: '',
		}, request) as never,
	);

	const selectors = bodies.map((body) => {
		const { linkedInAccountId, linkedInOrganizationUrn } = body as Record<string, unknown>;
		return { linkedInAccountId, linkedInOrganizationUrn };
	});
	assertEqual(selectors, [
		{ linkedInAccountId: 'account_1', linkedInOrganizationUrn: 'urn:li:organization:123' },
		{},
		{},
	], 'LinkedIn selectors must be sent, trimmed, only with LinkedIn and only when set');
}

async function testScheduleArticleExecution() {
	let capturedRequest: IHttpRequestOptions | null = null;
	const context = executionContext(
		{
			operation: 'scheduleArticle',
			title: 'A Hugo article',
			subtitle: 'Imported through RSS',
			contentHtml: '<p>Before</p>{{NARRAREACH_PAYWALL}}<video><source src="../../media/demo.mp4" type="video/mp4"></video>',
			sourceUrl: 'https://example.com/posts/a-hugo-article/',
			articlePlatforms: ['SUBSTACK'],
			scheduledFor: '2026-08-22T16:48:07.475+02:00',
			timezone: 'America/Toronto',
			coverImageUrl: 'https://cdn.example.com/cover.jpg',
			mediaJson: '',
			tags: 'hugo, publishing',
			sendToNewsletter: true,
			substackAudience: 'paid',
			paywallMarker: '{{NARRAREACH_PAYWALL}}',
			idempotencyKey: 'source-1',
		},
		(options) => {
			capturedRequest = options;
			return { success: true, schedules: [{ id: 'article-1' }] };
		},
	);

	const output = await new Narrareach().execute.call(context as never);

	assertEqual(capturedRequest, {
		method: 'POST',
		url: 'https://www.narrareach.com/api/v1/articles',
		json: true,
		headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.3.0' },
		body: {
			title: 'A Hugo article',
			subtitle: 'Imported through RSS',
			contentHtml: '<p>Before</p>{{NARRAREACH_PAYWALL}}<video><source src="https://example.com/media/demo.mp4" type="video/mp4"></video>',
			platforms: ['SUBSTACK'],
			scheduledFor: '2026-08-22T16:48:07.475+02:00',
			timezone: 'America/Toronto',
			coverImage: { sourceType: 'url', url: 'https://cdn.example.com/cover.jpg' },
			tags: ['hugo', 'publishing'],
			sendToNewsletter: true,
			isPaidContent: true,
			paywallMarker: '{{NARRAREACH_PAYWALL}}',
			idempotencyKey: 'source-1',
		},
	}, 'Schedule Article must resolve Hugo media URLs and map parameters to the public Articles request');
	assertEqual(output, [[{
		json: { success: true, schedules: [{ id: 'article-1' }] },
		pairedItem: 0,
	}]], 'Schedule Article must return the provider response with item pairing');
}

async function testScheduleArticleOmitsStalePaywallMarkerWithoutSubstack() {
	let capturedRequest: IHttpRequestOptions | null = null;
	const context = executionContext(
		{
			operation: 'scheduleArticle',
			title: 'A cross-posted article',
			contentHtml: '<p>Public article</p>',
			articlePlatforms: ['MEDIUM', 'LINKEDIN'],
			scheduledFor: '2026-08-22T16:48:07.475+02:00',
			timezone: 'America/Toronto',
			paywallMarker: '{{NARRAREACH_PAYWALL}}',
			idempotencyKey: 'source-1',
		},
		(options) => {
			capturedRequest = options;
			return { success: true, schedules: [{ id: 'article-2' }] };
		},
	);

	await new Narrareach().execute.call(context as never);

	assert(
		capturedRequest !== null
			&& capturedRequest.body !== undefined
			&& !('paywallMarker' in capturedRequest.body),
		'a hidden Substack paywall marker must not leak into non-Substack requests',
	);
}

function testPaywallMarkerIsDiscoverable() {
	const property = new Narrareach().description.properties.find(
		(candidate) => candidate.name === 'paywallMarker',
	);
	assert(property, 'the n8n article form must expose paywall placement');
	assert(
		typeof property.description === 'string'
			&& property.description.includes('free preview')
			&& property.description.includes('exactly once'),
		'the paywall marker instructions must explain placement and validation',
	);
}

function testSoleSubstackPublicationCanBeOmitted() {
	const publicationProperty = new Narrareach().description.properties.find(
		(property) => property.name === 'publication',
	);
	assert(publicationProperty, 'the n8n node must expose the Substack publication field');
	assert(
		publicationProperty.required !== true,
		'the publication field must be optional when Narrareach can select the sole active publication',
	);
}

function testArticleVideoCompatibilityNotice() {
	const notice = new Narrareach().description.properties.find(
		(property) => property.name === 'articleVideoCompatibilityNotice',
	);
	assert(notice && typeof notice.displayName === 'string', 'the article form must explain video compatibility');
	assert(
		notice.displayName.includes('YouTube and Vimeo') && notice.displayName.includes('Medium'),
		'the n8n node must not incorrectly describe all inline video as Substack-only',
	);
}

function testSubstackAudienceMapping() {
	assertEqual(substackAudienceToPaidContent('default'), undefined, 'legacy workflows must omit the field');
	assertEqual(substackAudienceToPaidContent('free'), false, 'free articles must disable the paywall');
	assertEqual(substackAudienceToPaidContent('paid'), true, 'paid articles must enable the paywall');
}

async function testArticleStatusAndCancelExecution() {
	const requests: IHttpRequestOptions[] = [];
	const request = (options: IHttpRequestOptions) => {
		requests.push(options);
		return { success: true };
	};

	await new Narrareach().execute.call(executionContext({
		operation: 'getStatus',
		resource: 'article',
		id: 'article/1',
	}, request) as never);
	await new Narrareach().execute.call(executionContext({
		operation: 'cancel',
		mutableResource: 'article',
		id: 'article/1',
	}, request) as never);

	assertEqual(requests, [
		{ method: 'GET', url: 'https://www.narrareach.com/api/v1/article-schedules/article%2F1', json: true, headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.3.0' } },
		{ method: 'DELETE', url: 'https://www.narrareach.com/api/v1/article-schedules/article%2F1', json: true, headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.3.0' } },
	], 'Article status and cancellation must use the stable public schedule routes');
}

async function testApiErrorPropagation() {
	const providerError = Object.assign(new Error('Request rejected'), {
		response: {
			status: 400,
			data: {
				error: {
					code: 'VALIDATION_ERROR',
					message: 'Invalid article request.',
					details: { fieldErrors: { scheduledFor: ['Invalid ISO datetime'] } },
				},
			},
		},
	});
	const context = executionContext(
		{
			operation: 'getStatus',
			resource: 'note',
			id: 'note-1',
		},
		() => { throw providerError; },
	);

	let thrown: unknown;
	try {
		await new Narrareach().execute.call(context as never);
	} catch (error) {
		thrown = error;
	}
	assert(thrown instanceof Error, 'HTTP failures must reject execution');
	assert(thrown.name !== 'NodeOperationError', 'HTTP failures must be surfaced as Node API errors');
	assert(
		thrown.message === 'Invalid article request.',
		'HTTP failures must retain Narrareach\'s safe API message instead of a generic status label',
	);
	assert(
		'description' in thrown && thrown.description === 'VALIDATION_ERROR — scheduledFor: Invalid ISO datetime',
		'HTTP failures must retain the structured code and bounded field validation details',
	);

	const continued = await new Narrareach().execute.call(executionContext(
		{
			operation: 'getStatus',
			resource: 'note',
			id: 'note-1',
		},
		() => { throw providerError; },
		true,
	) as never);
	const continuedError = continued[0][0]?.error;
	assert(
		continuedError?.message === 'Invalid article request.'
			&& continuedError.description === 'VALIDATION_ERROR — scheduledFor: Invalid ISO datetime',
		'Continue On Fail must preserve the same safe structured Narrareach error per item',
	);
}

async function testPostNoteNow() {
	let capturedBody: unknown;
	await new Narrareach().execute.call(executionContext(
		{
			operation: 'scheduleNote',
			noteMode: 'now',
			content: 'Live now',
			notePlatforms: ['BLUESKY', 'X'],
			scheduledFor: '2026-08-22T16:48:07.475+02:00',
			idempotencyKey: 'source-1',
			noteOptions: {
				firstReply: ' Read more at example.com ',
				platformVersions: {
					version: [
						{ platform: 'BLUESKY', content: 'Short Bluesky text' },
						{ platform: 'THREADS', content: 'Stale Threads row' },
					],
				},
			},
		},
		(options) => {
			capturedBody = options.body;
			return { success: true, mode: 'now' };
		},
	) as never);

	assertEqual(capturedBody, {
		content: 'Live now',
		platforms: ['BLUESKY', 'X'],
		mode: 'now',
		timezone: 'UTC',
		firstReply: 'Read more at example.com',
		platformVersions: { BLUESKY: 'Short Bluesky text' },
		idempotencyKey: 'source-1',
	}, 'Post Now must send mode now without scheduledFor, and only versions for selected platforms');
}

async function testInstagramDestinations() {
	const bodies: Record<string, unknown>[] = [];
	const request = (options: IHttpRequestOptions) => {
		bodies.push(options.body as Record<string, unknown>);
		return { success: true };
	};
	const base = {
		operation: 'scheduleNote',
		content: 'Photo day',
		imageUrls: 'https://cdn.example.com/photo.jpg',
		scheduledFor: '2026-08-22T16:48:07.475+02:00',
		idempotencyKey: 'source-1',
		instagramDestinations: {
			destination: [
				{ accountId: ' ig_1 ', caption: ' Caption for the brand account ' },
				{ accountId: 'ig_2', caption: '   ' },
				{ accountId: '' },
			],
		},
	};

	await new Narrareach().execute.call(
		executionContext({ ...base, notePlatforms: ['INSTAGRAM'] }, request) as never,
	);
	await new Narrareach().execute.call(
		executionContext({ ...base, notePlatforms: ['X'] }, request) as never,
	);

	assertEqual(bodies[0].instagramDestinations, [
		{ accountId: 'ig_1', caption: 'Caption for the brand account' },
		{ accountId: 'ig_2' },
	], 'Instagram destinations must be sent as [{ accountId, caption? }] with blank captions omitted');
	assert(
		!('instagramDestinations' in bodies[1]),
		'Instagram destinations must be sent only when Instagram is selected',
	);
}

async function testArticlePlatformSchedulesAndOptions() {
	let capturedBody: unknown;
	await new Narrareach().execute.call(executionContext(
		{
			operation: 'scheduleArticle',
			articleSource: 'draft',
			draftId: ' draft_1 ',
			title: 'Hidden stale title',
			contentHtml: '<p>Hidden stale body</p>',
			paywallMarker: '{{NARRAREACH_PAYWALL}}',
			articlePlatforms: ['MEDIUM', 'LINKEDIN'],
			articleScheduleMode: 'perPlatform',
			scheduledFor: '2026-08-22T16:48:07.475+02:00',
			platformSchedules: {
				schedule: [
					{ platform: 'MEDIUM', scheduledFor: '2026-09-01T09:00:00.000Z' },
					{ platform: 'LINKEDIN', scheduledFor: '2026-09-02T09:00:00.000Z' },
				],
			},
			timezone: 'Europe/London',
			idempotencyKey: 'source-1',
			articleOptions: {
				addSearchMetadata: true,
				mediumPublicationId: 'pub_1',
				mediumNotifyFollowers: true,
				linkedinPublicationType: 'newsletter',
				linkedinAuthorUrn: 'urn:li:fsd_profile:abc',
				linkedinNewsletterUrn: 'urn:li:fsd_contentSeries:xyz',
				linkedinShareCommentary: 'New issue',
				substackConnectionId: 'stale_substack_connection',
			},
		},
		(options) => {
			capturedBody = options.body;
			return { success: true };
		},
	) as never);

	assertEqual(capturedBody, {
		draftId: 'draft_1',
		platforms: ['MEDIUM', 'LINKEDIN'],
		platformSchedules: [
			{ platform: 'MEDIUM', scheduledFor: '2026-09-01T09:00:00.000Z' },
			{ platform: 'LINKEDIN', scheduledFor: '2026-09-02T09:00:00.000Z' },
		],
		timezone: 'Europe/London',
		sendToNewsletter: false,
		addSearchMetadata: true,
		mediumPublicationId: 'pub_1',
		mediumNotifyFollowers: true,
		linkedinPublicationType: 'newsletter',
		linkedinAuthorUrn: 'urn:li:fsd_profile:abc',
		linkedinNewsletterUrn: 'urn:li:fsd_contentSeries:xyz',
		linkedinShareCommentary: 'New issue',
		idempotencyKey: 'source-1',
	}, 'Per-platform article schedules must replace scheduledFor, use draftId alone, and send only fields for selected platforms');

	let articleTypeBody: unknown;
	await new Narrareach().execute.call(executionContext(
		{
			operation: 'scheduleArticle',
			title: 'Launch',
			contentHtml: '<p>Body</p>',
			articlePlatforms: ['LINKEDIN'],
			scheduledFor: '2026-09-02T09:00:00.000Z',
			idempotencyKey: 'source-2',
			articleOptions: {
				linkedinPublicationType: 'article',
				linkedinNewsletterUrn: 'urn:li:fsd_contentSeries:stale',
			},
		},
		(options) => {
			articleTypeBody = options.body;
			return { success: true };
		},
	) as never);
	assert(
		(articleTypeBody as Record<string, unknown>).linkedinPublicationType === 'article'
			&& !('linkedinNewsletterUrn' in (articleTypeBody as Record<string, unknown>)),
		'A newsletter left over from switching back to Article must not be sent',
	);

	let missingSchedulesError: unknown;
	try {
		await new Narrareach().execute.call(executionContext(
			{
				operation: 'scheduleArticle',
				title: 'Launch',
				contentHtml: '<p>Body</p>',
				articlePlatforms: ['SUBSTACK'],
				articleScheduleMode: 'perPlatform',
				idempotencyKey: 'source-1',
			},
			() => { throw new Error('no request may be sent without platform schedules'); },
		) as never);
	} catch (error) {
		missingSchedulesError = error;
	}
	assert(
		missingSchedulesError instanceof Error
			&& missingSchedulesError.message.includes('Platform Schedules'),
		'Per-platform timing without rows must fail before calling the API',
	);
}

async function testNoteCancelConfirmUncertain() {
	const urls: unknown[] = [];
	const request = (options: IHttpRequestOptions) => {
		urls.push(`${options.method} ${options.url}`);
		return { success: true };
	};

	await new Narrareach().execute.call(executionContext({
		operation: 'cancel',
		mutableResource: 'note',
		id: 'note-1',
		confirmUncertain: true,
	}, request) as never);
	await new Narrareach().execute.call(executionContext({
		operation: 'cancel',
		mutableResource: 'note',
		id: 'note-1',
	}, request) as never);
	await new Narrareach().execute.call(executionContext({
		operation: 'cancel',
		mutableResource: 'article',
		id: 'article-1',
		confirmUncertain: true,
	}, request) as never);

	assertEqual(urls, [
		'DELETE https://www.narrareach.com/api/v1/notes/note-1?confirm_uncertain=true',
		'DELETE https://www.narrareach.com/api/v1/notes/note-1',
		'DELETE https://www.narrareach.com/api/v1/article-schedules/article-1',
	], 'confirm_uncertain must be sent only for confirmed Note cancellations');
}

function loadOptionsContext(
	parameters: Record<string, unknown>,
	response: unknown,
	requests: IHttpRequestOptions[],
) {
	return {
		getCurrentNodeParameter: (path: string) => parameters[path],
		getCredentials: async () => ({ apiToken: 'nrr_api_test', baseUrl: 'https://www.narrareach.com/' }),
		helpers: {
			httpRequestWithAuthentication: async function (
				this: unknown,
				credentialType: string,
				options: IHttpRequestOptions,
			) {
				assert(credentialType === 'narrareachApi', 'lookups must use Narrareach credentials');
				requests.push(options);
				return response;
			},
		},
	};
}

async function testLoadOptionsLookups() {
	const requests: IHttpRequestOptions[] = [];
	const pages = await getLinkedInPages.call(loadOptionsContext(
		{ linkedInAccountId: 'acct_1' },
		{
			success: true,
			destinations: [
				{ accountId: 'acct_1', label: 'Ada Lovelace', kind: 'profile' },
				{ accountId: 'acct_1', organizationUrn: 'urn:li:organization:1', label: 'Analytical Engines', kind: 'page' },
				{ accountId: 'acct_2', organizationUrn: 'urn:li:organization:2', label: 'Other Account Page', kind: 'page' },
			],
		},
		requests,
	) as never);
	assertEqual(pages, [
		{ name: 'None (Post as the Profile)', value: '' },
		{ name: 'Analytical Engines', value: 'urn:li:organization:1' },
	], 'LinkedIn Page lookup must list only Pages for the selected account');

	const missingAccountRequests: IHttpRequestOptions[] = [];
	const missingAccountPages = await getLinkedInPages.call(loadOptionsContext(
		{ linkedInAccountId: '   ' },
		{ destinations: [{ accountId: 'acct_1', organizationUrn: 'urn:li:organization:1', label: 'Page' }] },
		missingAccountRequests,
	) as never);
	assertEqual(missingAccountPages, [{ name: 'None (Post as the Profile)', value: '' }], 'Pages require an explicit account selection');
	assertEqual(missingAccountRequests, [], 'Do not fetch Pages before an account is selected');

	const publications = await getMediumPublications.call(loadOptionsContext(
		{},
		{
			success: true,
			connected: true,
			publications: [
				{ id: 'pub_1', name: 'Better Programming', slug: 'better', avatarId: null, canPublish: true },
				{ id: 'pub_2', name: 'Writers Only', slug: 'writers', avatarId: null, canPublish: false },
			],
		},
		requests,
	) as never);
	assertEqual(publications, [
		{ name: 'Personal Profile', value: '' },
		{ name: 'Better Programming', value: 'pub_1' },
		{ name: 'Writers Only (submitted for editor review)', value: 'pub_2' },
	], 'Medium publication lookup must keep the personal profile and flag review-only publications');

	const instagram = await getInstagramDestinations.call(loadOptionsContext(
		{},
		{
			success: true,
			destinations: [
				{ accountId: 'ig_1', label: '@studio', isDefault: true, available: true },
				{ accountId: 'ig_2', label: '@archive', isDefault: false, available: false },
			],
		},
		requests,
	) as never);
	assertEqual(instagram, [
		{ name: '@studio (default)', value: 'ig_1' },
	], 'Instagram lookup must leave out accounts the plan cannot post to');

	assertEqual(requests.map((options) => `${options.method} ${options.url}`), [
		'GET https://www.narrareach.com/api/v1/linkedin/destinations',
		'GET https://www.narrareach.com/api/v1/medium/publications',
		'GET https://www.narrareach.com/api/v1/instagram/destinations',
	], 'Lookups must call the public GET routes');
	assert(
		requests.every((options) => (options.headers as Record<string, string>)['x-narrareach-client'] === 'n8n-nodes-narrareach/0.3.0'),
		'Lookups must identify the n8n client',
	);
}

const clientHeaders = { 'x-narrareach-client': 'n8n-nodes-narrareach/0.3.0' };

async function testListReaderActivities() {
	const requests: IHttpRequestOptions[] = [];
	const request = (options: IHttpRequestOptions) => {
		requests.push(options);
		return { success: true, activities: [], page: { nextCursor: null, hasMore: false } };
	};

	await new Narrareach().execute.call(executionContext({
		operation: 'listReaderActivities',
		activityState: 'history',
		activityConnectionId: ' conn_1 ',
		readerActivityOptions: { type: 'comment', sort: 'relevance', cursor: 'cursor/2', limit: 25 },
	}, request) as never);
	await new Narrareach().execute.call(executionContext({
		operation: 'listReaderActivities',
		activityConnectionId: '',
	}, request) as never);

	assertEqual(requests, [
		{
			method: 'GET',
			url: 'https://www.narrareach.com/api/v1/reader-activities?state=history&type=comment&sort=relevance&cursor=cursor%2F2&limit=25&substackConnectionId=conn_1',
			json: true,
			headers: clientHeaders,
		},
		{
			method: 'GET',
			url: 'https://www.narrareach.com/api/v1/reader-activities?state=inbox',
			json: true,
			headers: clientHeaders,
		},
	], 'List Reader Activities must send only the query parameters that are set');
}

async function testUpdateReaderActivity() {
	let capturedRequest: IHttpRequestOptions | null = null;
	await new Narrareach().execute.call(executionContext({
		operation: 'updateReaderActivity',
		activityId: 'activity/1',
		triageState: 'HISTORY',
		activityConnectionId: 'conn_1',
	}, (options) => {
		capturedRequest = options;
		return { success: true };
	}) as never);

	assertEqual(capturedRequest, {
		method: 'PATCH',
		url: 'https://www.narrareach.com/api/v1/reader-activities/activity%2F1?substackConnectionId=conn_1',
		json: true,
		headers: clientHeaders,
		body: { triageState: 'HISTORY' },
	}, 'Update Reader Activity must PATCH the triage state');
}

async function testReplyToReaderActivity() {
	const requests: IHttpRequestOptions[] = [];
	const request = (options: IHttpRequestOptions) => {
		requests.push(options);
		return { success: true };
	};
	const base = {
		operation: 'replyToReaderActivity',
		activityId: 'activity-1',
		replyText: 'Thanks for reading!',
	};

	await new Narrareach().execute.call(
		executionContext({ ...base, idempotencyKey: ' comment-1 ' }, request) as never,
	);
	for (const idempotencyKey of ['', '   ']) {
		let rejected = false;
		try {
			await new Narrareach().execute.call(executionContext({ ...base, idempotencyKey }, request) as never);
		} catch {
			rejected = true;
		}
		assert(rejected, 'Blank reply keys must fail before sending a request');
	}
	const failedItems = await new Narrareach().execute.call(executionContext({ ...base, idempotencyKey: ' ' }, request, true) as never);
	assert(Boolean(failedItems[0][0].error), 'Continue on fail must return an item error for a blank reply key');

	assertEqual(requests, [
		{
			method: 'POST',
			url: 'https://www.narrareach.com/api/v1/reader-activities/activity-1/replies',
			json: true,
			headers: clientHeaders,
			body: { text: 'Thanks for reading!', idempotencyKey: 'comment-1' },
		},
	], 'Reply must send the text and a trimmed idempotency key in the body, never an Idempotency-Key header');
}

async function testGetStatsOutcomes() {
	const requests: IHttpRequestOptions[] = [];
	const request = (options: IHttpRequestOptions) => {
		requests.push(options);
		return { success: true };
	};

	await new Narrareach().execute.call(executionContext({
		operation: 'getStatsOutcomes',
		statsPeriod: 'custom',
		statsFrom: '2026-09-01',
		statsTo: '2026-09-30',
		statsOptions: {
			platforms: ['SUBSTACK', 'LINKEDIN'],
			contentTypes: ['note', 'social_post'],
			publicationId: 'pub_1',
		},
	}, request) as never);
	await new Narrareach().execute.call(executionContext({
		operation: 'getStatsOutcomes',
		statsPeriod: '7d',
		statsFrom: '2026-09-01',
		statsTo: '2026-09-30',
		statsOptions: { platforms: [] },
	}, request) as never);

	assertEqual(requests, [
		{
			method: 'GET',
			url: 'https://www.narrareach.com/api/v1/stats/outcomes?period=custom&from=2026-09-01&to=2026-09-30&platforms=SUBSTACK%2CLINKEDIN&contentTypes=note%2Csocial_post&publicationId=pub_1',
			json: true,
			headers: clientHeaders,
		},
		{
			method: 'GET',
			url: 'https://www.narrareach.com/api/v1/stats/outcomes?period=7d',
			json: true,
			headers: clientHeaders,
		},
	], 'Stats Outcomes must send from and to only for a custom period and omit empty filters');
}

async function run() {
	testSubstackAudienceMapping();
	testSoleSubstackPublicationCanBeOmitted();
	testArticleVideoCompatibilityNotice();
	testPaywallMarkerIsDiscoverable();
	await testScheduleArticleExecution();
	await testScheduleArticleOmitsStalePaywallMarkerWithoutSubstack();
	await testScheduleNoteExecution();
	await testScheduleNoteLinkedInDestination();
	await testArticleStatusAndCancelExecution();
	await testApiErrorPropagation();
	await testPostNoteNow();
	await testInstagramDestinations();
	await testArticlePlatformSchedulesAndOptions();
	await testNoteCancelConfirmUncertain();
	await testLoadOptionsLookups();
	await testListReaderActivities();
	await testUpdateReaderActivity();
	await testReplyToReaderActivity();
	await testGetStatsOutcomes();
}

run().catch((error: unknown) => {
	throw error;
});
