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
	},
	{
		ignores: ["dist/", "node_modules/"],
	},
);
