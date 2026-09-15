import { roleAtLeast, validatePassword, USERNAME_PATTERN } from '@empire/shared';

/**
 * These rules are shared with the client, so a regression here would let the
 * browser and the server disagree about what is valid - which shows up as an
 * unexplainable 422 rather than a helpful field error.
 */
describe('auth policy', () => {
  describe('role ranking', () => {
    it('treats a higher role as satisfying a lower requirement', () => {
      expect(roleAtLeast('SUPER_ADMIN', 'MODERATOR')).toBe(true);
      expect(roleAtLeast('ADMIN', 'MODERATOR')).toBe(true);
      expect(roleAtLeast('MODERATOR', 'MODERATOR')).toBe(true);
    });

    it('refuses a lower role', () => {
      expect(roleAtLeast('PLAYER', 'MODERATOR')).toBe(false);
      expect(roleAtLeast('MODERATOR', 'ADMIN')).toBe(false);
      expect(roleAtLeast('ADMIN', 'SUPER_ADMIN')).toBe(false);
    });

    it('lets any role satisfy PLAYER', () => {
      for (const role of ['PLAYER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'] as const) {
        expect(roleAtLeast(role, 'PLAYER')).toBe(true);
      }
    });
  });

  describe('password policy', () => {
    it('accepts a password meeting every rule', () => {
      expect(validatePassword('Frontier2026').ok).toBe(true);
    });

    it.each([
      ['too short', 'Short1a'],
      ['no uppercase', 'frontier2026'],
      ['no lowercase', 'FRONTIER2026'],
      ['no digit', 'FrontierWall'],
    ])('rejects a password that is %s', (_label, password) => {
      const result = validatePassword(password);
      expect(result.ok).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('rejects an over-long password so bcrypt is never handed unbounded input', () => {
      expect(validatePassword(`Aa1${'x'.repeat(200)}`).ok).toBe(false);
    });
  });

  describe('username pattern', () => {
    it.each(['abc', 'IronGate_92', 'a_1', 'x'.repeat(20)])('accepts %s', (name) => {
      expect(USERNAME_PATTERN.test(name)).toBe(true);
    });

    it.each([
      ['too short', 'ab'],
      ['too long', 'x'.repeat(21)],
      ['contains a space', 'iron gate'],
      ['contains punctuation', 'iron-gate'],
      ['contains an at sign', 'iron@gate'],
      ['empty', ''],
    ])('rejects a username that is %s', (_label, name) => {
      expect(USERNAME_PATTERN.test(name)).toBe(false);
    });
  });
});
