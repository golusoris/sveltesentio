// Fixtures for .semgrep.yml: `ruleid:` lines must be reported, `ok:` lines must not.
import { exec, execFile, spawn } from 'node:child_process';
import * as cp from 'child_process';

declare const input: string;
declare const host: HTMLElement;
declare function sanitizeHtml(raw: string): string;

export function dynamicCode(): unknown {
	// ruleid: no-eval
	eval(input);
	// ruleid: no-function-constructor
	const fn = new Function(input);
	// ruleid: no-string-timer
	setTimeout('tick()', 10);
	// ok: no-string-timer
	setTimeout(() => fn(), 10);
	// ok: no-eval
	return JSON.parse(input);
}

export function processes(): void {
	// ruleid: no-shell-child-process
	exec(`ls ${input}`);
	// ruleid: no-shell-child-process
	cp.execSync(input);
	// ruleid: no-shell-child-process
	spawn('sh', ['-c', input], { shell: true });
	// ok: no-shell-child-process
	spawn('git', ['status'], { shell: false });
	// ok: no-shell-child-process
	execFile('git', ['log', input]);
	// ok: no-shell-child-process
	/^(\d+)$/.exec(input);
}

export function sinks(): void {
	// ruleid: no-unsanitised-html-sink
	host.innerHTML = input;
	// ruleid: no-unsanitised-html-sink
	host.insertAdjacentHTML('beforeend', input);
	// ok: no-unsanitised-html-sink
	host.innerHTML = sanitizeHtml(input);
	// ok: no-unsanitised-html-sink
	host.innerHTML = '';
	// ok: no-unsanitised-html-sink
	host.textContent = input;
}
