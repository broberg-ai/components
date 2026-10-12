// The service worker runs the BrobergID login: Chrome closes the popup when the
// login window takes focus, so a login started there would die before it is stored.
import { createBidAuth, serveLogin } from "@broberg/web-clipper/auth";
import { BID_OPTIONS } from "./bid";

serveLogin(createBidAuth(BID_OPTIONS));
