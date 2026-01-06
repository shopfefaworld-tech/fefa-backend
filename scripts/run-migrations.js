/**
 * Database Migration Runner
 * 
 * Run this script to apply database migrations after code changes.
 * 
 * Usage:
 *   npm run migrate
 *   or
 *   node scripts/run-migrations.js
 */

require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

console.log('🔄 Running database migrations...\n');

try {
  // Step 1: Check for TypeScript/linter errors first
  console.log('🔍 Checking for TypeScript errors...');
  try {
    execSync('npx tsc --noEmit', { 
      stdio: 'inherit', 
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8'
    });
    console.log('✅ No TypeScript errors found\n');
  } catch (tsError) {
    console.error('\n❌ TypeScript compilation failed!');
    console.error('Please fix all TypeScript errors before running migrations.\n');
    process.exit(1);
  }

  // Step 2: Compile TypeScript
  console.log('📦 Compiling TypeScript...');
  execSync('npx tsc', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('✅ TypeScript compiled successfully\n');
  
  // Step 3: Run migrations
  console.log('🚀 Executing migrations...');
  execSync('node dist/src/utils/migrations.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  
  console.log('\n✅ Migration process completed!');
} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  process.exit(1);
}
