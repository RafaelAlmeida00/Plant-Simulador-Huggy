// src/__tests__/security/env-validation.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Security Environment Validation', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules?.();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('validateSecurityEnvironment', () => {
        it('should throw when required vars have invalid values', async () => {
            // Set invalid values
            process.env.NEXTAUTH_CSRF_URL = 'not-a-url';
            process.env.NEXTAUTH_SECRET = 'short';

            const { validateSecurityEnvironment } = await import('../../config/security-config');

            expect(() => validateSecurityEnvironment()).toThrow('Environment validation failed');
        });

        it('should pass when optional vars are missing', async () => {
            // Remove optional vars
            delete process.env.NEXTAUTH_CSRF_URL;
            delete process.env.NEXTAUTH_SECRET;

            const { validateSecurityEnvironment } = await import('../../config/security-config');

            // Should not throw - these are optional
            expect(() => validateSecurityEnvironment()).not.toThrow();
        });

        it('should pass when all vars are valid', async () => {
            process.env.NEXTAUTH_CSRF_URL = 'https://auth.example.com/csrf';
            process.env.NEXTAUTH_SECRET = 'a'.repeat(32);

            const { validateSecurityEnvironment } = await import('../../config/security-config');

            expect(() => validateSecurityEnvironment()).not.toThrow();
        });
    });

    describe('requireEnv', () => {
        it('should return value when env var is set', async () => {
            process.env.TEST_VAR = 'test-value';

            const { requireEnv } = await import('../../config/security-config');

            expect(requireEnv('TEST_VAR')).toBe('test-value');
        });

        it('should throw when env var is not set', async () => {
            delete process.env.MISSING_VAR;

            const { requireEnv } = await import('../../config/security-config');

            expect(() => requireEnv('MISSING_VAR')).toThrow('Required environment variable');
        });
    });

    describe('optionalEnv', () => {
        it('should return value when env var is set', async () => {
            process.env.OPTIONAL_VAR = 'custom-value';

            const { optionalEnv } = await import('../../config/security-config');

            expect(optionalEnv('OPTIONAL_VAR', 'default')).toBe('custom-value');
        });

        it('should return default when env var is not set', async () => {
            delete process.env.MISSING_OPTIONAL;

            const { optionalEnv } = await import('../../config/security-config');

            expect(optionalEnv('MISSING_OPTIONAL', 'default-value')).toBe('default-value');
        });
    });
});
