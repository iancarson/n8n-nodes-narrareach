import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NarrareachApi implements ICredentialType {
	name = 'narrareachApi';
	displayName = 'Narrareach API';
	icon: Icon = {
		light: 'file:../icons/narrareach.svg',
		dark: 'file:../icons/narrareach.dark.svg',
	};
	documentationUrl = 'https://www.narrareach.com/api-docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Automation token created in Narrareach settings',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://www.narrareach.com',
			description: 'Change only when testing against a private Narrareach environment',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.baseUrl.endsWith("/") ? $credentials.baseUrl.slice(0, -1) : $credentials.baseUrl}}',
			url: '/api/v1/auth/check',
			method: 'GET',
		},
	};
}
