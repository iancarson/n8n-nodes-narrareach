import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { trimmedString } from './transport';

export const NARRAREACH_CLIENT_HEADER = 'n8n-nodes-narrareach/0.3.0';

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

async function narrareachGet(
	context: ILoadOptionsFunctions,
	path: string,
): Promise<Record<string, unknown>> {
	const credentials = await context.getCredentials('narrareachApi');
	const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
	const response: unknown = await context.helpers.httpRequestWithAuthentication.call(
		context,
		'narrareachApi',
		{
			method: 'GET',
			url: `${baseUrl}${path}`,
			json: true,
			headers: { 'x-narrareach-client': NARRAREACH_CLIENT_HEADER },
		},
	);
	return isRecord(response) ? response : {};
}

function currentString(context: ILoadOptionsFunctions, path: string): string | undefined {
	try {
		return trimmedString(context.getCurrentNodeParameter(path));
	} catch {
		return undefined;
	}
}

/** GET /api/v1/linkedin/destinations — one option per connected LinkedIn account. */
export async function getLinkedInAccounts(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await narrareachGet(this, '/api/v1/linkedin/destinations');
	const options: INodePropertyOptions[] = [{ name: 'Narrareach Default', value: '' }];
	const seen = new Set<string>();
	// Profiles first so an account is labelled by its member profile when it has one.
	const destinations = records(response.destinations)
		.sort((a, b) => Number(a.kind === 'page') - Number(b.kind === 'page'));
	for (const destination of destinations) {
		const accountId = trimmedString(destination.accountId);
		if (!accountId || seen.has(accountId)) continue;
		seen.add(accountId);
		const label = trimmedString(destination.label) ?? accountId;
		options.push({
			name: destination.kind === 'page' ? `${label} (Page account)` : label,
			value: accountId,
		});
	}
	return options;
}

/** GET /api/v1/linkedin/destinations — Company Pages, limited to the selected account. */
export async function getLinkedInPages(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const accountId = currentString(this, 'linkedInAccountId');
	const options: INodePropertyOptions[] = [{ name: 'None (Post as the Profile)', value: '' }];
	if (!accountId) return options;
	const response = await narrareachGet(this, '/api/v1/linkedin/destinations');
	for (const destination of records(response.destinations)) {
		const organizationUrn = trimmedString(destination.organizationUrn);
		if (!organizationUrn) continue;
		if (trimmedString(destination.accountId) !== accountId) continue;
		options.push({ name: trimmedString(destination.label) ?? organizationUrn, value: organizationUrn });
	}
	return options;
}

/** GET /api/v1/instagram/destinations — accounts that can be named in instagramDestinations. */
export async function getInstagramDestinations(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await narrareachGet(this, '/api/v1/instagram/destinations');
	return records(response.destinations).flatMap((destination) => {
		const accountId = trimmedString(destination.accountId);
		// Accounts outside the plan's Instagram allowance are rejected when scheduling.
		if (!accountId || destination.available === false) return [];
		const label = trimmedString(destination.label) ?? accountId;
		const suffix = destination.isDefault === true ? ' (default)' : '';
		return [{ name: `${label}${suffix}`, value: accountId }];
	});
}

/** GET /api/v1/linkedin/article-destinations — profile and Company Page article authors. */
export async function getLinkedInArticleAuthors(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await narrareachGet(this, '/api/v1/linkedin/article-destinations');
	const options: INodePropertyOptions[] = [{ name: 'Narrareach Default', value: '' }];
	for (const author of records(response.authors)) {
		const urn = trimmedString(author.urn);
		if (!urn) continue;
		const label = trimmedString(author.label) ?? urn;
		options.push({ name: author.kind === 'page' ? `${label} (Page)` : label, value: urn });
	}
	return options;
}

/** GET /api/v1/linkedin/article-destinations?authorUrn= — newsletters for the selected author. */
export async function getLinkedInArticleNewsletters(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const authorUrn = currentString(this, 'articleOptions.linkedinAuthorUrn');
	const path = authorUrn
		? `/api/v1/linkedin/article-destinations?authorUrn=${encodeURIComponent(authorUrn)}`
		: '/api/v1/linkedin/article-destinations';
	const response = await narrareachGet(this, path);
	const options: INodePropertyOptions[] = [{ name: 'None', value: '' }];
	for (const newsletter of records(response.newsletters)) {
		const urn = trimmedString(newsletter.urn);
		if (!urn) continue;
		if (authorUrn && trimmedString(newsletter.authorUrn) !== authorUrn) continue;
		options.push({ name: trimmedString(newsletter.title) ?? urn, value: urn });
	}
	return options;
}

/** GET /api/v1/medium/publications — publications the connected Medium account can submit to. */
export async function getMediumPublications(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await narrareachGet(this, '/api/v1/medium/publications');
	const options: INodePropertyOptions[] = [{ name: 'Personal Profile', value: '' }];
	for (const publication of records(response.publications)) {
		const id = trimmedString(publication.id);
		if (!id) continue;
		const name = trimmedString(publication.name) ?? id;
		options.push({
			name: publication.canPublish === false ? `${name} (submitted for editor review)` : name,
			value: id,
		});
	}
	return options;
}
