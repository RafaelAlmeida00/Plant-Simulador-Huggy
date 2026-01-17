// src/config/security-config.ts

/**
 * Security Configuration Module
 * Centralizes security-critical environment validation
 * Must be called at application startup (fail-fast)
 */

interface SecurityConfig {
    csrf: {
        url: string;
        enabled: boolean;
    };
    auth: {
        secret: string;
    };
}

interface EnvValidation {
    name: string;
    required: boolean;
    validator?: (value: string) => boolean;
    errorMessage?: string;
}

const SECURITY_ENV_VARS: EnvValidation[] = [
    {
        name: 'NEXTAUTH_CSRF_URL',
        required: false, // Only required if CSRF middleware is enabled
        validator: (v) => {
            try { new URL(v); return true; } catch { return false; }
        },
        errorMessage: 'Must be a valid URL'
    },
    {
        name: 'NEXTAUTH_SECRET',
        required: false, // Only required if auth middleware is enabled
        validator: (v) => v.length >= 16,
        errorMessage: 'Must be at least 16 characters'
    }
];

/**
 * Validates all security-critical environment variables
 * Logs warnings for missing optional vars, throws for invalid values
 */
export function validateSecurityEnvironment(): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const envVar of SECURITY_ENV_VARS) {
        const value = process.env[envVar.name];

        if (!value) {
            if (envVar.required) {
                errors.push(`${envVar.name}: Missing required security variable`);
            } else {
                warnings.push(`${envVar.name}: Not configured (middleware will be disabled)`);
            }
            continue;
        }

        if (envVar.validator && !envVar.validator(value)) {
            errors.push(`${envVar.name}: ${envVar.errorMessage || 'Validation failed'}`);
        }
    }

    // Log warnings but continue
    warnings.forEach(w => console.warn(`[SECURITY WARNING] ${w}`));

    // Errors are fatal
    if (errors.length > 0) {
        console.error('='.repeat(60));
        console.error('[SECURITY FATAL] Environment validation failed:');
        errors.forEach(e => console.error(`  - ${e}`));
        console.error('='.repeat(60));
        throw new Error('Application cannot start with invalid security configuration');
    }

    console.log('[SECURITY] Environment validation passed');
}

/**
 * Returns validated security configuration
 * Should only be called AFTER validateSecurityEnvironment()
 */
export function getSecurityConfig(): SecurityConfig {
    return {
        csrf: {
            url: process.env.NEXTAUTH_CSRF_URL || '',
            enabled: !!process.env.NEXTAUTH_CSRF_URL
        },
        auth: {
            secret: process.env.NEXTAUTH_SECRET || ''
        }
    };
}

/**
 * Helper to access required environment variables with type safety
 * Use instead of `process.env.VAR as string`
 * @throws Error if the variable is not set
 */
export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`[CONFIG] Required environment variable ${name} is not set`);
    }
    return value;
}

/**
 * Helper to access optional environment variables with a default value
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 */
export function optionalEnv(name: string, defaultValue: string): string {
    return process.env[name] || defaultValue;
}
