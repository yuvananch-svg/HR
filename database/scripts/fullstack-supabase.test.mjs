import test from 'node:test';
import assert from 'node:assert/strict';
import { guardLocalEndpoints } from './fullstack-supabase.mjs';

test('fullstack Supabase guard accepts only the designated local API and database endpoints', () => {
  assert.doesNotThrow(() => guardLocalEndpoints(
    'http://127.0.0.1:54321',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ));
});

test('fullstack Supabase guard rejects remote, alternate-host, and alternate-port targets', () => {
  const rejected = [
    ['https://project.supabase.co', 'postgresql://postgres:pw@127.0.0.1:54322/postgres'],
    ['http://localhost:54321', 'postgresql://postgres:pw@127.0.0.1:54322/postgres'],
    ['http://127.0.0.1:54322', 'postgresql://postgres:pw@127.0.0.1:54322/postgres'],
    ['http://127.0.0.1:54321', 'postgresql://postgres:pw@localhost:54322/postgres'],
    ['http://127.0.0.1:54321', 'postgresql://postgres:pw@127.0.0.1:54322/other'],
    ['http://127.0.0.1:54321/?target=prod', 'postgresql://postgres:pw@127.0.0.1:54322/postgres'],
    ['http://user@127.0.0.1:54321', 'postgresql://postgres:pw@127.0.0.1:54322/postgres'],
    ['http://127.0.0.1:54321', 'postgresql://postgres:pw@127.0.0.1:54322/postgres?options=unsafe'],
    ['http://127.0.0.1:54321', 'not-a-database-url'],
  ];
  for (const [apiUrl, dbUrl] of rejected) assert.throws(() => guardLocalEndpoints(apiUrl, dbUrl));
});
