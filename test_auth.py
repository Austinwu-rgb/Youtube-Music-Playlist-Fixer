# test_auth.py
from youtube_fix.auth import get_service
svc = get_service()
print("Authenticated OK; service object:", type(svc))
