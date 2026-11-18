const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return "Email is required";
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address";
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (!password) return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (new TextEncoder().encode(password).length > 72) return "Password must be at most 72 characters";
  return undefined;
}

export function validateName(name: string): string | undefined {
  if (!name.trim()) return "Name is required";
  if (name.trim().length > 100) return "Name must be at most 100 characters";
  return undefined;
}
