// src/__tests__/security/csrf.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('CSRF Protection', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('Configuration Validation', () => {
        it('should throw when NEXTAUTH_CSRF_URL is missing', async () => {
            delete process.env.NEXTAUTH_CSRF_URL;

            // Dynamic import to get fresh module with new env
            const { validateCsrfConfig } = await import('../../adapters/http/middleware/csrf');

            expect(() => validateCsrfConfig()).toThrow('NEXTAUTH_CSRF_URL not configured');
        });

        it('should throw when NEXTAUTH_CSRF_URL is invalid URL', async () => {
            process.env.NEXTAUTH_CSRF_URL = 'not-a-valid-url';

            const { validateCsrfConfig } = await import('../../adapters/http/middleware/csrf');

            expect(() => validateCsrfConfig()).toThrow('not a valid URL');
        });

        it('should pass validation with valid URL', async () => {
            process.env.NEXTAUTH_CSRF_URL = 'https://auth.example.com/api/csrf';

            const { validateCsrfConfig } = await import('../../adapters/http/middleware/csrf');

            expect(() => validateCsrfConfig()).not.toThrow();
        });
    });
});
