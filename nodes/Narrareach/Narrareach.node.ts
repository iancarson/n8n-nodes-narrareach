import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	buildNarrareachRequest,
	commaSeparatedValues,
	normalizeScheduledFor,
	parseOptionalJson,
	resolveRelativeArticleMediaUrls,
	type NarrareachOperation,
	type NarrareachResource,
	withoutUndefined,
} from './transport';

const platformOptions = [
	{ name: 'Substack', value: 'SUBSTACK' },
	{ name: 'Medium', value: 'MEDIUM' },
	{ name: 'LinkedIn', value: 'LINKEDIN' },
	{ name: 'X', value: 'X' },
];

const notePlatformOptions = [
	{ name: 'Substack', value: 'SUBSTACK' },
	{ name: 'LinkedIn', value: 'LINKEDIN' },
	{ name: 'X', value: 'X' },
	{ name: 'Bluesky', value: 'BLUESKY' },
	{ name: 'Threads', value: 'THREADS' },
	{ name: 'Instagram', value: 'INSTAGRAM' },
	{ name: 'Facebook', value: 'FACEBOOK' },
	{ name: 'TikTok', value: 'TIKTOK' },
	{ name: 'Pinterest', value: 'PINTEREST' },
];

const showFor = (operations: NarrareachOperation[]) => ({ show: { operation: operations } });
const NARRAREACH_CLIENT_HEADER = 'n8n-nodes-narrareach/0.1.4';

export class Narrareach implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Narrareach',
		name: 'narrareach',
		icon: {
			light: 'file:../../icons/narrareach.svg',
			dark: 'file:../../icons/narrareach.dark.svg',
		},
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Schedule and manage articles and Notes in Narrareach',
		defaults: { name: 'Narrareach' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'narrareachApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Cancel Schedule', value: 'cancel', action: 'Cancel a schedule' },
					{ name: 'Get Status', value: 'getStatus', action: 'Get schedule status' },
					{ name: 'Reschedule', value: 'reschedule', action: 'Reschedule content' },
					{ name: 'Schedule Article', value: 'scheduleArticle', action: 'Schedule an article' },
					{ name: 'Schedule Note', value: 'scheduleNote', action: 'Schedule a note' },
				],
				default: 'scheduleArticle',
			},
			{
				displayName: 'Resource Type',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Article Schedule', value: 'article' },
					{ name: 'Note', value: 'note' },
					{ name: 'Operation Receipt', value: 'operation' },
				],
				default: 'article',
				displayOptions: showFor(['getStatus']),
			},
			{
				displayName: 'Resource Type',
				name: 'mutableResource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Article Schedule', value: 'article' },
					{ name: 'Note', value: 'note' },
				],
				default: 'article',
				displayOptions: showFor(['reschedule', 'cancel']),
			},
			{
				displayName: 'Schedule or Operation ID',
				name: 'id',
				type: 'string',
				required: true,
				default: '',
				displayOptions: showFor(['getStatus', 'reschedule', 'cancel']),
			},
			{
				displayName: 'Inline video is supported only when Substack is the sole article destination. Remove the video before adding Medium, LinkedIn, or X.',
				name: 'articleVideoCompatibilityNotice',
				type: 'notice',
				default: '',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Subtitle',
				name: 'subtitle',
				type: 'string',
				default: '',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Content HTML',
				name: 'contentHtml',
				type: 'string',
				typeOptions: { rows: 10 },
				required: true,
				default: '',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Source URL',
				name: 'sourceUrl',
				type: 'string',
				default: '',
				description: 'Optional article URL used to resolve relative video paths from RSS or Hugo feeds',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Article Platforms',
				name: 'articlePlatforms',
				type: 'multiOptions',
				options: platformOptions,
				required: true,
				default: ['SUBSTACK'],
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Substack Publication',
				name: 'publication',
				type: 'string',
				default: '',
				description: 'Publication name, handle, or URL. Required when the account has multiple Substack publications.',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Cover Image URL',
				name: 'coverImageUrl',
				type: 'string',
				default: '',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Article Media JSON',
				name: 'mediaJson',
				type: 'json',
				default: '',
				description: 'Optional array of image or video media objects accepted by the Narrareach API',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				description: 'Comma-separated article tags',
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Send to Newsletter',
				name: 'sendToNewsletter',
				type: 'boolean',
				default: false,
				displayOptions: showFor(['scheduleArticle']),
			},
			{
				displayName: 'Note Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 6 },
				required: true,
				default: '',
				displayOptions: showFor(['scheduleNote']),
			},
			{
				displayName: 'Content JSON',
				name: 'contentJson',
				type: 'json',
				default: '',
				description: 'Optional structured editor JSON for preserving rich content',
				displayOptions: showFor(['scheduleNote']),
			},
			{
				displayName: 'Note Platforms',
				name: 'notePlatforms',
				type: 'multiOptions',
				options: notePlatformOptions,
				required: true,
				default: ['SUBSTACK'],
				displayOptions: showFor(['scheduleNote']),
			},
			{
				displayName: 'Image URLs',
				name: 'imageUrls',
				type: 'string',
				default: '',
				description: 'Comma-separated public image URLs',
				displayOptions: showFor(['scheduleNote']),
			},
			{
				displayName: 'Video URLs',
				name: 'videoUrls',
				type: 'string',
				default: '',
				description: 'Comma-separated public video URLs',
				displayOptions: showFor(['scheduleNote']),
			},
			{
				displayName: 'Threads Topic Tag',
				name: 'threadsTopicTag',
				type: 'string',
				default: '',
				description: 'Optional topic tag used only when Threads is selected',
				displayOptions: showFor(['scheduleNote']),
			},
			{
				displayName: 'Scheduled For',
				name: 'scheduledFor',
				type: 'dateTime',
				required: true,
				default: '',
				displayOptions: showFor(['scheduleArticle', 'scheduleNote', 'reschedule']),
			},
			{
				displayName: 'Timezone',
				name: 'timezone',
				type: 'string',
				default: 'UTC',
				displayOptions: showFor(['scheduleArticle', 'scheduleNote', 'reschedule']),
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				required: true,
				default: '',
				description: 'Stable source ID used to make workflow retries safe',
				displayOptions: showFor(['scheduleArticle', 'scheduleNote']),
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as NarrareachOperation;
				let resource: NarrareachResource | undefined;
				let id: string | undefined;
				let body: Record<string, unknown> | undefined;

				if (operation === 'scheduleArticle') {
					const coverImageUrl = this.getNodeParameter('coverImageUrl', itemIndex, '') as string;
					const sourceUrl = this.getNodeParameter('sourceUrl', itemIndex, '') as string;
					const contentHtml = this.getNodeParameter('contentHtml', itemIndex) as string;
					const timezone = this.getNodeParameter('timezone', itemIndex, 'UTC') as string;
					body = withoutUndefined({
						title: this.getNodeParameter('title', itemIndex) as string,
						subtitle: (this.getNodeParameter('subtitle', itemIndex, '') as string) || undefined,
						contentHtml: resolveRelativeArticleMediaUrls(contentHtml, sourceUrl),
						platforms: this.getNodeParameter('articlePlatforms', itemIndex) as string[],
						publication:
							(this.getNodeParameter('publication', itemIndex, '') as string) || undefined,
						scheduledFor: normalizeScheduledFor(
							this.getNodeParameter('scheduledFor', itemIndex),
							timezone,
						),
						timezone,
						coverImage: coverImageUrl
							? { sourceType: 'url', url: coverImageUrl }
							: undefined,
						media: parseOptionalJson(this.getNodeParameter('mediaJson', itemIndex, '')),
						tags: commaSeparatedValues(this.getNodeParameter('tags', itemIndex, '')),
						sendToNewsletter: this.getNodeParameter('sendToNewsletter', itemIndex, false) as boolean,
						idempotencyKey: this.getNodeParameter('idempotencyKey', itemIndex) as string,
					});
				} else if (operation === 'scheduleNote') {
					const timezone = this.getNodeParameter('timezone', itemIndex, 'UTC') as string;
					body = withoutUndefined({
						content: this.getNodeParameter('content', itemIndex) as string,
						contentJson: parseOptionalJson(this.getNodeParameter('contentJson', itemIndex, '')),
						platforms: this.getNodeParameter('notePlatforms', itemIndex) as string[],
						mode: 'schedule',
						scheduledFor: normalizeScheduledFor(
							this.getNodeParameter('scheduledFor', itemIndex),
							timezone,
						),
						timezone,
						imageUrls: commaSeparatedValues(this.getNodeParameter('imageUrls', itemIndex, '')),
						videoUrls: commaSeparatedValues(this.getNodeParameter('videoUrls', itemIndex, '')),
						threadsTopicTag:
							(this.getNodeParameter('threadsTopicTag', itemIndex, '') as string) || undefined,
						idempotencyKey: this.getNodeParameter('idempotencyKey', itemIndex) as string,
					});
				} else {
					resource = (operation === 'getStatus'
						? this.getNodeParameter('resource', itemIndex)
						: this.getNodeParameter('mutableResource', itemIndex)) as NarrareachResource;
					id = this.getNodeParameter('id', itemIndex) as string;
					if (operation === 'reschedule') {
						const timezone = this.getNodeParameter('timezone', itemIndex, 'UTC') as string;
						body = {
							scheduledFor: normalizeScheduledFor(
								this.getNodeParameter('scheduledFor', itemIndex),
								timezone,
							),
							timezone,
						};
					}
				}

				const request = buildNarrareachRequest({ operation, resource, id, body });
				const credentials = await this.getCredentials('narrareachApi');
				const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
				const options: IHttpRequestOptions = {
					method: request.method,
					url: `${baseUrl}${request.path}`,
					json: true,
					headers: { 'x-narrareach-client': NARRAREACH_CLIENT_HEADER },
					...(request.body ? { body: request.body } : {}),
				};
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'narrareachApi',
					options,
				);

				output.push({ json: response as IDataObject, pairedItem: itemIndex });
			} catch (error) {
				if (this.continueOnFail()) {
					const operationError = new NodeOperationError(this.getNode(), error as Error, {
						itemIndex,
					});
					output.push({
						json: items[itemIndex].json,
						error: operationError,
						pairedItem: itemIndex,
					});
					continue;
				}
				if (error && typeof error === 'object' && 'response' in error) {
					throw new NodeApiError(this.getNode(), error as never, { itemIndex });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [output];
	}
}
