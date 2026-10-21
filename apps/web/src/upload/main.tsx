// Client upload page entry (apps/web/upload.html). Imports nothing from the
// dashboard: no MSAL, no staff API client — clients download only this.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./upload.css";
import { UploadPage } from "./UploadPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UploadPage />
  </StrictMode>,
);
