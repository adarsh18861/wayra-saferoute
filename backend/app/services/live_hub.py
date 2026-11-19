"""In-memory pub/sub for WebSocket clients (one process; swap for Redis to scale out).

Channels:
  user:{id}     location + trip updates of a user (contacts' watch pages subscribe)
  contact:{id}  alerts delivered to one trusted contact by the InAppNotifier
  trip:{token}  everything about one trip (one-off /track/:token viewers)
  self:{id}     messages for the user's own app (check-in prompts, "contacts alerted")

publish() is safe from sync endpoints (worker threads) and from async code: each subscriber
remembers its event loop and messages are handed over with call_soon_threadsafe.
"""
from __future__ import annotations

import asyncio
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass(eq=False)
class Subscription:
    channels: tuple[str, ...]
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(maxsize=500))

    def _put(self, msg: dict[str, Any]) -> None:
        if self.queue.full():  # a stuck client drops its oldest message instead of growing forever
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        self.queue.put_nowait(msg)


class LiveHub:
    def __init__(self) -> None:
        self._subs: dict[str, set[Subscription]] = defaultdict(set)
        self._lock = threading.Lock()

    def subscribe(self, *channels: str) -> Subscription:
        sub = Subscription(tuple(channels), asyncio.get_running_loop())
        with self._lock:
            for ch in channels:
                self._subs[ch].add(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        with self._lock:
            for ch in sub.channels:
                self._subs[ch].discard(sub)
                if not self._subs[ch]:
                    del self._subs[ch]

    def count(self, channel: str) -> int:
        with self._lock:
            return len(self._subs.get(channel, ()))

    def publish(self, channel: str, msg: dict[str, Any]) -> int:
        """Send msg to every subscriber of channel; returns how many were listening."""
        with self._lock:
            subs = list(self._subs.get(channel, ()))
        sent: set[int] = set()
        for s in subs:
            if id(s) in sent:
                continue
            sent.add(id(s))
            try:
                s.loop.call_soon_threadsafe(s._put, msg)
            except RuntimeError:  # loop closed (client gone)
                self.unsubscribe(s)
        return len(sent)

    def clear(self) -> None:
        with self._lock:
            self._subs.clear()
