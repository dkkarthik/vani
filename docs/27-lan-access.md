# Open VANI from another computer

The production web server now listens on **0.0.0.0:3000** (all IPv4 interfaces).
Upgrade and restart the existing managed installation, then open
`http://<desktop-IP>:3000` from another computer on the same network.
Find the Ubuntu desktop's addresses with:

```bash
hostname -I
```

Choose its LAN address, for example `http://192.168.1.50:3000`. Existing
installations inherit LAN access unless VANI_WEB_HOST is explicitly set.
The web server proxies API traffic, so only port 3000 needs to be reachable.
The API (8080), PostgreSQL (55432), and Ollama (11435) remain on loopback.
Settings → VANI updates also works from the LAN in a managed installation.

This version has no network login: anyone who can reach port 3000 can access and
change the workspace, including initiating updates. Use a trusted LAN; do not
forward this port to the public internet. School firewall/network rules may need
to permit access; the installer does not change them or require sudo.

To restore local-only access, add this to your installation's `config/vani.env`:

```dotenv
VANI_WEB_HOST=127.0.0.1
```

Then run the installation's `bin/vani stop` and `bin/vani start`. Set it to
`0.0.0.0` for LAN access again. The managed web port remains 3000. The development Vite server and evaluation lab
retain their existing bind configuration.
