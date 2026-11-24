// Amazon Cognito sign-in for the SARI admin.
// Authorization Code Grant with PKCE (S256) against the hosted UI.
// Public SPA client: there is no client secret, and tokens never leave the browser.
// Passive on load: nothing happens until init(), signIn(), or signOut() is called.
window.SARI = window.SARI || {};

(function (SARI) {
  "use strict";

  var TOKENS_KEY = "sari.auth.tokens";
  var FLOW_KEY = "sari.auth.flow";
  var REFRESH_SKEW_MS = 60 * 1000;
  var TOKEN_TIMEOUT_MS = 15 * 1000;

  var initPromise = null;
  var refreshPromise = null;

  // --- Config and mode ---------------------------------------------------

  function authConfig() {
    return (window.SARI_CONFIG && window.SARI_CONFIG.auth) || null;
  }

  // Mirrors api.js: mock mode unless useMockData is explicitly false.
  function isMock() {
    return (window.SARI_CONFIG || {}).useMockData !== false;
  }

  function isEnabled() {
    var config = authConfig();
    return !isMock() && Boolean(config && config.clientId && config.domain && config.redirectUri);
  }

  // --- Storage -----------------------------------------------------------

  function store() {
    try {
      return window.sessionStorage;
    } catch (err) {
      return null;
    }
  }

  function readJson(storage, key) {
    if (!storage) return null;
    try {
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeJson(storage, key, value) {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // Storage can be full or blocked; the next read fails safely.
    }
  }

  function removeKey(storage, key) {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch (err) {
      // Nothing stored means nothing to clear.
    }
  }

  function readTokens() {
    var tokens = readJson(store(), TOKENS_KEY);
    if (!tokens || !tokens.accessToken || !tokens.expiresAt) return null;
    return tokens;
  }

  // `previous` is only passed by the refresh grant. A fresh authorization code
  // exchange must never inherit an older identity's refresh token.
  function saveTokens(payload, previous) {
    var tokens = {
      accessToken: payload.access_token,
      idToken: payload.id_token || "",
      // A refresh response usually omits the refresh token; keep the old one.
      refreshToken: payload.refresh_token || (previous ? previous.refreshToken : ""),
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
    };
    writeJson(store(), TOKENS_KEY, tokens);
    return tokens;
  }

  function clearSession() {
    removeKey(store(), TOKENS_KEY);
    removeKey(store(), FLOW_KEY);
  }

  // Only clear the session this failure belongs to; a new sign-in may have
  // replaced it while the request was in flight.
  function clearIfCurrent(tokens) {
    var current = readTokens();
    // Nothing of this session remains; a newer sign-in may own the stored flow.
    if (!current) return;
    if (current.refreshToken === (tokens && tokens.refreshToken)) {
      clearSession();
    }
  }

  // --- Identity ----------------------------------------------------------

  function decodePayload(token) {
    try {
      var part = String(token || "").split(".")[1];
      if (!part) return null;
      var padded = part.replace(/-/g, "+").replace(/_/g, "/");
      while (padded.length % 4) padded += "=";
      var json = decodeURIComponent(
        atob(padded)
          .split("")
          .map(function (char) {
            return "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2);
          })
          .join("")
      );
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  // Display-only identity. Authorization always uses the access token.
  // These claims are decoded, not verified; never gate access on them.
  function userFrom(tokens) {
    var claims = decodePayload(tokens && tokens.idToken);
    if (!claims) return null;
    return { email: claims.email || "", sub: claims.sub || "" };
  }

  // --- PKCE --------------------------------------------------------------

  function base64Url(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(byteLength) {
    var bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  function challengeFor(verifier) {
    var data = new TextEncoder().encode(verifier);
    return window.crypto.subtle.digest("SHA-256", data).then(function (digest) {
      return base64Url(new Uint8Array(digest));
    });
  }

  // --- Token endpoint ----------------------------------------------------

  function endpoint(path) {
    return authConfig().domain.replace(/\/$/, "") + path;
  }

  function postToken(body) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var options = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    };
    var timer = null;

    if (controller) {
      options.signal = controller.signal;
      // shortcut: no request timeout when AbortController is missing.
      timer = setTimeout(function () {
        controller.abort();
      }, TOKEN_TIMEOUT_MS);
    }

    function stopTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    var request;
    try {
      request = fetch(endpoint("/oauth2/token"), options);
    } catch (err) {
      // A synchronous throw still owns the abort timer.
      stopTimer();
      throw err;
    }

    return request.then(
      function (res) {
        stopTimer();
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            if (!res.ok) {
              var err = new Error(
                payload.error_description ||
                  payload.error ||
                  "The sign-in service rejected the request."
              );
              err.code = payload.error || "";
              err.status = res.status;
              throw err;
            }
            if (!payload.access_token) {
              throw new Error("The sign-in response did not include an access token.");
            }
            return payload;
          });
      },
      function (err) {
        stopTimer();
        var timedOut = Boolean(controller && err && err.name === "AbortError");
        var failure = new Error(
          timedOut
            ? "The sign-in service did not respond in time. Check your connection and try again."
            : "Could not reach the sign-in service. Check your connection and try again."
        );
        failure.network = true;
        failure.timeout = timedOut;
        throw failure;
      }
    );
  }

  function needsRefresh(tokens) {
    return Number(tokens.expiresAt) - REFRESH_SKEW_MS <= Date.now();
  }

  // A permanent misconfiguration; retrying will not help.
  function isConfigError(err) {
    return (
      err.code === "invalid_client" ||
      err.code === "unauthorized_client" ||
      err.code === "invalid_request" ||
      err.code === "unsupported_grant_type"
    );
  }

  // Resolves to one of:
  //   { status: "ok", tokens }
  //   { status: "invalid" }     refresh token rejected (invalid_grant)
  //   { status: "config" }      client/configuration rejected
  //   { status: "unavailable" } network or server failure; tokens kept
  //   { status: "stale" }       session was replaced while in flight
  function refreshTokens(tokens) {
    // Single-flight: concurrent callers share one refresh request.
    if (refreshPromise) return refreshPromise;
    if (!tokens || !tokens.refreshToken) return Promise.resolve({ status: "invalid" });

    var request;
    try {
      request = postToken({
        grant_type: "refresh_token",
        client_id: authConfig().clientId,
        refresh_token: tokens.refreshToken,
      });
    } catch (err) {
      return Promise.resolve({ status: "unavailable", error: err });
    }

    var settled = request.then(
      function (payload) {
        var current = readTokens();
        // A new sign-in replaced the session while this request was in flight.
        if (!current || current.refreshToken !== tokens.refreshToken) {
          return { status: "stale" };
        }
        return { status: "ok", tokens: saveTokens(payload, tokens) };
      },
      function (err) {
        if (err.code === "invalid_grant") return { status: "invalid" };
        if (isConfigError(err)) return { status: "config", error: err };
        return { status: "unavailable", error: err };
      }
    );

    var shared = settled.then(
      function (result) {
        if (refreshPromise === shared) refreshPromise = null;
        return result;
      },
      function (err) {
        if (refreshPromise === shared) refreshPromise = null;
        return { status: "unavailable", error: err };
      }
    );
    refreshPromise = shared;
    return shared;
  }

  // --- Callback ----------------------------------------------------------

  function stripQuery() {
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch (err) {
      // Some contexts block history changes; the page still works.
    }
  }

  function handleCallback() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    var error = params.get("error");
    if (!code && !error) return Promise.resolve({ handled: false, error: null });

    var flow = readJson(store(), FLOW_KEY);

    if (error) {
      // The login attempt is over either way.
      removeKey(store(), FLOW_KEY);
      stripQuery();
      return Promise.resolve({
        handled: true,
        error:
          error === "access_denied"
            ? "Sign-in was cancelled."
            : params.get("error_description") || "Sign-in failed. Please try again.",
      });
    }

    // Validate the one-time flow before consuming it.
    if (!flow || !flow.verifier || !flow.state || params.get("state") !== flow.state) {
      stripQuery();
      return Promise.resolve({
        handled: true,
        error: "Sign-in could not be verified. Please try again.",
      });
    }

    // Consume the flow before the exchange so a reload cannot replay the code.
    removeKey(store(), FLOW_KEY);
    stripQuery();

    return postToken({
      grant_type: "authorization_code",
      client_id: authConfig().clientId,
      code: code,
      redirect_uri: flow.redirectUri || authConfig().redirectUri,
      code_verifier: flow.verifier,
    }).then(
      function (payload) {
        // Never merge a previous identity's refresh token into this one.
        saveTokens(payload, null);
        return { handled: true, error: null };
      },
      function (err) {
        return { handled: true, error: err.message || "Sign-in failed. Please try again." };
      }
    );
  }

  // --- Public API --------------------------------------------------------

  // init() resolves to { enabled, status, signedIn, user, error }.
  // status: "signed-in"  a usable access token exists
  //         "signed-out"  the user must sign in again
  //         "unavailable" temporary refresh failure; tokens kept, retry later
  //         "disabled"    mock mode or no auth config
  function unavailableResult() {
    return {
      enabled: true,
      status: "unavailable",
      signedIn: false,
      user: null,
      error: "Could not refresh your session. Check your connection and try again.",
    };
  }

  function runInit() {
    if (!isEnabled()) {
      return Promise.resolve({
        enabled: false,
        status: "disabled",
        signedIn: false,
        user: null,
        error: null,
      });
    }

    return handleCallback().then(function (callback) {
      if (callback.error) {
        return {
          enabled: true,
          status: "signed-out",
          signedIn: false,
          user: null,
          error: callback.error,
        };
      }

      var tokens = readTokens();
      if (!tokens) {
        return { enabled: true, status: "signed-out", signedIn: false, user: null, error: null };
      }

      if (!needsRefresh(tokens)) {
        return {
          enabled: true,
          status: "signed-in",
          signedIn: true,
          user: userFrom(tokens),
          error: null,
        };
      }

      return refreshTokens(tokens).then(function (result) {
        if (result.status === "ok") {
          return {
            enabled: true,
            status: "signed-in",
            signedIn: true,
            user: userFrom(result.tokens),
            error: null,
          };
        }

        if (result.status === "stale") {
          var current = readTokens();
          if (!current) {
            return {
              enabled: true,
              status: "signed-out",
              signedIn: false,
              user: null,
              error: null,
            };
          }
          if (!needsRefresh(current)) {
            return {
              enabled: true,
              status: "signed-in",
              signedIn: true,
              user: userFrom(current),
              error: null,
            };
          }
          return unavailableResult();
        }

        if (result.status === "invalid") {
          clearIfCurrent(tokens);
          return {
            enabled: true,
            status: "signed-out",
            signedIn: false,
            user: null,
            error: "Your session has expired. Please sign in again.",
          };
        }

        if (result.status === "config") {
          clearIfCurrent(tokens);
          return {
            enabled: true,
            status: "signed-out",
            signedIn: false,
            user: null,
            error: "Sign-in is not configured correctly. Contact the site owner.",
          };
        }

        // Temporary failure: keep the tokens, but do not pretend the admin is usable.
        return unavailableResult();
      });
    });
  }

  function initFailure(err) {
    return {
      enabled: true,
      status: "unavailable",
      signedIn: false,
      user: null,
      error: (err && err.message) || "Could not start sign-in. Please try again.",
    };
  }

  function init() {
    if (!initPromise) {
      var started;
      try {
        started = runInit();
      } catch (err) {
        // A synchronous throw must not escape init(); the next call retries.
        return Promise.resolve(initFailure(err));
      }
      initPromise = started.then(
        function (result) {
          // Do not cache a temporary failure; the next init() retries.
          if (result.status === "unavailable") initPromise = null;
          return result;
        },
        function (err) {
          initPromise = null;
          return initFailure(err);
        }
      );
    }
    return initPromise;
  }

  function signIn() {
    if (!isEnabled()) return Promise.resolve();

    var storage = store();
    if (!storage) {
      return Promise.reject(
        new Error("This browser blocked session storage, so sign-in cannot start.")
      );
    }

    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(
        new Error("Sign-in needs a secure context. Use http://localhost:8123 or HTTPS.")
      );
    }

    // Never carry a previous identity's tokens or PKCE flow into a new login.
    clearSession();
    refreshPromise = null;
    initPromise = null;

    var config = authConfig();
    var verifier = randomString(32);
    var state = randomString(16);

    writeJson(storage, FLOW_KEY, {
      verifier: verifier,
      state: state,
      redirectUri: config.redirectUri,
    });

    return challengeFor(verifier).then(function (challenge) {
      var params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        scope: config.scopes || "openid email",
        redirect_uri: config.redirectUri,
        state: state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      window.location.assign(endpoint("/oauth2/authorize") + "?" + params.toString());
    });
  }

  function signOut() {
    clearSession();
    refreshPromise = null;
    initPromise = null;
    if (!isEnabled()) return;

    var config = authConfig();
    var params = new URLSearchParams({
      client_id: config.clientId,
      logout_uri: config.logoutUri,
    });
    window.location.assign(endpoint("/logout") + "?" + params.toString());
  }

  function getAccessToken() {
    if (!isEnabled()) return Promise.resolve(null);

    var tokens = readTokens();
    if (!tokens) return Promise.resolve(null);
    if (!needsRefresh(tokens)) return Promise.resolve(tokens.accessToken);

    return refreshTokens(tokens).then(function (result) {
      if (result.status === "ok") return result.tokens.accessToken;

      if (result.status === "stale") {
        var current = readTokens();
        return current && !needsRefresh(current) ? current.accessToken : null;
      }

      if (result.status === "invalid" || result.status === "config") {
        clearIfCurrent(tokens);
      }
      // Temporary failures keep the stored session; the next call retries.
      return null;
    });
  }

  function getUser() {
    return userFrom(readTokens());
  }

  SARI.auth = {
    isEnabled: isEnabled,
    init: init,
    signIn: signIn,
    signOut: signOut,
    getAccessToken: getAccessToken,
    getUser: getUser,
  };
})(window.SARI);
