import { useState } from "react";
import { Puzzle } from "lucide-react";

export function CaptureSettings() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function update(revoke = false) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/capture-key", {
        method: revoke ? "DELETE" : "POST",
        headers: { "X-Vani-Client": "web" },
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error?.message ||
            "Could not update the capture key.",
        );
      setToken(revoke ? "" : (await response.json()).token);
      if (revoke)
        setMessage(
          "Capture key revoked. Get a new key to reconnect your extension.",
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="settings-card capture-settings">
      <header>
        <div className="setting-icon green">
          <Puzzle />
        </div>
        <div>
          <h2>Chrome extension</h2>
          <p>Save papers from the page you are reading</p>
        </div>
      </header>
      <p>
        Install the VANI extension, open its Settings, and paste a capture key
        to connect this workspace. The key allows reading and creating
        collections, saving papers, and attaching PDFs.
      </p>
      <div className="capture-actions">
        <button
          className="button primary"
          disabled={pending}
          onClick={() => update()}
        >
          Get capture key
        </button>
        <button
          className="button secondary"
          disabled={pending}
          onClick={() => update(true)}
        >
          Revoke key
        </button>
      </div>
      {token && (
        <label className="capture-key">
          Capture key
          <input
            type="password"
            readOnly
            value={token}
            aria-label="Capture key"
          />
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token);
                setMessage("Copied. Paste this key in the extension Settings.");
              } catch {
                setMessage(
                  "Clipboard unavailable. Select the key field and copy it manually.",
                );
              }
            }}
          >
            Copy key
          </button>
        </label>
      )}
      <p className="capture-feedback" role="status">
        {message}
      </p>
      <small>
        Keep this key private. Revoking it disconnects every extension using it.
      </small>
    </section>
  );
}
