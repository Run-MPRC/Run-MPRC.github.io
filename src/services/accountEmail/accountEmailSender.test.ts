/* eslint-env jest */
import {
  getAccountEmailSenderLabel,
  getSpamGuidance,
} from './accountEmailSender';

const ENV_KEY = 'REACT_APP_ACCOUNT_EMAIL_SENDER';
const GENERIC_LABEL = "the club's account email";

function setSender(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
}

describe('account-email sender configuration (AUTH-MAIL-002 C6)', () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    setSender(original);
  });

  test('falls back to a generic sender when none is configured', () => {
    setSender(undefined);
    expect(getAccountEmailSenderLabel()).toBe(GENERIC_LABEL);
  });

  test('treats a blank or whitespace-only configuration as unset', () => {
    setSender('');
    expect(getAccountEmailSenderLabel()).toBe(GENERIC_LABEL);
    setSender('   ');
    expect(getAccountEmailSenderLabel()).toBe(GENERIC_LABEL);
  });

  test('names the configured sender and can change without a code fork', () => {
    setSender('Synthetic Club Sender');
    expect(getAccountEmailSenderLabel()).toBe('Synthetic Club Sender');
    // A later AUTH-MAIL-001 (#119) update is a configuration edit, not a code edit.
    setSender('Synthetic Club Sender (updated)');
    expect(getAccountEmailSenderLabel()).toBe('Synthetic Club Sender (updated)');
  });

  test('trims incidental whitespace around a configured sender', () => {
    setSender('  Synthetic Club Sender  ');
    expect(getAccountEmailSenderLabel()).toBe('Synthetic Club Sender');
  });

  test('spam guidance names the sender, offers one action, and refuses to over-promise', () => {
    setSender('Synthetic Club Sender');
    const guidance = getSpamGuidance();
    expect(guidance).toContain('Synthetic Club Sender');
    expect(guidance).toContain('Not spam');
    expect(guidance).toContain('does not fix delivery for everyone');
    expect(guidance).not.toMatch(/\bsent\b|\bdelivered\b|\baccepted\b/i);
  });

  test('generic guidance invents no address and never claims delivery', () => {
    setSender(undefined);
    const guidance = getSpamGuidance();
    expect(guidance).toContain(GENERIC_LABEL);
    expect(guidance).not.toContain('@');
    expect(guidance).not.toMatch(/\bsent\b|\bdelivered\b/i);
  });

  test('resolving the sender never writes to the console', () => {
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    setSender('Synthetic Club Sender');
    getAccountEmailSenderLabel();
    getSpamGuidance();
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    spies.forEach((spy) => spy.mockRestore());
  });
});
