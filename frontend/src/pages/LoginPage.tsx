import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import AuthLayout, { Field, FormError, SubmitButton } from "../components/AuthLayout";
import { useAuth } from "../lib/auth";
import { validateEmail } from "../lib/validation";

type Errors = { email?: string; password?: string };

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {
      email: validateEmail(email),
      password: password ? undefined : "Password is required",
    };
    setErrors(next);
    setFormError(null);
    if (next.email || next.password) return;

    setBusy(true);
    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        New to WAYRA?{" "}
        <Link to="/register" className="font-semibold text-brand-teal-dark hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
