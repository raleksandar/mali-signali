import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        reporters: process.env.GITHUB_ACTIONS ? ['dot', 'github-actions'] : ['default'],
        coverage: {
            include: ['src/**/*.ts'],
            exclude: ['**/*.test.ts'],
        },
    },
});
