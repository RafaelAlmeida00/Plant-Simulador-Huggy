import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Exclude dist folder from test discovery
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/cypress/**',
            '**/.{idea,git,cache,output,temp}/**',
            '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*'
        ],
        // Only include TypeScript source files
        include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        // Use ts-node for TypeScript
        globals: true
    }
});
