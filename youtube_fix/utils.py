from __future__ import annotations
import time, functools

def rate_limit(min_interval_sec: float):
    def deco(fn):
        last=[0.0]
        @functools.wraps(fn)
        def wrap(*a, **kw):
            delta = time.time()-last[0]
            if delta < min_interval_sec: time.sleep(min_interval_sec-delta)
            r = fn(*a, **kw)
            last[0]=time.time()
            return r
        return wrap
    return deco
