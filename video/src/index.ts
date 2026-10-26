// Remotion bundle entry. The render worker bundles this file; the app Player imports components directly.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { registerRoot } from "remotion";
import { allowVideoCode } from "./code/runtime";
import { Root } from "./Root";

// The headless render page is a sandbox: "code" videos run their AI code here (locked by lockPage).
allowVideoCode();
registerRoot(Root);
