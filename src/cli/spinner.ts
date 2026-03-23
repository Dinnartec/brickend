/**
 * Simple terminal spinner that writes directly to stderr.
 * Compatible with Windows PowerShell (no ANSI cursor manipulation).
 * Uses a single line that updates in-place via \r.
 */

const FRAMES = ["   ", ".  ", ".. ", "..."];
const INTERVAL = 300;

export interface Spinner {
	update: (msg: string) => void;
	stop: (msg: string, symbol?: string) => void;
}

export function startSpinner(message: string): Spinner {
	let frameIndex = 0;
	let currentMsg = message;
	let stopped = false;

	const timer = setInterval(() => {
		if (stopped) return;
		const frame = FRAMES[frameIndex % FRAMES.length];
		process.stderr.write(`\r  ${frame} ${currentMsg}`);
		frameIndex++;
	}, INTERVAL);

	// Write initial frame
	process.stderr.write(`\r  ${FRAMES[0]} ${currentMsg}`);

	return {
		update(msg: string) {
			currentMsg = msg;
		},
		stop(msg: string, symbol = "+") {
			stopped = true;
			clearInterval(timer);
			process.stderr.write(`\r  ${symbol} ${msg}\n`);
		},
	};
}
