import type { Configuration } from "@azure/msal-browser";

const TENANT_ID = "9fde682a-6a44-4a86-a796-519ca573b1f5";
const CLIENT_ID = "2b0a7d88-6a8b-4913-90a7-9926fd8f6335";

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: `${window.location.origin}/login`,
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

export const loginRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
};

/**
 * Microsoft Graph scopes for the SharePoint file browser — deliberately NOT part
 * of loginRequest, so signing in doesn't prompt everyone for file access. It's
 * requested the first time someone opens a client's Documents tab.
 *
 * ReadWrite (not Read) because the tab supports uploading into client folders.
 * Delegated: each user only ever sees/writes what SharePoint already allows them.
 * Requires tenant admin consent on the app registration.
 */
export const graphRequest = {
  scopes: ["Files.ReadWrite.All"],
};
