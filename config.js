// Deployment configuration. Safe to commit: an OAuth *client ID* is public.
//
// To enable "Sync with Google" for everyone using your deployment:
//  1. https://console.cloud.google.com → APIs & Services → enable "Google Drive API".
//  2. Credentials → Create OAuth client ID → "Web application".
//     Authorized JavaScript origins: your site origin, e.g. https://<user>.github.io
//  3. OAuth consent screen → add scope .../auth/drive.appdata
//  4. Paste the client ID below (or each user can paste their own in Settings → Sync).
export const CONFIG = {
  googleClientId: '',
};
