import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { AuthProvider } from "./lib/auth/AuthProvider";
import { BooksApiProvider } from "./lib/api/BooksApiContext";
import { router } from "./router";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemento #root non trovato in index.html");

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <BooksApiProvider>
        <RouterProvider router={router} />
      </BooksApiProvider>
    </AuthProvider>
  </StrictMode>,
);
