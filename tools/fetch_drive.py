#!/usr/bin/env python3
"""Download the Health Connect export from Google Drive (used by the nightly workflow).

Usage:
    python3 tools/fetch_drive.py <output.zip>

Environment:
    GDRIVE_SA_KEY   the service account's JSON key (the whole file's text)
    GDRIVE_FILE_ID  the export file, or a folder holding it (then the newest .zip wins)

The service account only sees what Randy shared with it (read-only). Needs
`pip install google-auth requests`; the rest of tools/ stays standard-library only.
"""
from __future__ import annotations

import json
import os
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

API = "https://www.googleapis.com/drive/v3/files"
FOLDER = "application/vnd.google-apps.folder"


def get(session: AuthorizedSession, url: str, who: str, **params) -> dict:
    r = session.get(url, params={"supportsAllDrives": "true", **params}, timeout=60)
    if r.status_code == 404:
        sys.exit(f"Not found on Drive. Is it shared with {who}? Check GDRIVE_FILE_ID too.")
    r.raise_for_status()
    return r.json()


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GDRIVE_SA_KEY"]), scopes=["https://www.googleapis.com/auth/drive.readonly"])
    session = AuthorizedSession(creds)
    who = creds.service_account_email
    file_id = os.environ["GDRIVE_FILE_ID"].strip()

    meta = get(session, f"{API}/{file_id}", who, fields="id,name,mimeType,modifiedTime")
    if meta["mimeType"] == FOLDER:
        found = get(session, API, who, q=f"'{file_id}' in parents and trashed = false and name contains '.zip'",
                    orderBy="modifiedTime desc", pageSize=1, fields="files(id,name,mimeType,modifiedTime)")["files"]
        if not found:
            sys.exit(f"No .zip in the Drive folder {meta['name']!r}.")
        meta = found[0]

    with session.get(f"{API}/{meta['id']}", params={"alt": "media", "supportsAllDrives": "true"},
                     stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(sys.argv[1], "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    print(f"Downloaded {meta['name']} (last changed on Drive {meta['modifiedTime']})")


if __name__ == "__main__":
    main()
