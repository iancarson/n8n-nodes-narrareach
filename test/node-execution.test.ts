import type { IHttpRequestOptions } from 'n8n-workflow';

import { Narrareach } from '../nodes/Narrareach/Narrareach.node';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
	assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function executionContext(parameters: Record<string, unknown>, request: (options: IHttpRequestOptions) => unknown) {
	return {
		getInputData: () => [{ json: { sourceId: 'source-1' } }],
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
		getCredentials: async () => ({
			apiToken: 'nrr_api_test',
			baseUrl: 'https://www.narrareach.com/',
		}),
		getNode: () => ({ name: 'Narrareach', type: 'narrareach', typeVersion: 1, position: [0, 0] }),
		continueOnFail: () => false,
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
			scheduledFor: '2026-09-01T10:00:00',
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
		headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.2' },
		body: {
			content: 'A concise update',
			contentJson: { type: 'doc' },
			platforms: ['THREADS', 'BLUESKY'],
			mode: 'schedule',
			scheduledFor: '2026-09-01T14:00:00.000Z',
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
			contentHtml: '<p>Before</p><video><source src="../../media/demo.mp4" type="video/mp4"></video>',
			sourceUrl: 'https://example.com/posts/a-hugo-article/',
			articlePlatforms: ['SUBSTACK'],
			scheduledFor: '2026-09-01T10:00:00',
			timezone: 'UTC',
			coverImageUrl: 'https://cdn.example.com/cover.jpg',
			mediaJson: '',
			tags: 'hugo, publishing',
			sendToNewsletter: true,
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
		headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.2' },
		body: {
			title: 'A Hugo article',
			subtitle: 'Imported through RSS',
			contentHtml: '<p>Before</p><video><source src="https://example.com/media/demo.mp4" type="video/mp4"></video>',
			platforms: ['SUBSTACK'],
			scheduledFor: '2026-09-01T10:00:00.000Z',
			timezone: 'UTC',
			coverImage: { sourceType: 'url', url: 'https://cdn.example.com/cover.jpg' },
			tags: ['hugo', 'publishing'],
			sendToNewsletter: true,
			idempotencyKey: 'source-1',
		},
	}, 'Schedule Article must resolve Hugo media URLs and map parameters to the public Articles request');
	assertEqual(output, [[{
		json: { success: true, schedules: [{ id: 'article-1' }] },
		pairedItem: 0,
	}]], 'Schedule Article must return the provider response with item pairing');
}

async function testRescheduleExecutionNormalizesN8nDateTime() {
	let capturedRequest: IHttpRequestOptions | null = null;
	const context = executionContext(
		{
			operation: 'reschedule',
			mutableResource: 'article',
			id: 'article-1',
			scheduledFor: '2026-09-01T10:00:00',
			timezone: 'UTC',
		},
		(options) => {
			capturedRequest = options;
			return { success: true };
		},
	);

	await new Narrareach().execute.call(context as never);

	assertEqual(capturedRequest, {
		method: 'PATCH',
		url: 'https://www.narrareach.com/api/v1/article-schedules/article-1',
		json: true,
		headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.2' },
		body: {
			scheduledFor: '2026-09-01T10:00:00.000Z',
			timezone: 'UTC',
		},
	}, 'Reschedule must normalize the timezone-less value emitted by the n8n date-time control');
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
		{ method: 'GET', url: 'https://www.narrareach.com/api/v1/article-schedules/article%2F1', json: true, headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.2' } },
		{ method: 'DELETE', url: 'https://www.narrareach.com/api/v1/article-schedules/article%2F1', json: true, headers: { 'x-narrareach-client': 'n8n-nodes-narrareach/0.1.2' } },
	], 'Article status and cancellation must use the stable public schedule routes');
}

async function testApiErrorPropagation() {
	const providerError = Object.assign(new Error('Request rejected'), {
		response: { status: 409, data: { error: { code: 'PLATFORM_NOT_READY' } } },
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
}

async function run() {
	await testScheduleArticleExecution();
	await testScheduleNoteExecution();
	await testRescheduleExecutionNormalizesN8nDateTime();
	await testArticleStatusAndCancelExecution();
	await testApiErrorPropagation();
}

run().catch((error: unknown) => {
	throw error;
});
