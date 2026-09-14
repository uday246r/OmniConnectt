import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MarketplaceApp } from "./federation/MarketplaceApp";
import { StandaloneShell } from "./layouts/StandaloneShell";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/product-marketplace/dashboard" replace />} />
        <Route
          path="/product-marketplace/*"
          element={
            <StandaloneShell>
              <MarketplaceApp />
            </StandaloneShell>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
