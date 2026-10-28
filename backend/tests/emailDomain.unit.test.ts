/** The existing ALLOWED_EMAIL_DOMAINS setting is enforced for host-created participants when it is configured. */
import { describe, expect, it } from 'vitest';

// Load this file's (isolated) config with the restriction on, then restore the environment so no other test file sees it.
process.env.ALLOWED_EMAIL_DOMAINS = 'vit.edu, Students.VIT.edu';
const { getEnv } = await import('../src/config/environment.js');
getEnv();
delete process.env.ALLOWED_EMAIL_DOMAINS;
const { assertAllowedEmailDomain } = await import('../src/services/participantAccountService.js');

describe('college email domain restriction', () => {
  it('accepts configured domains, case-insensitively', () => {
    expect(() => assertAllowedEmailDomain('riya.mehta@vit.edu')).not.toThrow();
    expect(() => assertAllowedEmailDomain(' Riya@STUDENTS.vit.edu ')).not.toThrow();
  });

  it('rejects other domains with a message on the email field', () => {
    try {
      assertAllowedEmailDomain('riya.mehta03@gmail.com');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ status: 400, details: [{ field: 'email', message: 'Use an email address from @vit.edu or @students.vit.edu.' }] });
    }
    expect(() => assertAllowedEmailDomain('someone@evil-vit.edu')).toThrow();
  });
});
