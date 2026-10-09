import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	getInstagramDestinations,
	getLinkedInAccounts,
	getLinkedInArticleAuthors,
	getLinkedInArticleNewsletters,
	getLinkedInPages,
	getMediumPublications,
	NARRAREACH_CLIENT_HEADER,
} from './loadOptions';
import {
	buildInstagramDestinations,
	buildNarrareachRequest,
	buildPlatformSchedules,
	buildPlatformVersions,
	commaSeparatedValues,
	parseOptionalJson,
	resolveRelativeArticleMediaUrls,
	trimmedString,
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

// platformVersions is accepted only for platforms with a character limit.
const platformVersionOptions = [
	{ name: 'Bluesky', value: 'BLUESKY' },
	{ name: 'LinkedIn', value: 'LINKEDIN' },
	{ name: 'Threads', value: 'THREADS' },
	{ name: 'X', value: 'X' },
];

const showFor = (operations: NarrareachOperation[]) => ({ show: { operation: operations } });
const showForNewArticle = { show: { operation: ['scheduleArticle'], articleSource: ['new'] } };

export { NARRAREACH_CLIENT_HEADER };

export function substackAudienceToPaidContent(value: string): boolean | undefined {
	if (value === 'paid') return true;
	if (value === 'free') return false;
	return undefined;
}

type NarrareachApiErrorOptions = {
	message: string;
	description?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength = 300): string | undefined {
	return typeof value === 'string' && value.trim()
		? value.trim().slice(0, maxLength)
		: undefined;
}

function formatValidationDetails(value: unknown): string[] {
	if (!isRecord(value) || !isRecord(value.fieldErrors)) return [];
	const details: string[] = [];
	for (const [field, messages] of Object.entries(value.fieldErrors)) {
		if (!Array.isArray(messages)) continue;
		for (const message of messages) {
			const safeMessage = boundedString(message, 160);
			if (safeMessage) details.push(`${field}: ${safeMessage}`);
			if (details.length === 3) return details;
		}
	}
	return details;
}

function getNarrareachApiErrorOptions(error: unknown): NarrareachApiErrorOptions | undefined {
	if (!isRecord(error) || !isRecord(error.response) || !isRecord(error.response.data)) return undefined;
	const apiError = error.response.data.error;
	if (!isRecord(apiError)) return undefined;

	const message = boundedString(apiError.message);
	if (!message) return undefined;
	if (apiError.code === 'SUBSTACK_REAUTHENTICATION_REQUIRED') {
		return { message, description: 'Choose Confirm Substack Connection to request and enter your code here. Then check your article’s status before trying again.' };
	}
	const code = boundedString(apiError.code, 80);
	const details = formatValidationDetails(apiError.details);
	const description = [code, details.join('; ')].filter(Boolean).join(' — ');
	return { message, ...(description ? { description } : {}) };
}

function booleanOption(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

/**
 * Optional POST /api/v1/articles fields. Each platform-specific field is sent only
 * when its platform is selected, because the API rejects it otherwise.
 */
export function articleOptionsToBody(
	options: Record<string, unknown>,
	platforms: readonly string[],
): Record<string, unknown> {
	const hasLinkedIn = platforms.includes('LINKEDIN');
	const hasMedium = platforms.includes('MEDIUM');
	const hasSubstack = platforms.includes('SUBSTACK');
	const linkedinPublicationType = trimmedString(options.linkedinPublicationType);
	return withoutUndefined({
		addSearchMetadata: booleanOption(options.addSearchMetadata),
		substackConnectionId: hasSubstack ? trimmedString(options.substackConnectionId) : undefined,
		mediumPublicationId: hasMedium ? trimmedString(options.mediumPublicationId) : undefined,
		mediumNotifyFollowers: hasMedium ? booleanOption(options.mediumNotifyFollowers) : undefined,
		linkedinPublicationType:
			hasLinkedIn && (linkedinPublicationType === 'article' || linkedinPublicationType === 'newsletter')
				? linkedinPublicationType
				: undefined,
		linkedinAuthorUrn: hasLinkedIn ? trimmedString(options.linkedinAuthorUrn) : undefined,
		// The API rejects a newsletter unless the publication type is newsletter, so a
		// value left over from switching back to Article is dropped.
		linkedinNewsletterUrn:
			hasLinkedIn && linkedinPublicationType === 'newsletter'
				? trimmedString(options.linkedinNewsletterUrn)
				: undefined,
		linkedinShareCommentary: hasLinkedIn ? trimmedString(options.linkedinShareCommentary) : undefined,
	});
}

const articleProperties: INodeProperties[] = [
	{
		displayName: 'YouTube and Vimeo links embedded in the article can remain inline on Medium. YouTube embeds can remain inline on Substack. Uploaded video files are available only for Substack-only schedules; other destinations keep unsupported videos as links.',
		name: 'articleVideoCompatibilityNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['scheduleArticle']),
	},
	{
		displayName: 'Article Source',
		name: 'articleSource',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'New Article',
				value: 'new',
				description: 'Create a draft from the title and Content HTML below',
			},
			{
				name: 'Existing Narrareach Draft',
				value: 'draft',
				description: 'Schedule a draft that already exists in Narrareach',
			},
		],
		default: 'new',
		displayOptions: showFor(['scheduleArticle']),
	},
	{
		displayName: 'Draft ID',
		name: 'draftId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the Narrareach article draft to schedule, for example draftId from an earlier response',
		displayOptions: { show: { operation: ['scheduleArticle'], articleSource: ['draft'] } },
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showForNewArticle,
	},
	{
		displayName: 'Subtitle',
		name: 'subtitle',
		type: 'string',
		default: '',
		displayOptions: showForNewArticle,
	},
	{
		displayName: 'Content HTML',
		name: 'contentHtml',
		type: 'string',
		typeOptions: { rows: 10 },
		required: true,
		default: '',
		displayOptions: showForNewArticle,
	},
	{
		displayName: 'Source URL',
		name: 'sourceUrl',
		type: 'string',
		default: '',
		description: 'Optional article URL used to resolve relative video paths from RSS or Hugo feeds',
		displayOptions: showForNewArticle,
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
		description: 'Optional when one Substack publication is active. If several are connected, enter the exact name, handle, or URL.',
		displayOptions: {
			show: { operation: ['scheduleArticle'], articlePlatforms: ['SUBSTACK'] },
		},
	},
	{
		displayName: 'Cover Image URL',
		name: 'coverImageUrl',
		type: 'string',
		default: '',
		displayOptions: showForNewArticle,
	},
	{
		displayName: 'Article Media JSON',
		name: 'mediaJson',
		type: 'json',
		default: '',
		description: 'Optional array of image or video media objects accepted by the Narrareach API',
		displayOptions: showForNewArticle,
	},
	{
		displayName: 'Tags',
		name: 'tags',
		type: 'string',
		default: '',
		description: 'Comma-separated article tags',
		displayOptions: showForNewArticle,
	},
	{
		displayName: 'Send to Newsletter',
		name: 'sendToNewsletter',
		type: 'boolean',
		default: false,
		displayOptions: showFor(['scheduleArticle']),
	},
	{
		displayName: 'Substack Access',
		name: 'substackAudience',
		type: 'options',
		options: [
			{ name: 'Use Narrareach Default (Free)', value: 'default' },
			{ name: 'Free for Everyone', value: 'free' },
			{ name: 'Paid Subscribers Only', value: 'paid' },
		],
		default: 'default',
		description:
			'Controls the Substack paywall when Substack is selected. This can be an expression mapped from a Notion select field.',
		displayOptions: showFor(['scheduleArticle']),
	},
	{
		displayName: 'Paywall Marker',
		name: 'paywallMarker',
		type: 'string',
		default: '',
		placeholder: '{{NARRAREACH_PAYWALL}}',
		description:
			'Optional exact text in Content HTML where the free preview ends. It must appear exactly once. Narrareach removes the marker, inserts Substack\'s native paywall, and marks the article as paid.',
		displayOptions: {
			show: { operation: ['scheduleArticle'], articleSource: ['new'], articlePlatforms: ['SUBSTACK'] },
		},
	},
	{
		displayName: 'Schedule Timing',
		name: 'articleScheduleMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Same Time for Every Platform', value: 'shared' },
			{ name: 'Different Time per Platform', value: 'perPlatform' },
		],
		default: 'shared',
		displayOptions: showFor(['scheduleArticle']),
	},
	{
		displayName: 'Scheduled For',
		name: 'scheduledFor',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { operation: ['scheduleArticle'], articleScheduleMode: ['shared'] } },
	},
	{
		displayName: 'Platform Schedules',
		name: 'platformSchedules',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Platform Time',
		default: {},
		description: 'One time for every selected platform. Each platform must appear once and match Article Platforms exactly.',
		displayOptions: { show: { operation: ['scheduleArticle'], articleScheduleMode: ['perPlatform'] } },
		options: [
			{
				displayName: 'Schedule',
				name: 'schedule',
				values: [
					{
						displayName: 'Platform',
						name: 'platform',
						type: 'options',
						options: platformOptions,
						default: 'SUBSTACK',
					},
					{
						displayName: 'Scheduled For',
						name: 'scheduledFor',
						type: 'dateTime',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'articleOptions',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['scheduleArticle']),
		options: [
			{
				displayName: 'Add Search Metadata',
				name: 'addSearchMetadata',
				type: 'boolean',
				default: false,
				description: 'Whether to generate SEO titles, descriptions, and a Substack slug for supported destinations. Requires article SEO access.',
			},
			{
				displayName: 'LinkedIn Article Author Name or ID',
				name: 'linkedinAuthorUrn',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLinkedInArticleAuthors' },
				default: '',
				description: 'LinkedIn only. Personal profile or Company Page that publishes the article, from GET /api/v1/linkedin/article-destinations. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'LinkedIn Newsletter Name or ID',
				name: 'linkedinNewsletterUrn',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getLinkedInArticleNewsletters',
					loadOptionsDependsOn: ['articleOptions.linkedinAuthorUrn'],
				},
				default: '',
				description: 'LinkedIn only. Newsletter of the selected author; requires LinkedIn Publication Type set to Newsletter. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'LinkedIn Publication Type',
				name: 'linkedinPublicationType',
				type: 'options',
				options: [
					{ name: 'Article', value: 'article' },
					{ name: 'Newsletter', value: 'newsletter' },
				],
				default: 'article',
				description: 'LinkedIn only. Newsletter requires LinkedIn Newsletter.',
			},
			{
				displayName: 'LinkedIn Share Commentary',
				name: 'linkedinShareCommentary',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'LinkedIn only. Share text posted with the LinkedIn article (up to 2,800 characters).',
			},
			{
				displayName: 'Medium Notify Followers',
				name: 'mediumNotifyFollowers',
				type: 'boolean',
				default: false,
				description: 'Whether to email Medium followers about this story. Medium only; best effort.',
			},
			{
				displayName: 'Medium Publication Name or ID',
				name: 'mediumPublicationId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getMediumPublications' },
				default: '',
				description: 'Medium only. Submit the story to this publication instead of the personal profile. With writer-only access the story waits for editor review instead of going live at the scheduled time. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Substack Connection ID',
				name: 'substackConnectionId',
				type: 'string',
				default: '',
				description: 'Substack only. Deprecated exact connection ID, for example publicationChoices[].substackConnectionId. Prefer Substack Publication.',
			},
		],
	},
];

const noteProperties: INodeProperties[] = [
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
		displayName: 'LinkedIn Account Name or ID',
		name: 'linkedInAccountId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLinkedInAccounts' },
		default: '',
		description:
			'Optional. The LinkedIn account to post as, from GET /api/v1/linkedin/destinations (accountId). Leave as Narrareach Default to use the LinkedIn default set in Narrareach. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: { operation: ['scheduleNote'], notePlatforms: ['LINKEDIN'] },
		},
	},
	{
		displayName: 'LinkedIn Page Name or ID',
		name: 'linkedInOrganizationUrn',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getLinkedInPages',
			loadOptionsDependsOn: ['linkedInAccountId'],
		},
		default: '',
		description:
			'Optional. Posts as this Company Page (organizationUrn from GET /api/v1/linkedin/destinations, e.g. urn:li:organization:123456789). Requires LinkedIn Account. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: { operation: ['scheduleNote'], notePlatforms: ['LINKEDIN'] },
		},
	},
	{
		displayName: 'Instagram Destinations',
		name: 'instagramDestinations',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Instagram Account',
		default: {},
		description: 'Optional. Up to 5 Instagram accounts, each once, from GET /api/v1/instagram/destinations. Leave empty to post to the Instagram default.',
		displayOptions: {
			show: { operation: ['scheduleNote'], notePlatforms: ['INSTAGRAM'] },
		},
		options: [
			{
				displayName: 'Destination',
				name: 'destination',
				values: [
					{
						displayName: 'Account Name or ID',
						name: 'accountId',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getInstagramDestinations' },
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Caption',
						name: 'caption',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						description: 'Optional caption for this account (up to 2,200 characters). Leave empty to use Note Content.',
					},
				],
			},
		],
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
		displayName: 'Publish Timing',
		name: 'noteMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Schedule', value: 'schedule', description: 'Publish at Scheduled For' },
			{ name: 'Post Now', value: 'now', description: 'Publish immediately' },
		],
		default: 'schedule',
		displayOptions: showFor(['scheduleNote']),
	},
	{
		displayName: 'Scheduled For',
		name: 'scheduledFor',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { operation: ['scheduleNote'], noteMode: ['schedule'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'noteOptions',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['scheduleNote']),
		options: [
			{
				displayName: 'First Reply',
				name: 'firstReply',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Optional reply posted under the Note on platforms that support it. The response lists accepted and omitted platforms.',
			},
			{
				displayName: 'Platform Versions',
				name: 'platformVersions',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Platform Version',
				default: {},
				description: 'Text written for one platform, delivered as written. It must fit that platform\'s limit; platforms without a version are shortened automatically. Rows for unselected platforms are ignored.',
				options: [
					{
						displayName: 'Version',
						name: 'version',
						values: [
							{
								displayName: 'Platform',
								name: 'platform',
								type: 'options',
								options: platformVersionOptions,
								default: 'BLUESKY',
							},
							{
								displayName: 'Content',
								name: 'content',
								type: 'string',
								typeOptions: { rows: 4 },
								default: '',
							},
						],
					},
				],
			},
		],
	},
];

const readerActivityOperations: NarrareachOperation[] = [
	'listReaderActivities',
	'updateReaderActivity',
	'replyToReaderActivity',
];

const readerActivityProperties: INodeProperties[] = [
	{
		displayName: 'Activity ID',
		name: 'activityId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the reader activity item, as returned in activities by List Reader Activities',
		displayOptions: showFor(['updateReaderActivity', 'replyToReaderActivity']),
	},
	{
		displayName: 'State',
		name: 'activityState',
		type: 'options',
		options: [
			{ name: 'Inbox', value: 'inbox' },
			{ name: 'History', value: 'history' },
		],
		default: 'inbox',
		displayOptions: showFor(['listReaderActivities']),
	},
	{
		displayName: 'Triage State',
		name: 'triageState',
		type: 'options',
		options: [
			{ name: 'Inbox', value: 'INBOX' },
			{ name: 'History', value: 'HISTORY' },
		],
		default: 'HISTORY',
		description: 'Where to move the activity item',
		displayOptions: showFor(['updateReaderActivity']),
	},
	{
		displayName: 'Reply Text',
		name: 'replyText',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Reply published under the Substack comment (up to 5,000 characters). The activity then moves to History.',
		displayOptions: showFor(['replyToReaderActivity']),
	},
	{
		displayName: 'Substack Connection ID',
		name: 'activityConnectionId',
		type: 'string',
		default: '',
		description: 'Optional connected Substack publication ID. Leave empty to use the default publication.',
		displayOptions: showFor(readerActivityOperations),
	},
	{
		displayName: 'Additional Fields',
		name: 'readerActivityOptions',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['listReaderActivities']),
		options: [
			{
				displayName: 'Activity Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Comment', value: 'comment' },
					{ name: 'Like', value: 'like' },
					{ name: 'Restack', value: 'restack' },
				],
				default: 'all',
			},
			{
				displayName: 'Cursor',
				name: 'cursor',
				type: 'string',
				default: '',
				description: 'The nextCursor value from the previous response\'s page, to read the next page',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Sort',
				name: 'sort',
				type: 'options',
				options: [
					{ name: 'Time', value: 'time' },
					{ name: 'Relevance', value: 'relevance' },
				],
				default: 'time',
			},
		],
	},
];

const statsPlatformOptions = [
	{ name: 'Bluesky', value: 'BLUESKY' },
	{ name: 'Facebook', value: 'FACEBOOK' },
	{ name: 'Instagram', value: 'INSTAGRAM' },
	{ name: 'LinkedIn', value: 'LINKEDIN' },
	{ name: 'Medium', value: 'MEDIUM' },
	{ name: 'Pinterest', value: 'PINTEREST' },
	{ name: 'Substack', value: 'SUBSTACK' },
	{ name: 'Threads', value: 'THREADS' },
	{ name: 'TikTok', value: 'TIKTOK' },
	{ name: 'X', value: 'X' },
];

const statsProperties: INodeProperties[] = [
	{
		displayName: 'Period',
		name: 'statsPeriod',
		type: 'options',
		options: [
			{ name: 'Custom Range', value: 'custom' },
			{ name: 'Last 30 Days', value: '30d' },
			{ name: 'Last 7 Days', value: '7d' },
			{ name: 'Last 90 Days', value: '90d' },
			{ name: 'Last Day', value: '1d' },
		],
		default: '30d',
		description: 'Preset periods end on the last complete day in the account timezone',
		displayOptions: showFor(['getStatsOutcomes']),
	},
	{
		displayName: 'From',
		name: 'statsFrom',
		type: 'string',
		required: true,
		default: '',
		placeholder: '2026-09-01',
		description: 'Inclusive start date (YYYY-MM-DD)',
		displayOptions: { show: { operation: ['getStatsOutcomes'], statsPeriod: ['custom'] } },
	},
	{
		displayName: 'To',
		name: 'statsTo',
		type: 'string',
		required: true,
		default: '',
		placeholder: '2026-09-30',
		description: 'Inclusive end date (YYYY-MM-DD). It must be before today in the account timezone.',
		displayOptions: { show: { operation: ['getStatsOutcomes'], statsPeriod: ['custom'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'statsOptions',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['getStatsOutcomes']),
		options: [
			{
				displayName: 'Content Types',
				name: 'contentTypes',
				type: 'multiOptions',
				options: [
					{ name: 'Article', value: 'article' },
					{ name: 'Note', value: 'note' },
					{ name: 'Social Post', value: 'social_post' },
				],
				default: [],
				description: 'Leave empty to include every content type',
			},
			{
				displayName: 'Platforms',
				name: 'platforms',
				type: 'multiOptions',
				options: statsPlatformOptions,
				default: [],
				description: 'Connected platforms to include. Leave empty to include every connected platform.',
			},
			{
				displayName: 'Publication ID',
				name: 'publicationId',
				type: 'string',
				default: '',
				description: 'Optional connected Substack publication ID',
			},
		],
	},
];

/** Joins a multiOptions value for a comma-separated query parameter. */
function commaJoined(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value.map(trimmedString).filter((item): item is string => item !== undefined);
	return values.length > 0 ? values.join(',') : undefined;
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

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
		description: 'Schedule and manage articles and Notes, triage reader activity, and read Stats in Narrareach',
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
					{ name: 'Confirm Substack Connection', value: 'verifySubstack', action: 'Confirm your substack connection' },
					{ name: 'Get Stats Outcomes', value: 'getStatsOutcomes', action: 'Get stats outcomes' },
					{ name: 'Get Status', value: 'getStatus', action: 'Get schedule status' },
					{ name: 'List Reader Activities', value: 'listReaderActivities', action: 'List reader activities' },
					{ name: 'Reply to Reader Activity', value: 'replyToReaderActivity', action: 'Reply to a reader activity' },
					{ name: 'Reschedule', value: 'reschedule', action: 'Reschedule content' },
					{ name: 'Schedule Article', value: 'scheduleArticle', action: 'Schedule an article' },
					{ name: 'Schedule Note', value: 'scheduleNote', action: 'Schedule a note' },
					{ name: 'Update Reader Activity', value: 'updateReaderActivity', action: 'Update a reader activity' },
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
				displayName: 'Confirm Uncertain Delete',
				name: 'confirmUncertain',
				type: 'boolean',
				default: false,
				description:
					'Whether to remove a Note that is still being verified and may already be published. Narrareach then deletes only its own record; a post that already went live stays on the platform. Without this, such Notes return UNCERTAIN_DELETE_CONFIRMATION_REQUIRED.',
				displayOptions: { show: { operation: ['cancel'], mutableResource: ['note'] } },
			},
			{
				displayName: 'Verification Action', name: 'verificationAction', type: 'options', default: 'status',
				options: [
					{ name: 'Check Code Request', value: 'status' },
					{ name: 'Request a Code', value: 'start' },
					{ name: 'Submit Your Code', value: 'complete' },
					{ name: 'Cancel Code Request', value: 'cancel' },
				], displayOptions: showFor(['verifySubstack']),
				description: 'Request a code, collect it with an n8n form or approval step, then submit it here',
			},
			{
				displayName: 'Substack Connection', name: 'verificationConnectionId', type: 'string', default: '', required: true,
				displayOptions: showFor(['verifySubstack']),
				description: 'Use the connectionId returned when Substack asks for a code',
			},
			{
				displayName: 'Code Request', name: 'verificationId', type: 'string', default: '', required: true,
				displayOptions: { show: { operation: ['verifySubstack'], verificationAction: ['complete', 'cancel'] } },
				description: 'Use the code request returned by Request a Code or Check Code Request',
			},
			{
				displayName: 'Verification Code', name: 'verificationCode', type: 'string', typeOptions: { password: true }, default: '', required: true,
				displayOptions: { show: { operation: ['verifySubstack'], verificationAction: ['complete'] } },
				description: 'The six-digit code you received from Substack or your authenticator app',
			},
			...articleProperties,
			...noteProperties,
			...readerActivityProperties,
			...statsProperties,
			{
				displayName: 'Scheduled For',
				name: 'scheduledFor',
				type: 'dateTime',
				required: true,
				default: '',
				displayOptions: showFor(['reschedule']),
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
				displayOptions: showFor(['scheduleArticle', 'scheduleNote', 'replyToReaderActivity']),
			},
		],
	};

	methods = {
		loadOptions: {
			getInstagramDestinations,
			getLinkedInAccounts,
			getLinkedInArticleAuthors,
			getLinkedInArticleNewsletters,
			getLinkedInPages,
			getMediumPublications,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const operation = this.getNodeParameter('operation', itemIndex) as NarrareachOperation;
			let articleScheduleId: string | undefined;
			try {
				let resource: NarrareachResource | undefined;
				let id: string | undefined;
				let body: Record<string, unknown> | undefined;
				let confirmUncertain: boolean | undefined;
				let query: Record<string, string | number | undefined> | undefined;

				if (operation === 'verifySubstack') {
					const action = this.getNodeParameter('verificationAction', itemIndex, 'status') as string;
					body = {
						action,
						connectionId: this.getNodeParameter('verificationConnectionId', itemIndex) as string,
						...(['complete', 'cancel'].includes(action) ? { id: this.getNodeParameter('verificationId', itemIndex) as string } : {}),
						...(action === 'complete' ? { code: this.getNodeParameter('verificationCode', itemIndex) as string } : {}),
					};
				} else if (operation === 'scheduleArticle') {
					const articlePlatforms = this.getNodeParameter('articlePlatforms', itemIndex) as string[];
					const isNewArticle =
						(this.getNodeParameter('articleSource', itemIndex, 'new') as string) !== 'draft';
					const perPlatformTiming =
						(this.getNodeParameter('articleScheduleMode', itemIndex, 'shared') as string) === 'perPlatform';
					const articleOptions = this.getNodeParameter('articleOptions', itemIndex, {}) as Record<string, unknown>;

					const newArticle = (name: string, fallback?: string) => isNewArticle
						? (this.getNodeParameter(name, itemIndex, fallback) as string)
						: '';
					const coverImageUrl = newArticle('coverImageUrl', '');
					const contentHtml = newArticle('contentHtml');
					body = withoutUndefined({
						draftId: isNewArticle
							? undefined
							: trimmedString(this.getNodeParameter('draftId', itemIndex)),
						title: isNewArticle ? newArticle('title') : undefined,
						subtitle: newArticle('subtitle', '') || undefined,
						contentHtml: isNewArticle
							? resolveRelativeArticleMediaUrls(contentHtml, newArticle('sourceUrl', ''))
							: undefined,
						platforms: articlePlatforms,
						publication: articlePlatforms.includes('SUBSTACK')
							? (this.getNodeParameter('publication', itemIndex, '') as string) || undefined
							: undefined,
						scheduledFor: perPlatformTiming
							? undefined
							: (this.getNodeParameter('scheduledFor', itemIndex) as string),
						platformSchedules: perPlatformTiming
							? buildPlatformSchedules(this.getNodeParameter('platformSchedules', itemIndex, {}))
							: undefined,
						timezone: this.getNodeParameter('timezone', itemIndex, 'UTC') as string,
						coverImage: coverImageUrl
							? { sourceType: 'url', url: coverImageUrl }
							: undefined,
						media: isNewArticle
							? parseOptionalJson(this.getNodeParameter('mediaJson', itemIndex, ''))
							: undefined,
						tags: commaSeparatedValues(newArticle('tags', '')),
						sendToNewsletter: this.getNodeParameter('sendToNewsletter', itemIndex, false) as boolean,
						isPaidContent: substackAudienceToPaidContent(
							this.getNodeParameter('substackAudience', itemIndex, 'default') as string,
						),
						// paywallMarker is accepted only when a new draft is created.
						paywallMarker: articlePlatforms.includes('SUBSTACK')
							? newArticle('paywallMarker', '') || undefined
							: undefined,
						...articleOptionsToBody(articleOptions, articlePlatforms),
						idempotencyKey: this.getNodeParameter('idempotencyKey', itemIndex) as string,
					});
					if (perPlatformTiming && !body.platformSchedules) {
						throw new NodeOperationError(this.getNode(), 'Add a time for each selected platform in Platform Schedules.', { itemIndex });
					}
				} else if (operation === 'scheduleNote') {
					const notePlatforms = this.getNodeParameter('notePlatforms', itemIndex) as string[];
					const postNow = (this.getNodeParameter('noteMode', itemIndex, 'schedule') as string) === 'now';
					const noteOptions = this.getNodeParameter('noteOptions', itemIndex, {}) as Record<string, unknown>;
					// Sent only with LinkedIn so a stale value cannot fail another platform's request.
					const linkedInSelector = (name: string) => notePlatforms.includes('LINKEDIN')
						? trimmedString(this.getNodeParameter(name, itemIndex, ''))
						: undefined;
					body = withoutUndefined({
						content: this.getNodeParameter('content', itemIndex) as string,
						contentJson: parseOptionalJson(this.getNodeParameter('contentJson', itemIndex, '')),
						platforms: notePlatforms,
						linkedInAccountId: linkedInSelector('linkedInAccountId'),
						linkedInOrganizationUrn: linkedInSelector('linkedInOrganizationUrn'),
						// The API rejects Instagram destinations unless Instagram is selected.
						instagramDestinations: notePlatforms.includes('INSTAGRAM')
							? buildInstagramDestinations(this.getNodeParameter('instagramDestinations', itemIndex, {}))
							: undefined,
						mode: postNow ? 'now' : 'schedule',
						scheduledFor: postNow
							? undefined
							: (this.getNodeParameter('scheduledFor', itemIndex) as string),
						timezone: this.getNodeParameter('timezone', itemIndex, 'UTC') as string,
						imageUrls: commaSeparatedValues(this.getNodeParameter('imageUrls', itemIndex, '')),
						videoUrls: commaSeparatedValues(this.getNodeParameter('videoUrls', itemIndex, '')),
						threadsTopicTag:
							(this.getNodeParameter('threadsTopicTag', itemIndex, '') as string) || undefined,
						firstReply: trimmedString(noteOptions.firstReply),
						platformVersions: buildPlatformVersions(noteOptions.platformVersions, notePlatforms),
						idempotencyKey: this.getNodeParameter('idempotencyKey', itemIndex) as string,
					});
				} else if (operation === 'listReaderActivities') {
					const listOptions = this.getNodeParameter('readerActivityOptions', itemIndex, {}) as Record<string, unknown>;
					query = {
						state: this.getNodeParameter('activityState', itemIndex, 'inbox') as string,
						type: trimmedString(listOptions.type),
						sort: trimmedString(listOptions.sort),
						cursor: trimmedString(listOptions.cursor),
						limit: positiveInteger(listOptions.limit),
						substackConnectionId: trimmedString(this.getNodeParameter('activityConnectionId', itemIndex, '')),
					};
				} else if (operation === 'updateReaderActivity' || operation === 'replyToReaderActivity') {
					id = trimmedString(this.getNodeParameter('activityId', itemIndex));
					query = {
						substackConnectionId: trimmedString(this.getNodeParameter('activityConnectionId', itemIndex, '')),
					};
					const replyKey = operation === 'replyToReaderActivity'
						? trimmedString(this.getNodeParameter('idempotencyKey', itemIndex))
						: undefined;
					if (operation === 'replyToReaderActivity' && !replyKey) {
						throw new NodeOperationError(this.getNode(), 'Add an Idempotency Key before sending a reply.', { itemIndex });
					}
					// The reply key travels in the body only; the API rejects a header that differs from it.
					body = operation === 'updateReaderActivity'
						? { triageState: this.getNodeParameter('triageState', itemIndex) as string }
						: withoutUndefined({
							text: this.getNodeParameter('replyText', itemIndex) as string,
							idempotencyKey: replyKey,
						});
				} else if (operation === 'getStatsOutcomes') {
					const period = this.getNodeParameter('statsPeriod', itemIndex, '30d') as string;
					const statsOptions = this.getNodeParameter('statsOptions', itemIndex, {}) as Record<string, unknown>;
					// The API rejects from and to unless the period is custom.
					const customDate = (name: string) => period === 'custom'
						? trimmedString(this.getNodeParameter(name, itemIndex))
						: undefined;
					query = {
						period,
						from: customDate('statsFrom'),
						to: customDate('statsTo'),
						platforms: commaJoined(statsOptions.platforms),
						contentTypes: commaJoined(statsOptions.contentTypes),
						publicationId: trimmedString(statsOptions.publicationId),
					};
				} else {
					resource = (operation === 'getStatus'
						? this.getNodeParameter('resource', itemIndex)
						: this.getNodeParameter('mutableResource', itemIndex)) as NarrareachResource;
					id = this.getNodeParameter('id', itemIndex) as string;
					if (operation === 'reschedule') {
						body = {
							scheduledFor: this.getNodeParameter('scheduledFor', itemIndex) as string,
							timezone: this.getNodeParameter('timezone', itemIndex, 'UTC') as string,
						};
					}
					if (operation === 'cancel' && resource === 'note') {
						confirmUncertain = this.getNodeParameter('confirmUncertain', itemIndex, false) as boolean;
					}
				}

				if (resource === 'article') articleScheduleId = id;
				const request = buildNarrareachRequest({ operation, resource, id, body, confirmUncertain, query });
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

				const schedule = isRecord(response) && isRecord(response.schedule) ? response.schedule : null;
				const delivery = schedule && isRecord(schedule.substackDelivery) ? schedule.substackDelivery : null;
				if (delivery?.requiresVerification === true) {
					const verification = isRecord(delivery.verification) ? delivery.verification : {};
					const draft = isRecord(schedule?.draft) ? schedule.draft : {};
					output.push({ json: {
						...response as IDataObject,
						status: 'verification_required', deliveryConfirmed: false,
						message: 'Substack needs a verification code to confirm it’s you. Request and enter the code here, then check this schedule again.',
						verification: {
							connectionId: boundedString(verification.connectionId, 64) ?? null,
							draftId: boundedString(draft.id, 200) ?? null,
							scheduleId: boundedString(schedule?.id, 200) ?? null,
							action: 'status',
						},
					}, pairedItem: itemIndex });
				} else {
					output.push({ json: response as IDataObject, pairedItem: itemIndex });
				}
			} catch (error) {
				const failure = isRecord(error) && isRecord(error.response) && isRecord(error.response.data)
					&& isRecord(error.response.data.error) ? error.response.data.error : null;
				if (failure?.code === 'SUBSTACK_REAUTHENTICATION_REQUIRED') {
					const details = isRecord(failure.details) && isRecord(failure.details.verification) ? failure.details.verification : {};
					output.push({ json: {
						status: 'verification_required', deliveryConfirmed: false,
						message: 'Substack needs a verification code to confirm it’s you. Request and enter your code here. If you already have a schedule, check it afterward. Otherwise, retry the saved article with the same settings.',
						verification: {
							connectionId: boundedString(details.connectionId, 64) ?? null,
							draftId: boundedString(details.draftId, 200) ?? null,
							...(articleScheduleId ? { scheduleId: articleScheduleId } : {}),
							action: 'status',
						},
					}, pairedItem: itemIndex });
					continue;
				}
				let executionError: NodeApiError | NodeOperationError;
				if (operation === 'verifySubstack') {
					const messages: Record<string, string> = {
						invalid_code: 'Enter the six-digit code and use the same publication and code request.',
						code_rejected: 'Substack did not accept that code. Check it and try again.',
						expired: 'This code request has ended. Request a new code to try again.',
						cooldown: 'Please wait a minute before requesting another code.',
						hourly_limit: 'You have requested several codes. Please try again later.',
						in_progress: 'We are already checking your code. Check the code request’s status in a moment.',
						busy: 'Your Substack connection is updating. Please try again in a moment.',
						not_connected: 'We could not use this Substack connection. Contact Narrareach support for help.',
						unsupported_method: 'Substack needs you to complete this check on its own site.',
						UNAUTHORIZED: 'Connect your Narrareach account to continue.',
						FORBIDDEN: 'Your Narrareach connection does not have access to this action.',
						PAYMENT_REQUIRED: 'Your Narrareach plan does not include this action.',
					};
					const message = typeof failure?.code === 'string' ? messages[failure.code] : undefined;
					executionError = new NodeOperationError(this.getNode(), new Error(message ||
						'We could not confirm this with Substack. Check the code request’s status before trying again.'), { itemIndex });
				} else if (error instanceof NodeOperationError) {
					executionError = error;
				} else if (error && typeof error === 'object' && 'response' in error) {
					const apiErrorOptions = getNarrareachApiErrorOptions(error);
					if (apiErrorOptions && isRecord(error.response)) {
						executionError = new NodeApiError(this.getNode(), {
							status: error.response.status,
							message: apiErrorOptions.message,
							description: apiErrorOptions.description,
						} as never, { itemIndex, ...apiErrorOptions });
					} else {
						executionError = new NodeApiError(this.getNode(), error as never, { itemIndex });
					}
				} else {
					executionError = new NodeOperationError(
						this.getNode(),
						error instanceof Error ? error : new Error('Narrareach request failed.'),
						{ itemIndex },
					);
				}

				if (this.continueOnFail()) {
					output.push({
						json: operation === 'verifySubstack' ? {} : items[itemIndex].json,
						error: executionError,
						pairedItem: itemIndex,
					});
					continue;
				}
				throw executionError;
			}
		}

		return [output];
	}
}
