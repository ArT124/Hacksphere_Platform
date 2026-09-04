---
name: JWT client sessions
description: The browser-side contract required for HackSphere's generated API client and protected routes.
---

Protected HackSphere API calls use bearer JWTs rather than cookies. The browser client must read the current token from local storage through the generated client's auth-token hook, and login/register must persist the returned token before navigating to protected pages. Logout should remove the token and clear cached protected data.

**Why:** Generated React Query hooks do not automatically attach a JWT, so a polished UI can appear to work while every dashboard request is unauthorized after a fresh load.

**How to apply:** Preserve the token getter and auth mutation persistence whenever the generated API client, auth screens, or protected route shell changes.