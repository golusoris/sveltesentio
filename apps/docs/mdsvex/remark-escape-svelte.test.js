import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { remarkEscapeSvelte } from './remark-escape-svelte.js';

describe('remarkEscapeSvelte', () => {
	it('escapes {, }, and < in text nodes and tags them as html', () => {
		const tree = {
			type: 'root',
			children: [
				{
					type: 'text',
					value: 'Values: < 500 and {count} and > 10 & bare',
				},
			],
		};

		remarkEscapeSvelte()(tree);
		assert.deepEqual(tree.children[0], {
			type: 'html',
			value: 'Values: &lt; 500 and &lbrace;count&rbrace; and &gt; 10 &amp; bare',
		});
	});

	it('leaves code and inlineCode nodes untouched', () => {
		const tree = {
			type: 'root',
			children: [
				{ type: 'code', value: '<Component> {props}' },
				{ type: 'inlineCode', value: '<tag> {val}' },
			],
		};

		remarkEscapeSvelte()(tree);
		assert.equal(tree.children[0].type, 'code');
		assert.equal(tree.children[0].value, '<Component> {props}');
		assert.equal(tree.children[1].type, 'inlineCode');
		assert.equal(tree.children[1].value, '<tag> {val}');
	});

	it('does not descend into a code node, even one that carries children', () => {
		const tree = {
			type: 'root',
			children: [{ type: 'code', children: [{ type: 'text', value: '<inner>' }] }],
		};

		remarkEscapeSvelte()(tree);
		assert.deepEqual(tree.children[0].children[0], { type: 'text', value: '<inner>' });
	});

	it('leaves intentional html nodes untouched', () => {
		const tree = {
			type: 'root',
			children: [
				{ type: 'html', value: '<div class="container">' },
				{ type: 'html', value: '<!-- comment -->' },
				{ type: 'html', value: '<span id="test">hello</span>' },
			],
		};

		remarkEscapeSvelte()(tree);
		assert.equal(tree.children[0].value, '<div class="container">');
		assert.equal(tree.children[1].value, '<!-- comment -->');
		assert.equal(tree.children[2].value, '<span id="test">hello</span>');
	});

	it('escapes html nodes that do not look like intentional html tags', () => {
		const tree = {
			type: 'root',
			children: [
				{ type: 'html', value: '<T>' },
				{ type: 'html', value: '<subject>' },
				{ type: 'html', value: '<DialogPrimitive>' },
			],
		};

		remarkEscapeSvelte()(tree);
		assert.equal(tree.children[0].value, '&lt;T&gt;');
		assert.equal(tree.children[1].value, '&lt;subject&gt;');
		assert.equal(tree.children[2].value, '&lt;DialogPrimitive&gt;');
	});

	it('traverses nested children 4 levels deep', () => {
		const leaf = { type: 'text', value: 'nested < 42 {x}' };
		const tree = {
			type: 'root',
			children: [
				{
					type: 'paragraph',
					children: [
						{
							type: 'strong',
							children: [
								{
									type: 'emphasis',
									children: [leaf],
								},
							],
						},
					],
				},
			],
		};

		remarkEscapeSvelte()(tree);
		assert.equal(leaf.type, 'html');
		assert.equal(leaf.value, 'nested &lt; 42 &lbrace;x&rbrace;');
	});

	it('handles empty trees gracefully', () => {
		const emptyTree = { type: 'root', children: [] };
		remarkEscapeSvelte()(emptyTree);
		assert.deepEqual(emptyTree, { type: 'root', children: [] });

		const noChildrenTree = { type: 'root' };
		remarkEscapeSvelte()(noChildrenTree);
		assert.deepEqual(noChildrenTree, { type: 'root' });
	});

	it('handles 20000 levels deep tree without stack overflow', () => {
		const root = { type: 'root', children: [] };
		let current = root;
		for (let i = 0; i < 20000; i++) {
			const next = { type: 'node', children: [] };
			current.children.push(next);
			current = next;
		}
		current.children.push({ type: 'text', value: '<deep>' });

		remarkEscapeSvelte()(root);
		const leaf = current.children[0];
		assert.equal(leaf.type, 'html');
		assert.equal(leaf.value, '&lt;deep&gt;');
	});
});
