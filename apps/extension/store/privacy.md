# VANI browser capture — privacy policy

Effective September 7, 2026. Applies to extension version 0.1.0.

VANI browser capture saves academic papers into a VANI service running on your own computer. The extension does not operate a hosted account, analytics service, advertising service, or data marketplace.

## Information handled

When you open the extension on a page, it reads that page's URL, title, scholarly metadata, structured metadata, and potential PDF links. It uses those details to fill a review form. It does not continuously monitor your browsing history or read other tabs in the background.

When you save, the extension sends the reviewed metadata, source and canonical URLs, chosen collection, capture identifier, and requested PDF location to your configured local VANI service. If you choose a PDF and grant the necessary website access, it requests that PDF from its host and sends the downloaded bytes to VANI. That request may include browser-managed cookies already applicable to the publisher; the extension does not read or export cookie values. Publisher access rules and browser cookie restrictions still apply.

If you explicitly look up a DOI, the local VANI service sends that identifier to Crossref to retrieve bibliographic metadata. The PDF host or Crossref may receive normal network information, such as your IP address, as part of those requests. Their own privacy practices apply to their services.

The extension stores its local service addresses, capture key, last selected collection, and most recent capture/status in this Chrome profile's local extension storage. A pending/retryable PDF download URL can contain a publisher's temporary download parameters. Common tracking and credential query parameters are removed from URLs saved as VANI source provenance; arbitrary publisher parameters cannot all be identified automatically.

## Use and sharing

Information is used to populate the capture form, save papers, attach PDFs, display import status, and retry an interrupted save. The extension has no analytics, advertising, sale of data, or remote model calls. Its capture key is sent only to the local VANI API.

VANI's separate local application may perform discovery or use a configured local/remote model according to its own settings and workflows after a paper is saved. This extension policy does not imply that every separately enabled VANI feature operates offline.

## Retention and control

The latest capture is replaced when you start another capture. **Disconnect extension** removes its stored key and latest capture; uninstalling removes its extension-local storage. **Forget PDF site access** removes previously granted optional HTTPS host permissions. Chrome also provides controls for disabling or uninstalling the extension.

**Revoke key** in VANI Settings invalidates the capture key. Saved papers, source records, and PDFs are retained in your local VANI database/object store until you remove them through your local data-management workflow. Disconnecting or uninstalling the extension does not delete those records or your backups.

## Contact and changes

For questions or deletion guidance, use the [VANI issue tracker](https://github.com/dkkarthik/vani/issues). Do not post capture keys, private papers, or private URLs in a public issue. Policy changes will be recorded in this repository with an updated effective date.
