import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProjectPath, pickLegacyWorkspaceId, sameProject } from './project-path.ts';

test('normalizeProjectPath lowercases, strips slashes, and drops .terrific', () => {
  equal(normalizeProjectPath('d:\\x\\y'), 'd:/x/y');
  equal(normalizeProjectPath('D:\\x\\y\\'), 'd:/x/y');
  equal(normalizeProjectPath('D:\\x\\y\\.terrific'), 'd:/x/y');
  equal(normalizeProjectPath('D:\\x\\y\\.Terrific\\'), 'd:/x/y');
  equal(normalizeProjectPath('D:/x/y/.terrific'), 'd:/x/y');
  equal(normalizeProjectPath('D:/x/y/'), 'd:/x/y');
});

test('sameProject treats mixed case, slashes, and a trailing .terrific as one path', () => {
  equal(sameProject('d:\\x\\y', 'D:\\x\\y\\'), true);
  equal(sameProject('d:\\x\\y', 'D:\\x\\y\\.terrific'), true);
  equal(sameProject('d:\\x\\y', 'D:/x/y'), true);
  equal(sameProject('d:\\x\\y', 'D:\\x\\z'), false);
});

test('pickLegacyWorkspaceId returns the most recently accessed match', () => {
  const workspaces = [
    { id: 'oldid001', path: 'D:\\x\\y', lastAccessedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'newid002', path: 'd:\\x\\y\\.terrific', lastAccessedAt: '2026-06-01T00:00:00.000Z' },
    { id: 'other003', path: 'D:\\x\\z', lastAccessedAt: '2026-12-01T00:00:00.000Z' },
  ];
  equal(pickLegacyWorkspaceId('D:/x/y/', workspaces), 'newid002');
});

test('pickLegacyWorkspaceId treats a missing lastAccessedAt as oldest', () => {
  const workspaces = [
    { id: 'missing1', path: 'D:\\x\\y' },
    { id: 'dated002', path: 'D:\\x\\y\\', lastAccessedAt: '2025-01-01T00:00:00.000Z' },
  ];
  equal(pickLegacyWorkspaceId('d:\\x\\y', workspaces), 'dated002');
});

test('pickLegacyWorkspaceId returns null when nothing matches', () => {
  equal(pickLegacyWorkspaceId('D:\\x\\y', [{ id: 'noid0001', path: 'D:\\other' }]), null);
  equal(pickLegacyWorkspaceId('D:\\x\\y', []), null);
});
