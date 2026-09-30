import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Generic, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    """A small in-memory cache with expiry. Oldest entries are evicted first."""

    def __init__(
        self, ttl_s: float, max_items: int = 256, now: Callable[[], float] = time.monotonic
    ) -> None:
        self._ttl = ttl_s
        self._max = max_items
        self._now = now
        self._items: OrderedDict[K, tuple[float, V]] = OrderedDict()

    def get(self, key: K) -> V | None:
        item = self._items.get(key)
        if item is None:
            return None
        expires, value = item
        if expires <= self._now():
            del self._items[key]
            return None
        return value

    def set(self, key: K, value: V) -> None:
        self._items.pop(key, None)
        self._items[key] = (self._now() + self._ttl, value)
        while len(self._items) > self._max:
            self._items.popitem(last=False)
