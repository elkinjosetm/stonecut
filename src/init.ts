/**
 * Scaffolds a `.stonecut/` project directory with config and gitignore.
 */

import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { writeDefaultConfig } from "./config";

const CONFIG_DIR = ".stonecut";
const CONFIG_FILE = "config.json";
const GITIGNORE_FILE = ".gitignore";

const GITIGNORE_CONTENT = `# Stonecut runtime artifacts
logs/
status.json
progress.txt
`;

/**
 * Initialize a `.stonecut/` directory with config and gitignore.
 * Throws if `config.json` already exists to prevent accidental overwrites.
 */
export function init(cwd?: string): void {
	const base = cwd ?? process.cwd();
	const configPath = join(base, CONFIG_DIR, CONFIG_FILE);

	if (existsSync(configPath)) {
		throw new Error(
			`.stonecut/config.json already exists. Remove it first if you want to reinitialize.`,
		);
	}

	const dir = join(base, CONFIG_DIR);
	mkdirSync(dir, { recursive: true });

	writeDefaultConfig(cwd);
	writeFileSync(join(dir, GITIGNORE_FILE), GITIGNORE_CONTENT);
}
