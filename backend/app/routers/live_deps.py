from typing import Annotated

from fastapi import Depends, Request

from app.services.live_service import LiveService


def get_live(request: Request) -> LiveService:
    return request.app.state.live


Live = Annotated[LiveService, Depends(get_live)]
