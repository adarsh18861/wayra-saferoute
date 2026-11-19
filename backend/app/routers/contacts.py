from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select

from app.models import Contact
from app.models.safety import new_token
from app.routers.deps import CurrentUser, DbSession
from app.schemas.safety import MAX_CONTACTS, ContactIn, ContactOut

router = APIRouter(prefix="/contacts", tags=["contacts"])


def _own(db: DbSession, user_id: int, contact_id: int) -> Contact:
    c = db.get(Contact, contact_id)
    if c is None or c.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return c


@router.get("", response_model=list[ContactOut])
def list_contacts(user: CurrentUser, db: DbSession) -> list[Contact]:
    return list(db.scalars(select(Contact).where(Contact.user_id == user.id).order_by(Contact.id)))


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def add_contact(body: ContactIn, user: CurrentUser, db: DbSession) -> Contact:
    n = db.scalar(select(func.count()).select_from(Contact).where(Contact.user_id == user.id)) or 0
    if n >= MAX_CONTACTS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You can save up to {MAX_CONTACTS} trusted contacts")
    c = Contact(user_id=user.id, **body.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.put("/{contact_id}", response_model=ContactOut)
def edit_contact(contact_id: int, body: ContactIn, user: CurrentUser, db: DbSession) -> Contact:
    c = _own(db, user.id, contact_id)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c


@router.post("/{contact_id}/reset-link", response_model=ContactOut)
def reset_link(contact_id: int, user: CurrentUser, db: DbSession) -> Contact:
    """New watch token: the old link stops working (e.g. it was shared by mistake)."""
    c = _own(db, user.id, contact_id)
    c.watch_token = new_token()
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(contact_id: int, user: CurrentUser, db: DbSession) -> Response:
    c = _own(db, user.id, contact_id)
    db.delete(c)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
