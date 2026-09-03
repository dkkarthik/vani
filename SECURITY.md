# Security

VANI is local-first and binds its API and web services to loopback by default. Do not expose the development server directly to a network.

Report a security or privacy issue privately through the repository owner. Do not open a public issue containing credentials, unpublished research, private notes, or document content.

Secrets belong in `.env` or the deployment secret store. They must never be committed, logged, exported, or returned through the API. User-uploaded documents and notes may be sent to a remote model only after an explicit applicable privacy setting is implemented and enabled.
