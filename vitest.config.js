import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
        coverage: {
            provider: 'v8',
            include: ['js/**/*.js'],
            exclude: ['js/**/*.min.js'],
            reporter: ['text', 'html'],
        },
    },
});
