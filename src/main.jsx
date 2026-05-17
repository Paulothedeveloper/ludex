import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// v0.7.5: marca html[data-android] pro CSS poder ter regras Android-only
// alem de @media queries (que pegam tela estreita desktop tambem)
if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "")) {
  document.documentElement.setAttribute("data-android", "true");
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
