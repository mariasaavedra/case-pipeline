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
