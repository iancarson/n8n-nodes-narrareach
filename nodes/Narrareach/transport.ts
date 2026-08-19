export type NarrareachResource = 'article' | 'note' | 'operation';
export type NarrareachOperation =
	| 'scheduleArticle'
	| 'scheduleNote'
	| 'getStatus'
	| 'reschedule'
	| 'cancel';

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
};

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

	if (!input.resource || !input.id) {
		throw new Error('Resource and schedule ID are required.');
	}
	if (input.resource === 'operation' && input.operation !== 'getStatus') {
		throw new Error('Automation operations can only be read.');
	}

	const path = resourcePath(input.resource, input.id);
	if (input.operation === 'getStatus') return { method: 'GET', path };
	if (input.operation === 'reschedule') return { method: 'PATCH', path, body: input.body };
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
