/**
 * Runner registry — maps runner names to their implementations.
 */

import type { Runner } from "../types.js";
import { ClaudeRunner } from "./claude.js";
import { CodexRunner } from "./codex.js";

const RUNNERS: Record<string, new () => Runner> = {
	claude: ClaudeRunner,
	codex: CodexRunner,
};

export function getRunner(name: string): Runner {
	const Cls = RUNNERS[name];
	if (!Cls) {
		const available = Object.keys(RUNNERS).sort().join(", ");
		throw new Error(`Unknown runner '${name}'. Available runners: ${available}`);
	}
	return new Cls();
}
