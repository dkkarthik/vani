# Visible focus saving

The focus editor currently places its only save control after all advanced fields.
A user reports no visible save button. This change does not assume why their
installed view differs: add a primary Save focus changes control at the beginning
of the editor and directly below Public search queries, retaining one at the end.
All controls save the same complete draft with its existing version guard. Explain
that edits are not autosaved, show confirmation on success, retain edits on failure,
and show save errors near the query controls. Do not silently save or launch a run.
Verify editing queries submits the draft and displays successful persistence.
