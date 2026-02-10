/**
 * Database Migration Runner
 *
 * Usage:
 *   npm run migrate
 *   node scripts/run-migrations.js
 */

require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

console.log('Running database migrations...\n');

try {
  console.log('Checking for TypeScript errors...');
  try {
    execSync('npx tsc --noEmit', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });
    console.log('No TypeScript errors found\n');
  } catch (tsError) {
    console.error('\nTypeScript compilation failed!');
    console.error('Fix TypeScript errors before running migrations.\n');
    process.exit(1);
  }

  console.log('Compiling TypeScript...');
  execSync('npx tsc', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('TypeScript compiled successfully\n');

  console.log('Executing migrations (review defaults, settings seed, shipping tracking normalization)...');
  execSync('node dist/src/utils/migrations.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

  console.log('\nMigration process completed successfully.');
} catch (error) {
  console.error('\nMigration failed:', error.message);
  process.exit(1);
}
