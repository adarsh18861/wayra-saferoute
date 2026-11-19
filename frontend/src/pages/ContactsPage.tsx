import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Mail,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Modal from "../components/ui/Modal";
import {
  addContact,
  deleteContact,
  editContact,
  MAX_CONTACTS,
  resetContactLink,
  watchLink,
  type Contact,
  type ContactInput,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSafety } from "../lib/safety";

const EMPTY: ContactInput = { name: "", relation: "", phone: "", email: "" };
const RELATIONS = ["Mother", "Father", "Sister", "Brother", "Partner", "Friend", "Roommate"];

function inviteText(contact: Contact, userName: string): string {
  return (
    `Hi ${contact.name}, I've added you as a trusted contact on WAYRA (safe-walk app). ` +
    `If I start a walk, go off route or send an SOS, you'll see it live here. No app or account needed, and please keep the link private: ${watchLink(contact.watch_token)}` +
    ` – ${userName.split(" ")[0]}`
  );
}

const digits = (phone: string) => phone.replace(/[^\d]/g, "");

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

function ContactForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial: ContactInput;
  onSubmit: (c: ContactInput) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ContactInput) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return setError("Add a name.");
    if (!v.phone.trim() && !v.email.trim()) return setError("Add a phone number or an email so they can get the watch link.");
    setSaving(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the contact.");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink placeholder:text-ink-soft/60 focus:border-brand-teal focus:outline-none focus:ring-4 focus:ring-brand-teal/15";
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <label className="block text-sm font-semibold text-ink">
        Name
        <input data-autofocus className={input} value={v.name} onChange={set("name")} maxLength={100} placeholder="e.g. Mom" autoComplete="off" />
      </label>
      <div>
        <label className="block text-sm font-semibold text-ink">
          Relation <span className="font-normal text-ink-soft">(optional)</span>
          <input className={input} value={v.relation} onChange={set("relation")} maxLength={50} list="relations" placeholder="e.g. Mother" />
        </label>
        <datalist id="relations">
          {RELATIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
      <label className="block text-sm font-semibold text-ink">
        Phone <span className="font-normal text-ink-soft">(with country code, for WhatsApp/SMS)</span>
        <input className={input} value={v.phone} onChange={set("phone")} inputMode="tel" maxLength={32} placeholder="+1 312 555 0100" autoComplete="off" />
      </label>
      <label className="block text-sm font-semibold text-ink">
        Email <span className="font-normal text-ink-soft">(optional)</span>
        <input className={input} value={v.email} onChange={set("email")} type="email" maxLength={255} placeholder="name@example.com" autoComplete="off" />
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-xl font-semibold text-brand-800 ring-1 ring-line transition hover:bg-brand-50">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="h-11 flex-1 rounded-xl bg-brand-800 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function ContactCard({
  c,
  onEdit,
  onDelete,
  onReset,
}: {
  c: Contact;
  onEdit: () => void;
  onDelete: () => void;
  onReset: () => void;
}) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const text = inviteText(c, user?.name ?? "");
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(watchLink(c.watch_token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the watch link", watchLink(c.watch_token));
    }
  }

  const chip =
    "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 transition focus-visible:outline-2 focus-visible:outline-brand-teal";
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-3xl bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 font-display text-base font-bold text-white">
          {initials(c.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold text-ink">{c.name}</p>
          <p className="truncate text-sm text-ink-soft">
            {[c.relation, c.phone, c.email].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={`More actions for ${c.name}`}
            className="rounded-full p-2 text-ink-soft transition hover:bg-brand-50 hover:text-ink"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-2xl bg-white p-1.5 shadow-[var(--shadow-lift)] ring-1 ring-line">
              {[
                { icon: Pencil, label: "Edit", run: onEdit },
                { icon: RefreshCw, label: "Reset watch link", run: onReset },
                { icon: Trash2, label: "Delete", run: onDelete, danger: true },
              ].map(({ icon: Icon, label, run, danger }) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    run();
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition hover:bg-brand-50 ${danger ? "text-red-700" : "text-ink"}`}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className={`${chip} bg-brand-800 text-white ring-brand-800 hover:bg-brand-700`}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy watch link"}
        </button>
        {c.phone && (
          <>
            <a
              href={`https://wa.me/${digits(c.phone)}?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
              className={`${chip} bg-white text-ink ring-line hover:ring-brand-300`}
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
            </a>
            <a href={`sms:${c.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(text)}`} className={`${chip} bg-white text-ink ring-line hover:ring-brand-300`}>
              <MessageSquareText className="h-4 w-4" aria-hidden /> SMS
            </a>
          </>
        )}
        {c.email && (
          <a
            href={`mailto:${c.email}?subject=${encodeURIComponent("My WAYRA watch link")}&body=${encodeURIComponent(text)}`}
            className={`${chip} bg-white text-ink ring-line hover:ring-brand-300`}
          >
            <Mail className="h-4 w-4" aria-hidden /> Email
          </a>
        )}
        <a href={`/watch/${c.watch_token}`} target="_blank" rel="noreferrer" className={`${chip} text-brand-teal-dark ring-transparent hover:bg-brand-teal/10`}>
          <ExternalLink className="h-4 w-4" aria-hidden /> Preview their page
        </a>
      </div>
    </motion.li>
  );
}

export default function ContactsPage() {
  const { contacts, setContacts, refreshContacts, notify } = useSafety();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(contacts === null);

  useEffect(() => {
    refreshContacts().finally(() => setLoading(false));
  }, [refreshContacts]);

  const list = contacts ?? [];
  const full = list.length >= MAX_CONTACTS;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-6 sm:px-6 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-teal-dark">Trusted contacts</p>
          <h1 className="mt-1 text-3xl font-bold text-ink sm:text-4xl">People who look out for you</h1>
          <p className="mt-2 max-w-xl text-ink-soft">
            Up to {MAX_CONTACTS} people. Each gets a private watch link: no app or account needed. When you start a trip, go off
            route, stop for too long or send an SOS, they see it there live.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={full}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-800 px-5 text-sm font-semibold text-white shadow-[var(--shadow-card)] transition hover:-translate-y-px hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add contact
        </button>
      </div>

      <p className="mt-5 text-sm font-medium text-ink-soft" aria-live="polite">
        {list.length} of {MAX_CONTACTS} contacts{full ? " · remove one to add another" : ""}
      </p>

      {loading && list.length === 0 ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading contacts">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-3xl bg-white/70 ring-1 ring-line" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="mt-4 rounded-3xl border-2 border-dashed border-brand-200 bg-white/60 p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Users className="h-7 w-7" aria-hidden />
          </span>
          <h2 className="mt-4 text-xl font-bold text-ink">No trusted contacts yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
            Add someone you trust. Then send them their watch link on WhatsApp or SMS so they're ready if you ever need them.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-brand-teal px-5 text-sm font-semibold text-brand-950 shadow-[var(--shadow-glow)] transition hover:bg-brand-teal-light"
          >
            <UserRound className="h-4 w-4" aria-hidden /> Add your first contact
          </button>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          <AnimatePresence initial={false}>
            {list.map((c) => (
              <ContactCard
                key={c.id}
                c={c}
                onEdit={() => setEditing(c)}
                onDelete={() => setDeleting(c)}
                onReset={async () => {
                  try {
                    const n = await resetContactLink(c.id);
                    setContacts(list.map((x) => (x.id === c.id ? n : x)));
                    notify({ tone: "success", title: "New watch link created", text: `${c.name}'s old link no longer works. Send them the new one.` });
                  } catch (e) {
                    notify({ tone: "warn", title: "Couldn't reset the link", text: e instanceof Error ? e.message : undefined });
                  }
                }}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      <section className="mt-10 grid gap-3 sm:grid-cols-3" aria-label="How alerts reach your contacts">
        {[
          { icon: Link2, title: "Private link", text: "Each contact's link is secret and personal. Reset it any time from the ⋯ menu." },
          { icon: ShieldCheck, title: "Shared only when needed", text: "Your location is visible only during a trip or an SOS, never in between." },
          { icon: Phone, title: "Simulated messaging", text: "Alerts show live on the watch page. SMS/email delivery switches on only when the server is configured for it." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl bg-white/70 p-4 ring-1 ring-line">
            <Icon className="h-5 w-5 text-brand-700" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-ink">{title}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{text}</p>
          </div>
        ))}
      </section>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add trusted contact" size="md" icon={<UserRound className="h-5 w-5" aria-hidden />}>
        <ContactForm
          initial={EMPTY}
          submitLabel="Add contact"
          onCancel={() => setAdding(false)}
          onSubmit={async (v) => {
            const c = await addContact(v);
            setContacts([...list, c]);
            setAdding(false);
            notify({ tone: "success", title: `${c.name} added`, text: "Send them their watch link so they're ready." });
          }}
        />
      </Modal>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit contact" size="md" icon={<Pencil className="h-5 w-5" aria-hidden />}>
        {editing && (
          <ContactForm
            initial={{ name: editing.name, relation: editing.relation ?? "", phone: editing.phone ?? "", email: editing.email ?? "" }}
            submitLabel="Save"
            onCancel={() => setEditing(null)}
            onSubmit={async (v) => {
              const c = await editContact(editing.id, v);
              setContacts(list.map((x) => (x.id === c.id ? c : x)));
              setEditing(null);
            }}
          />
        )}
      </Modal>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={`Remove ${deleting?.name ?? ""}?`} icon={<Trash2 className="h-5 w-5" aria-hidden />}>
        <p className="text-sm text-ink-soft">Their watch link stops working straight away. You can add them again later (with a new link).</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => setDeleting(null)} className="h-11 flex-1 rounded-xl font-semibold text-brand-800 ring-1 ring-line hover:bg-brand-50">
            Keep
          </button>
          <button
            type="button"
            onClick={async () => {
              const c = deleting;
              if (!c) return;
              try {
                await deleteContact(c.id);
                setContacts(list.filter((x) => x.id !== c.id));
              } catch (e) {
                notify({ tone: "warn", title: "Couldn't remove the contact", text: e instanceof Error ? e.message : undefined });
              }
              setDeleting(null);
            }}
            className="h-11 flex-1 rounded-xl bg-red-700 font-semibold text-white hover:bg-red-800"
          >
            Remove
          </button>
        </div>
      </Modal>
    </div>
  );
}
