import metadata from '../nodes/Narrareach/Narrareach.node.json';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	metadata.node === 'n8n-nodes-narrareach.narrareach',
	'codex metadata must identify the Narrareach node by package and node name',
);
assert(Array.isArray(metadata.categories), 'codex categories must be an array');
assert(
	metadata.categories.includes('Marketing & Content'),
	'codex metadata must use the supported Marketing & Content category',
);
assert(
	!metadata.categories.includes('Marketing'),
	'codex metadata must not use the unsupported Marketing category',
);
