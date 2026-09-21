# LAN access

Bind the production web server on 0.0.0.0:3000 by default; VANI_WEB_HOST=127.0.0.1
opts back into local-only access. The web server proxies /api to the loopback API.
PostgreSQL, Ollama and the API retain their loopback bindings. Existing managed
installations inherit the new web default after upgrade and restart.

Reject cross-origin browser mutations at the web proxy. The managed launcher
creates a private, per-launch proxy token shared only by its web/API children.
The web proxy overwrites incoming proxy-token headers; update endpoints accept
verified proxied requests as well as their existing local path. Never trust a
browser-supplied forwarded host or IP to authorize an update.

This remains a single-user application without network login: anyone able to reach
port 3000 can use the workspace, including updates. Intended for a trusted LAN;
no router forwarding, firewall edits, or public deployment is performed. Document
IP discovery and local-only opt-out. Check network binding, same-origin proxy
mutations, remote update authorization and spoofed header rejection.
