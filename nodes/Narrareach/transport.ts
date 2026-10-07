export type NarrareachResource = 'article' | 'note' | 'operation';
export type NarrareachOperation =
	| 'scheduleArticle'
	| 'scheduleNote'
	| 'getStatus'
	| 'reschedule'
	| 'cancel'
	| 'listReaderActivities'
	| 'updateReaderActivity'
	| 'replyToReaderActivity'
	| 'getStatsOutcomes';

export type NarrareachRequest = {
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	path: string;
	body?: Record<string, unknown>;
};

export type NarrareachRequestInput = {
	operation: NarrareachOperation;
	resource?: NarrareachResource;
	id?: string;
	body?: Record<string, unknown>;
	/** Note cancellation only: also remove a Note whose publication could not be confirmed. */
	confirmUncertain?: boolean;
	/** Query parameters; undefined values are left out. */
	query?: Record<string, string | number | undefined>;
};

function withQuery(path: string, query: NarrareachRequestInput['query']): string {
	const params = new URLSearchParams();
	for (const [name, value] of Object.entries(query ?? {})) {
		if (value !== undefined) params.set(name, String(value));
	}
	const search = params.toString();
	return search ? `${path}?${search}` : path;
}

function readerActivityPath(id: string | undefined): string {
	if (!id) throw new Error('Reader activity ID is required.');
	return `/api/v1/reader-activities/${encodeURIComponent(id)}`;
}

function resourcePath(resource: NarrareachResource, id: string): string {
	const encodedId = encodeURIComponent(id);
	if (resource === 'article') return `/api/v1/article-schedules/${encodedId}`;
	if (resource === 'note') return `/api/v1/notes/${encodedId}`;
	return `/api/v1/operations/${encodedId}`;
}

export function buildNarrareachRequest(input: NarrareachRequestInput): NarrareachRequest {
	if (input.operation === 'scheduleArticle') {
		return { method: 'POST', path: '/api/v1/articles', body: input.body };
	}
	if (input.operation === 'scheduleNote') {
		return { method: 'POST', path: '/api/v1/notes', body: input.body };
	}
	if (input.operation === 'listReaderActivities') {
		return { method: 'GET', path: withQuery('/api/v1/reader-activities', input.query) };
	}
	if (input.operation === 'updateReaderActivity') {
		return { method: 'PATCH', path: withQuery(readerActivityPath(input.id), input.query), body: input.body };
	}
	if (input.operation === 'replyToReaderActivity') {
		return {
			method: 'POST',
			path: withQuery(`${readerActivityPath(input.id)}/replies`, input.query),
			body: input.body,
		};
	}
	if (input.operation === 'getStatsOutcomes') {
		return { method: 'GET', path: withQuery('/api/v1/stats/outcomes', input.query) };
	}

	if (!input.resource || !input.id) {
		throw new Error('Resource and schedule ID are required.');
	}
	if (input.resource === 'operation' && input.operation !== 'getStatus') {
		throw new Error('Automation operations can only be read.');
	}

	const path = resourcePath(input.resource, input.id);
	if (input.operation === 'getStatus') return { method: 'GET', path };
	if (input.operation === 'reschedule') return { method: 'PATCH', path, body: input.body };
	// Only DELETE /api/v1/notes/{id} understands confirm_uncertain.
	if (input.resource === 'note' && input.confirmUncertain === true) {
		return { method: 'DELETE', path: `${path}?confirm_uncertain=true` };
	}
	return { method: 'DELETE', path };
}

export function parseOptionalJson(value: unknown): unknown {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') return value;
	return JSON.parse(value);
}

export function commaSeparatedValues(value: unknown): string[] | undefined {
	if (typeof value !== 'string') return undefined;
	const values = value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
}

export function resolveRelativeArticleMediaUrls(contentHtml: string, sourceUrl: string): string {
	const baseUrl = sourceUrl.trim();
	if (!baseUrl) return contentHtml;

	return contentHtml.replace(
		/(<(?:video|source)\b[^>]*?\bsrc\s*=\s*(["']))([^"']+)(\2)/gi,
		(fullMatch, prefix: string, _quote: string, rawUrl: string, suffix: string) => {
			try {
				const resolved = new URL(rawUrl.trim(), baseUrl);
				if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return fullMatch;
				return `${prefix}${resolved.toString()}${suffix}`;
			} catch {
				return fullMatch;
			}
		},
	);
}

export function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function trimmedString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Reads the rows of an n8n fixedCollection parameter, e.g. `{ schedule: [...] }`. */
export function fixedCollectionRows(value: unknown, key: string): Record<string, unknown>[] {
	if (!isRecord(value)) return [];
	const rows = value[key];
	return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

/** Builds `platformSchedules` for POST /api/v1/articles: `[{ platform, scheduledFor }]`. */
export function buildPlatformSchedules(
	value: unknown,
): Array<{ platform: string; scheduledFor: string }> | undefined {
	const schedules = fixedCollectionRows(value, 'schedule').flatMap((row) => {
		const platform = trimmedString(row.platform);
		const scheduledFor = trimmedString(row.scheduledFor);
		return platform && scheduledFor ? [{ platform, scheduledFor }] : [];
	});
	return schedules.length > 0 ? schedules : undefined;
}

/** Builds `instagramDestinations` for POST /api/v1/notes: `[{ accountId, caption? }]`. */
export function buildInstagramDestinations(
	value: unknown,
): Array<{ accountId: string; caption?: string }> | undefined {
	const destinations = fixedCollectionRows(value, 'destination').flatMap((row) => {
		const accountId = trimmedString(row.accountId);
		if (!accountId) return [];
		const caption = trimmedString(row.caption);
		return [caption ? { accountId, caption } : { accountId }];
	});
	return destinations.length > 0 ? destinations : undefined;
}

/**
 * Builds `platformVersions` for POST /api/v1/notes, keyed by platform. Rows for a
 * platform that is not selected are dropped so a stale row cannot fail the request.
 */
export function buildPlatformVersions(
	value: unknown,
	selectedPlatforms: readonly string[],
): Record<string, string> | undefined {
	const versions: Record<string, string> = {};
	for (const row of fixedCollectionRows(value, 'version')) {
		const platform = trimmedString(row.platform);
		const content = trimmedString(row.content);
		if (platform && content && selectedPlatforms.includes(platform)) versions[platform] = content;
	}
	return Object.keys(versions).length > 0 ? versions : undefined;
}
