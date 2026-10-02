/*
 * Per-user Gemini key linking page for the Alexa skill (account linking, implicit grant).
 *
 * Alexa opens this page with ?state=&client_id=&response_type=token&redirect_uri=&scope=.
 * The user pastes THEIR OWN Gemini API key. The page then redirects to Amazon's redirect_uri with
 *   #state=<state>&access_token=<key>&token_type=Bearer
 * Alexa stores that token for this user and this skill only, and sends it with that user's requests.
 *
 * The key never goes to the server hosting this page: there is no form submission, no fetch/XHR
 * (blocked by the CSP too), and it travels only in the URL fragment of Amazon's redirect URL.
 * The redirect target is strictly validated so a crafted link cannot send a key anywhere else.
 */
(function (root) {
  "use strict";

  var ALEXA_REDIRECT_HOSTS = ["pitangui.amazon.com", "layla.amazon.com", "alexa.amazon.co.jp"];
  var REDIRECT_PATH = "/spa/skill/account-linking-status.html";
  var KEY_RE = /^[A-Za-z0-9._\-]{20,200}$/;
  var VENDOR_RE = /^[A-Z0-9]{6,40}$/;
  var PLACEHOLDER = "REPLACE_ME";

  function configProblem(config) {
    if (!config || typeof config !== "object") return "config_missing";
    if (typeof config.clientId !== "string" || !config.clientId || config.clientId === PLACEHOLDER ||
        config.clientId.length > 256) return "client_id_not_configured";
    if (typeof config.vendorId !== "string" || !VENDOR_RE.test(config.vendorId)) return "vendor_id_not_configured";
    return null;
  }

  // Returns {ok:true, redirectUri, state} or {ok:false, error}.
  function validateRequest(params, config) {
    var problem = configProblem(config);
    if (problem) return { ok: false, error: problem };
    var get = function (k) { var v = params.get(k); return v === null ? "" : v; };
    if (get("response_type") !== "token") return { ok: false, error: "bad_response_type" };
    if (get("client_id") !== config.clientId) return { ok: false, error: "bad_client_id" };
    var state = get("state");
    if (!state || state.length > 4096) return { ok: false, error: "bad_state" };
    var raw = get("redirect_uri");
    var u;
    try { u = new URL(raw); } catch (e) { return { ok: false, error: "bad_redirect_uri" }; }
    // Amazon's implicit-grant redirect format (Account Linking Schema):
    //   {baseURL}/spa/skill/account-linking-status.html?vendorId={vendorId}
    // Accept exactly that: one of Amazon's three hosts, that path, and a single vendorId equal to ours.
    var q = u.searchParams;
    var onlyVendor = q.getAll("vendorId").length === 1 && Array.from(q.keys()).length === 1;
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash ||
        ALEXA_REDIRECT_HOSTS.indexOf(u.hostname) === -1 ||
        u.pathname !== REDIRECT_PATH || !onlyVendor || q.get("vendorId") !== config.vendorId) {
      return { ok: false, error: "bad_redirect_uri" };
    }
    return { ok: true, redirectUri: u.origin + REDIRECT_PATH + "?vendorId=" + encodeURIComponent(config.vendorId),
             state: state };
  }

  function normalizeKey(input) {
    var key = (typeof input === "string" ? input : "").trim();
    return KEY_RE.test(key) ? key : null;
  }

  function buildRedirect(redirectUri, state, key) {
    var frag = "state=" + encodeURIComponent(state) +
               "&access_token=" + encodeURIComponent(key) +
               "&token_type=Bearer";
    return redirectUri + "#" + frag;
  }

  var api = { validateRequest: validateRequest, normalizeKey: normalizeKey, buildRedirect: buildRedirect,
              configProblem: configProblem, ALEXA_REDIRECT_HOSTS: ALEXA_REDIRECT_HOSTS };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;  // unit tests (node)
    return;
  }

  // ---- browser ----
  function show(id) {
    var ids = ["form-section", "error-section"];
    for (var i = 0; i < ids.length; i++) document.getElementById(ids[i]).hidden = ids[i] !== id;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var check = validateRequest(new URLSearchParams(root.location.search), root.LINK_CONFIG);
    if (!check.ok) {
      document.getElementById("error-code").textContent = check.error;
      show("error-section");
      return;
    }
    show("form-section");
    var form = document.getElementById("key-form");
    var input = document.getElementById("api-key");
    var msg = document.getElementById("key-error");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var key = normalizeKey(input.value);
      if (!key) { msg.hidden = false; input.focus(); return; }
      input.value = "";
      root.location.replace(buildRedirect(check.redirectUri, check.state, key));
    });
  });
})(typeof window !== "undefined" ? window : this);
