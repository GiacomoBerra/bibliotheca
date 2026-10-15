import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { AuthProvider } from "./lib/auth/AuthProvider";
import { router } from "./router";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemento #root non trovato in index.html");

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
