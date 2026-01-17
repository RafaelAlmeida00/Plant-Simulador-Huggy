#!/usr/bin/env ts-node
// scripts/validate-env.ts
// Run in CI/CD before deploy: npx ts-node scripts/validate-env.ts

interface EnvCheck {
    name: string;
    required: boolean;
    pattern?: RegExp;
    minLength?: number;
}

const REQUIRED_VARS: EnvCheck[] = [
    { name: 'NEXTAUTH_CSRF_URL', required: false, pattern: /^https?:\/\// },
    { name: 'NEXTAUTH_SECRET', required: false, minLength: 16 },
    { name: 'DATABASE_URL', required: true, pattern: /^postgres(ql)?:\/\// },
    { name: 'NODE_ENV', required: false, pattern: /^(development|staging|production)$/ },
];

function validateEnvironment(): boolean {
    console.log('Validating security environment...\n');

    let hasErrors = false;
    const results: string[] = [];

    for (const check of REQUIRED_VARS) {
        const value = process.env[check.name];
        let status = 'OK';
        let message = '';

        if (!value) {
            if (check.required) {
                status = 'FAIL';
                message = 'MISSING (required)';
                hasErrors = true;
            } else {
                status = 'SKIP';
                message = 'not set (optional)';
            }
        } else {
            if (check.pattern && !check.pattern.test(value)) {
                status = 'FAIL';
                message = `invalid format (expected: ${check.pattern})`;
                hasErrors = true;
            } else if (check.minLength && value.length < check.minLength) {
                status = 'FAIL';
                message = `too short (min: ${check.minLength} chars)`;
                hasErrors = true;
            } else {
                message = 'OK';
            }
        }

        results.push(`  [${status}] ${check.name}: ${message}`);
    }

    console.log(results.join('\n'));
    console.log('');

    if (hasErrors) {
        console.error('[FAIL] Environment validation FAILED');
        console.error('   Fix the issues above before deploying.\n');
        return false;
    }

    console.log('[PASS] Environment validation PASSED\n');
    return true;
}

// Execute
const isValid = validateEnvironment();
process.exit(isValid ? 0 : 1);
