// Sign-up and log-in checks, run on submit. Messages say what to do.
export const MIN_PASSWORD = 8;

export function emailError(email: string): string | null {
  if (!email.trim()) return 'Enter your email.';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? null : 'Enter an email like name@example.com.';
}

export function passwordError(password: string): string | null {
  if (!password) return 'Enter a password.';
  return password.length >= MIN_PASSWORD ? null : `Use at least ${MIN_PASSWORD} characters.`;
}

export function nameError(name: string, which: 'first' | 'last'): string | null {
  return name.trim() ? null : `Enter your ${which} name.`;
}
