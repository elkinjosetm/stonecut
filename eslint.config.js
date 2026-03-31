import tseslint from "typescript-eslint";

export default tseslint.config(
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "tests/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
	},
	{
		ignores: ["dist/", "node_modules/"],
	},
);
