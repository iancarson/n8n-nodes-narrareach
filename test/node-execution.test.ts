import type { IHttpRequestOptions } from 'n8n-workflow';

import { Narrareach, substackAudienceToPaidContent } from '../nodes/Narrareach/Narrareach.node';

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
		headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.9' },
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
		headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.9' },
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
		{ method: 'GET', url: 'https://www.narrareach.com/api/v1/article-schedules/article%2F1', json: true, headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.9' } },
		{ method: 'DELETE', url: 'https://www.narrareach.com/api/v1/article-schedules/article%2F1', json: true, headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.9' } },
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

async function run() {
	testSubstackAudienceMapping();
	testSoleSubstackPublicationCanBeOmitted();
	testArticleVideoCompatibilityNotice();
	testPaywallMarkerIsDiscoverable();
	await testScheduleArticleExecution();
	await testScheduleNoteExecution();
	await testArticleStatusAndCancelExecution();
	await testApiErrorPropagation();
}

run().catch((error: unknown) => {
	throw error;
});
