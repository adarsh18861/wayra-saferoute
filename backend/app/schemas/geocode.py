from pydantic import BaseModel


class Place(BaseModel):
    name: str
    lat: float
    lon: float
