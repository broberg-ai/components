// The real popup, as it runs inside the extension. Login is the real BID flow;
// the client id is the example's own, which BID does not know — so the login
// window answers with BID's own refusal. Trail's and Jam's builds pass their
// registered clients (trail-clipper, jam-clipper).
import "@broberg/theme/css/palettes.css";
import "@broberg/web-clipper/css/clipper.css";
import { render } from "preact";
import { initPalette, initTheme } from "@broberg/theme";
import { createBidAuth, extensionStorage } from "@broberg/web-clipper/auth";
import { clipActiveTab, CONTENT_SCRIPT_PATH } from "@broberg/web-clipper/extension";
import { ClipperPopup } from "@broberg/web-clipper/ui";
import { demoDestination } from "./demo";

initTheme();
initPalette();

const storage = extensionStorage();

render(
  <ClipperPopup
    title="Web Clipper Example"
    auth={createBidAuth({ issuer: "https://id.broberg.ai", clientId: "web-clipper-example" })}
    destination={demoDestination(storage)}
    getClip={() => clipActiveTab(CONTENT_SCRIPT_PATH)}
    storage={storage}
  />,
  document.getElementById("app")!,
);
