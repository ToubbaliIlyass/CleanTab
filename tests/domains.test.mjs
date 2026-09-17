import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("domains + trust");
  const { run } = createEnv();

  // ── normalizeDomain ────────────────────────────────────────────────────────
  t("strips a leading www.", () => eq(run(`normalizeDomain("www.example.com")`), "example.com"));
  t("lowercases", () => eq(run(`normalizeDomain("WWW.EXAMPLE.COM")`), "example.com"));
  t("keeps other subdomains", () => eq(run(`normalizeDomain("old.reddit.com")`), "old.reddit.com"));

  // The old implementation used .replace("www.", "") — unanchored, first match anywhere.
  t("does not strip an inner www.", () => eq(run(`normalizeDomain("mywww.example.com")`), "mywww.example.com"));
  t("does not mangle wwwx hosts", () => eq(run(`normalizeDomain("wwwx.site.com")`), "wwwx.site.com"));
  t("only strips ONE leading www.", () => eq(run(`normalizeDomain("www.www.example.com")`), "www.example.com"));

  t("empty string", () => eq(run(`normalizeDomain("")`), ""));
  t("null", () => eq(run(`normalizeDomain(null)`), ""));
  t("undefined", () => eq(run(`normalizeDomain(undefined)`), ""));

  // ── domainFromUrl ──────────────────────────────────────────────────────────
  t("from a full URL", () => eq(run(`domainFromUrl("https://www.reddit.com/r/x/")`), "reddit.com"));
  t("drops the port", () => eq(run(`domainFromUrl("http://localhost:8080/x")`), "localhost"));
  t("handles an IP host", () => eq(run(`domainFromUrl("http://192.168.1.1/x")`), "192.168.1.1"));
  t("garbage in, empty out", () => eq(run(`domainFromUrl("not a url")`), ""));
  t("null URL", () => eq(run(`domainFromUrl(null)`), ""));
  t("chrome:// URL", () => eq(run(`domainFromUrl("chrome://extensions")`), "extensions"));

  // ── isTrusted ──────────────────────────────────────────────────────────────
  // This is the exact round trip that silently failed before: the appeal stored a
  // stripped domain, the content script compared a raw location.hostname, and the
  // approval looked successful while doing nothing.
  t("www host matches an entry stored bare", () =>
    ok(run(`isTrusted([makeTrustEntry("example.com","appeal")], "www.example.com")`)));
  t("bare host matches an entry stored with www", () =>
    ok(run(`isTrusted([makeTrustEntry("www.example.com","appeal")], "example.com")`)));

  t("legacy bare-string entries still match", () =>
    ok(run(`isTrusted(["example.com"], "www.example.com")`)));

  t("a different domain does not match", () =>
    notOk(run(`isTrusted([makeTrustEntry("example.com","manual")], "evil.com")`)));

  // Documented behaviour, not an accident: trust is per exact host after www-stripping.
  // Trusting example.com does NOT silently trust every subdomain of it.
  t("subdomains are NOT covered by a parent entry", () =>
    notOk(run(`isTrusted([makeTrustEntry("example.com","manual")], "images.example.com")`)));

  t("expired entry does not match", () =>
    notOk(run(`isTrusted([{domain:"a.com", expiresAt: 1}], "a.com")`)));
  t("future expiry does match", () =>
    ok(run(`isTrusted([{domain:"a.com", expiresAt: Date.now() + 60000}], "a.com")`)));
  t("null expiry means permanent", () =>
    ok(run(`isTrusted([{domain:"a.com", expiresAt: null}], "a.com")`)));

  t("empty trust list", () => notOk(run(`isTrusted([], "a.com")`)));
  t("undefined trust list", () => notOk(run(`isTrusted(undefined, "a.com")`)));
  t("empty hostname never matches", () => notOk(run(`isTrusted([makeTrustEntry("a.com","manual")], "")`)));

  return t;
}
