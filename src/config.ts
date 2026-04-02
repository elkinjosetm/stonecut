/**
 * Project-level configuration for Stonecut.
 *
 * Reads and writes `.stonecut/config.json` in the current working directory.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

/** Shape of `.stonecut/config.json`. All fields are optional. */
export interface StonecutConfig {
	runner?: string;
	baseBranch?: string;
	branchPrefix?: string;
}

const CONFIG_DIR = ".stonecut";
const CONFIG_FILE = "config.json";

function configPath(cwd?: string): string {
	return join(cwd ?? process.cwd(), CONFIG_DIR, CONFIG_FILE);
}

/**
 * Load project config from `.stonecut/config.json`.
 * Returns null if the file does not exist.
 * Returns an empty object if the file contains malformed JSON.
 */
export function loadConfig(cwd?: string): StonecutConfig | null {
	const path = configPath(cwd);
	if (!existsSync(path)) return null;

	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as StonecutConfig;
	} catch {
		return {};
	}
}

/**
 * Write a default config file to `.stonecut/config.json`.
 * Creates the `.stonecut/` directory if it doesn't exist.
 */
export function writeDefaultConfig(cwd?: string): void {
	const dir = join(cwd ?? process.cwd(), CONFIG_DIR);
	mkdirSync(dir, { recursive: true });

	const defaults: StonecutConfig = {
		runner: "claude",
		baseBranch: "main",
		branchPrefix: "stonecut/",
	};

	writeFileSync(configPath(cwd), JSON.stringify(defaults, null, 2) + "\n");
}
