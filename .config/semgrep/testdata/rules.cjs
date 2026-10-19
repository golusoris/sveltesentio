// Fixtures for .semgrep.yml in CommonJS: the require binding of child_process.
const cp = require('node:child_process');

function run(input) {
	// ruleid: no-shell-child-process
	cp.exec(input);
	// ruleid: no-shell-child-process
	cp.spawnSync('sh', ['-c', input], { shell: '/bin/sh' });
	// ok: no-shell-child-process
	cp.execFileSync('git', ['log', input]);
	// ruleid: no-eval
	return eval(input);
}

module.exports = { run };
