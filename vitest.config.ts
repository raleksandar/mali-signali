import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        reporters: process.env.GITHUB_ACTIONS ? ['dot', 'github-actions'] : ['default'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                '**/*.test.ts',
                'package/**',
                'src/index.ts',
                'src/store.ts',
                'src/store/index.ts',
                'src/store/internal.ts',
                'src/store/types.ts',
            ],
            reporter: ['text', 'html', 'lcov'],
        },
    },
});
