import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import AuthLayout, { Field, FormError, SubmitButton } from "../components/AuthLayout";
import { useAuth } from "../lib/auth";
import { validateEmail, validateName, validatePassword } from "../lib/validation";

type Errors = { name?: string; email?: string; password?: string; confirm?: string };

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {
      name: validateName(name),
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: confirm === password ? undefined : "Passwords don't match",
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;

    setBusy(true);
    try {
      await register(name.trim(), email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your account">
      <form onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        <Field
          id="name"
          label="Name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
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
          label="Password (at least 8 characters)"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Field
          id="confirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <SubmitButton busy={busy}>Create account</SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-brand-teal-dark hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
