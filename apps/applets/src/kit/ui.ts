// studio://kit/ui.js — what applets import to build BB-looking UI without a
// build step: React, `html` (JSX-like tagged templates via htm), and the
// Studio kit's components, styled by BB's own stylesheet (see boot.ts).
//
//   import { html, render, Button, useState } from "studio://kit/ui.js";
//   render(html`<${Button} onClick=${() => {}}>Hi<//>`);
import htm from "htm";
import * as React from "react";
import { createRoot } from "react-dom/client";

export const { useState, useEffect, useMemo, useCallback, useRef, useReducer, useContext, createContext, Fragment, memo } = React;
export { React, createRoot };
export const html = htm.bind(React.createElement);

/** Render into #root (created if missing). */
export function render(node: React.ReactNode, container?: Element | null): void {
  let target = container ?? document.getElementById("root");
  if (!target) {
    target = document.createElement("div");
    target.id = "root";
    document.body.append(target);
  }
  createRoot(target).render(node);
}

export * from "../../../../packages/bb-studio-kit/src/ui/index";
