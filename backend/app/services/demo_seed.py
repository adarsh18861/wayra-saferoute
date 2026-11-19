"""Demo account seed (`npm run seed:demo`): creates or resets demo@wayra.app with two trusted contacts.

Safe to run repeatedly. A rerun resets the password and name, ends any active trip, clears the
demo user's alerts/SOS log and incident reports (so the watch feed and routes start clean), and
keeps the two contacts' watch tokens, so watch links opened earlier keep working. Other contacts of
the demo user are removed. Run it while the backend is stopped (live trip state is held in memory).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.safety import Alert, Contact, Delivery, IncidentReport, Trip
from app.models.user import User

DEMO_EMAIL = "demo@wayra.app"
DEMO_PASSWORD = "Wayra@123"
DEMO_NAME = "Asha Rao"
DEMO_CONTACTS = (
    {"name": "Mom", "relation": "Mother", "phone": "+1 312 555 0100", "email": None},
    {"name": "Priya – friend", "relation": "Friend", "phone": "+1 312 555 0142", "email": None},
)


@dataclass
class SeedResult:
    user: User
    contacts: list[Contact]
    created: bool


def seed_demo(db: Session) -> SeedResult:
    now = datetime.now(UTC)
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    created = user is None
    if user is None:
        user = User(email=DEMO_EMAIL, name=DEMO_NAME, hashed_password=hash_password(DEMO_PASSWORD))
        db.add(user)
        db.flush()
    else:
        user.name = DEMO_NAME
        user.hashed_password = hash_password(DEMO_PASSWORD)

    # End active trips and wipe history so the demo starts from a clean feed.
    for trip in db.scalars(select(Trip).where(Trip.user_id == user.id, Trip.status == "active")):
        trip.status = "ended"
        trip.ended_at = now
    alert_ids = select(Alert.id).where(Alert.user_id == user.id)
    db.execute(delete(Delivery).where(Delivery.alert_id.in_(alert_ids)))
    db.execute(delete(Alert).where(Alert.user_id == user.id))
    db.execute(delete(IncidentReport).where(IncidentReport.user_id == user.id))

    existing = {c.name: c for c in db.scalars(select(Contact).where(Contact.user_id == user.id))}
    wanted = {c["name"] for c in DEMO_CONTACTS}
    for name, c in existing.items():
        if name not in wanted:
            db.execute(delete(Delivery).where(Delivery.contact_id == c.id))
            db.delete(c)
    contacts: list[Contact] = []
    for spec in DEMO_CONTACTS:
        c = existing.get(spec["name"])
        if c is None:
            c = Contact(user_id=user.id, **spec)
            db.add(c)
        else:
            c.relation, c.phone, c.email = spec["relation"], spec["phone"], spec["email"]
        contacts.append(c)
    db.commit()
    for c in contacts:
        db.refresh(c)
    return SeedResult(user, contacts, created)
